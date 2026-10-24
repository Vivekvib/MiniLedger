# Architecture

MiniLedger has three parts: a React Native app, an HTTP API, and a PostgreSQL database. The app talks only to the API; only the API talks to the database.

```
 Android emulator / phone                 your computer
┌────────────────────────┐        ┌──────────────────────────────┐        ┌────────────┐
│ Expo app               │  HTTP  │ Express API (port 4000)      │  SQL   │ PostgreSQL │
│  screens               │───────▶│  routes → controllers →      │───────▶│  users     │
│  AuthContext           │  JSON  │  services → repositories     │ params │  otp_codes │
│  TanStack Query        │◀───────│                              │◀───────│  sessions  │
│  SecureStore (token)   │        │  prints mock OTP to terminal │        │  loans     │
└────────────────────────┘        └──────────────────────────────┘        └────────────┘
```

## Principles that shaped it

1. **The server owns the truth.** Totals, loan status and "overdue" are computed by PostgreSQL. The app displays what it is given and never adds up money or compares dates itself, so the list and the summary cannot disagree.
2. **Exact money.** Decimal strings from the database to the screen. No floats.
3. **Every protected request re-checks the session in the database.** Logout and expiry take effect immediately; nothing is cached.
4. **Testable by construction.** The API is built from injected parts (database pool, clock, OTP sender), so tests run the real app against a real test database with a fake clock.
5. **Small, readable layers** over clever abstractions: one thing in one place (for example, "overdue" is defined once).

## Backend (`backend/`)

### Layers

```
HTTP request
  → middleware  (helmet, cors, rate limits, JSON parsing, request log, authenticate, validate)
  → routes      (URL + method → handler; says which middleware applies)
  → controller  (reads the validated request, calls a service, shapes the response)
  → service     (business rules: OTP rules, repay rules, idempotency, transactions)
  → repository  (the only place that contains SQL; parameterized)
  → PostgreSQL
```

Errors: anything expected is thrown as an `AppError(status, code, message, details?)`. A single error handler turns every failure into `{ "error": { code, message, details? } }`. It is the **only** place that writes an error response, and it never leaks stack traces, SQL or driver messages.

### Composition

`createApp({ config, pool, clock, otpSender, logger })` in `src/app.ts` does no I/O of its own and reads no environment variables. `src/server.ts` is the only file that does: it validates the environment, opens the pool, builds the app, listens, and shuts down gracefully on `SIGINT`/`SIGTERM`.

| Injected part | In production code | In tests |
|---|---|---|
| `pool` | real `pg` pool | pool on the **test** database |
| `clock` | system time | `FakeClock` you can set and advance |
| `otpSender` | prints to the terminal (refuses `NODE_ENV=production`) | captures codes in memory |

### Modules

| Module | Responsibility |
|---|---|
| `auth` | issue/verify OTP, open/close sessions, `me` |
| `loans` | create (with idempotency), list, repay, receipt photo (add, replace, fetch, remove) |
| `summary` | the three totals |
| `health` | liveness + a database round trip |

## Authentication flow

```
App                              API                                   PostgreSQL
 │ POST /auth/request-otp {phone}  │                                       │
 │────────────────────────────────▶│ lock phone (advisory lock)            │
 │                                 │ check 60 s cooldown + 5/hour          │
 │                                 │ code = crypto.randomInt, 6 digits     │
 │                                 │ INSERT otp_codes (HMAC hash, expiry) ─▶│
 │                                 │ print code in the API terminal        │
 │◀────────────────────────────────│ {expiresInSeconds, resendAfterSeconds}│  (no code in response)
 │                                 │                                       │
 │ POST /auth/verify-otp {phone,otp}                                       │
 │────────────────────────────────▶│ newest code for phone, FOR UPDATE ───▶│
 │                                 │ locked? expired? compare HMAC (const. time)
 │                                 │ wrong → attempts+1, COMMIT, 401       │
 │                                 │ right → consume code, upsert user,    │
 │                                 │         INSERT sessions row ─────────▶│
 │◀────────────────────────────────│ {token (JWT, jti = session id), user} │
 │ save token in SecureStore       │                                       │
 │                                 │                                       │
 │ GET /loans  Authorization: Bearer <token>                               │
 │────────────────────────────────▶│ verify JWT (HS256 only, not expired)  │
 │                                 │ SELECT session: exists, not revoked,  │
 │                                 │   not expired, same user ────────────▶│
 │◀────────────────────────────────│ data (or a uniform 401)               │
```

- The OTP rules (expiry, attempts, single use, throttling) are enforced in the service and backed by database rows, so they survive a server restart.
- A failed guess is **committed** before the 401 is returned, so a client cannot dodge the attempt limit by making the request fail.
- Logout sets `sessions.revoked_at`. The JWT itself is still cryptographically valid, but the per-request session lookup rejects it.

## Mobile app (`mobile/`)

### Routing and guards

Expo Router, file-based, in `src/app/`:

```
src/app/
  _layout.tsx        providers (QueryClient → Flash → Auth), fonts, splash, route guards
  (auth)/login.tsx   enter phone
  (auth)/verify.tsx  enter code
  (app)/index.tsx    dashboard
  (app)/add-loan.tsx add-loan form (with the optional receipt photo)
  (app)/receipt/[id].tsx  view, add, replace or remove one loan's receipt
```

The root layout uses `Stack.Protected`: the `(auth)` screens exist only while signed out and the `(app)` screens only while signed in. When the auth state flips, the router moves the user; there is no screen-level redirect code to forget.

### Auth state

`AuthContext` holds one of four states:

| State | Meaning | What the user sees |
|---|---|---|
| `loading` | reading the saved token and asking the server if it is still valid | splash screen |
| `unreachable` | a token exists but the server could not be reached | message with *Try again* and *Sign out instead* |
| `signedOut` | no valid session | login screens |
| `signedIn` | valid session | dashboard |

On a cold start it reads the token from `expo-secure-store` and calls `GET /auth/me`. A `401` ends the session (with the "session expired" notice); a network error keeps the token and shows `unreachable` so a temporary outage does not sign anyone out.

### API client

One function (`src/services/api/client.ts`) performs every request: it adds the base URL and Bearer token, applies a 15-second timeout, turns network failures into an `ApiError` with status `0`, unwraps the `{data}`/`{error}` envelope, and **validates every response against a Zod schema** so a contract change fails loudly at the boundary rather than as `undefined` on screen.

A `401` for a request that carried the *current* token ends the session. A `401` from a sign-in call (wrong code) never signs anyone out, and a late `401` for a token that has since been replaced is ignored. Ending a session clears the token from memory and SecureStore **and the whole query cache**, so the next user cannot see the previous user's data.

### Server data

TanStack Query holds the loan list and summary. Reads retry once (never on a 4xx). **Writes never retry automatically.** After adding or repaying, both queries are refetched and awaited, so the screen is correct as soon as the action completes. Add-loan sends an `Idempotency-Key` that is reused if the user retries the same details after a failure, and replaced as soon as they edit.

### Design

"Paper & Ink": a warm paper background, near-black ink text, a single deep-green accent, and a restrained red for overdue. Newsreader headings and Inter body text. Flat ledger rows separated by hairlines; the summary is a ruled table closed by a double rule. Status is always spelled out in words ("Overdue · 11 days", "Repaid 2 Sep 2026"), never colour alone. Tokens are in `src/theme/`, and a test checks WCAG contrast for every text and border colour pair.

## Receipt photos

```
 phone                                         API                              PostgreSQL
 camera / gallery
   │  expo-image-picker (quality 0.6, base64)
   │  check type (first bytes) + size ≤ 5 MB
   │ PUT /loans/:id/receipt {contentType,data} ─▶ authenticate FIRST (JWT + session)
   │   (60 s timeout)                            then read body (limit ≈ 7 MB, this route only)
   │                                             decode base64, check size + real image signature
   │                                             UPDATE loans SET receipt_* … WHERE id AND user_id ─▶
   │◀──────── loan with receipt {type,size,time}
   │
   │ GET /loans/:id/receipt (Bearer header) ───▶ SELECT receipt_data … WHERE id AND user_id ─▶
   │◀──────── image bytes, Content-Type from the DB, nosniff, private no-cache
```

- **Order matters.** The upload route's larger body limit is mounted *after* authentication, so someone without a valid session cannot make the server buffer megabytes. All other routes keep the 10 KB limit (the global parser skips only this one route).
- **Two requests, not one.** Adding a loan *with* a photo is `POST /loans` and then `PUT …/receipt`: the loan creation keeps its proven JSON path and idempotency. If the photo fails, the loan is still correct and complete; the app says so and offers *Add receipt* on the loan. The alternative (one multipart request) would make a lost connection ambiguous about whether the loan exists.
- **Validation twice.** The phone checks the type (first bytes) and size so the user hears immediately; the server repeats every check and is the authority; the database `CHECK` constraints are the last line.
- **The image is never in a list.** Loan JSON carries only `receipt: { contentType, sizeBytes, uploadedAt }` or `null`; the bytes come only from the dedicated route.
- **Display.** The photo is downloaded with the app's own `fetch` path (Bearer token, 60-second timeout, the same error and 401 handling as every other request), read as a `data:` address with `FileReader.readAsDataURL`, and given to `<Image>`. It is cached by TanStack Query under the loan id **and the upload time**, so a replaced photo is a different entry and a stale copy is never shown; the cache is cleared at sign-out. This replaced a first version that gave `<Image>` the address plus an `Authorization` header and let Android's separate image loader do the networking: on a real phone that failed with "Couldn't load the receipt photo", whereas `fetch` was already proven to work there. Trade-off: the photo (up to 5 MB, typically well under 1 MB after compression) is held in memory as base64 text.

## Data flow: marking a loan repaid

1. User taps **Mark repaid** → the app shows a confirmation dialog (nothing is sent yet).
2. On confirm, `PATCH /api/loans/:id/repay` with the Bearer token. While it is in flight the row shows a spinner and the other rows' buttons are disabled.
3. API: authenticate (JWT + session lookup) → validate the id → one conditional `UPDATE … WHERE repaid_at IS NULL`.
4. `200` with the updated loan, or `409 ALREADY_REPAID` (another device or a double tap got there first).
5. App: refetches `GET /loans` and `GET /summary` and waits for both, then shows "Marked as repaid: Asha." (or, on `409`, "That loan was already marked as repaid." and the refreshed list).

## Configuration and secrets

All backend configuration is environment variables, validated once at startup by Zod (`src/config/env.ts`). The server refuses to start with a missing, placeholder, too-short or duplicated secret. The mobile app has a single public setting, `EXPO_PUBLIC_API_URL`.

## What is deliberately not here

A refresh-token flow, SMS delivery, pagination, partial repayments, editing or deleting loans, multiple currencies, push notifications, object storage or thumbnails for receipts. See the README's *Known limitations*.
