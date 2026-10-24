# Testing

This page says what is tested, how to run it, what the results were when this project was built, and, just as importantly, what could **not** be tested.

## Summary of what was run

All of these were run in the build environment (Linux, Node 22, native PostgreSQL 16) and the results are the real ones.

| Check | Where | Result |
|---|---|---|
| Type-check (`tsc --noEmit`) | backend | passes |
| Lint (`eslint .`) | backend | passes |
| Automated tests (`npm test`) | backend | **382 passed**, 0 failed (14 files) |
| Build (`tsc -p tsconfig.build.json`) | backend | passes |
| Migrations up on a fresh database | backend | applied 5 of 5 |
| Live curl journey against the running server | backend | passes (see below) |
| Type-check | mobile | passes |
| Lint | mobile | passes |
| Automated tests (`npm test`) | mobile | **327 passed**, 0 failed, 8 skipped (the opt-in live test, below) |
| Live contract test (mobile client → running backend, including a receipt upload, byte-exact download and removal) | mobile + backend | **8 passed** |
| Android bundle (`expo export --platform android`) | mobile | exports (Hermes bytecode, ~3.8 MB) |
| `npm audit` | both | backend: 0 production vulnerabilities. Mobile: 49 findings, all in dev tooling (see README §19) |

## What could NOT be verified, and why

Be skeptical of anything on this list: it has not been seen working.

| Not verified | Why | What to do |
|---|---|---|
| **The app running on an Android emulator or phone, by me** | No Android emulator or device in the build environment. (The project owner did run sign-in, add-loan and mark-repaid on a real phone over USB and reported they work. That was before receipts existed.) | Run it ([README §11](../README.md#11-start-the-mobile-app)) and use the manual checklist below |
| **The receipt camera, the camera permission dialog, the gallery picker, and drawing the downloaded photo in an `<Image>`** | Same. The tests replace `expo-image-picker` and `FileReader`; the live test runs the app's real download code against the real server and checks the bytes come back exactly, but not React Native's blob reading or image drawing on Android. (The first version, which gave `<Image>` an address plus a header, failed on the project owner's phone; the current fetch-based version has not been confirmed on a phone yet) | Checklist steps 11 to 15 below |
| How the screens **look** (spacing, fonts, colours as rendered) | Same | Manual checklist |
| TalkBack (screen reader), large font sizes | Same | Manual checklist |
| Keyboard behaviour with Android's edge-to-edge layout | Same | Manual checklist |
| The native Android date-picker dialog | Same. Tests mock it and check what the app passes to it and does with the result | Manual checklist |
| Emulator → host networking (`10.0.2.2`) | Same | `http://10.0.2.2:4000/api/health` in the emulator's browser |
| Expo Go on a physical phone | Same, and Expo Go must support SDK 58 | Try it; fall back to the emulator |
| `docker compose up -d` | No Docker daemon available. Verification used a native PostgreSQL 16 | Run it; the compose file is standard |
| `npx expo-doctor` and `npx expo install --check` | The environment blocks Expo's API hosts. Versions were taken from the SDK's `bundledNativeModules.json` and installed via npm | Run them on your machine |
| iOS | Not a target; nothing was run | n/a |

### Manual checklist (about 10 minutes, on the emulator)

1. Start PostgreSQL and the backend; confirm `/api/health` in the emulator's Chrome.
2. Sign in: send a code, read it in the backend terminal, enter it. A wrong code shows "attempts left"; *Resend* is disabled for 60 s.
3. Dashboard shows three totals in a ruled table and an empty state with *Add loan* at the bottom (not hidden behind the keyboard or system bar).
4. Add a loan: keyboard doesn't cover the Save button; the amount field accepts only digits and one decimal point; tapping *Due date* opens the Android calendar; save returns to the dashboard with a green confirmation.
5. Add a loan with a **past** due date: it appears with a red edge, the words "Overdue · N days", and the Overdue total includes it.
6. Mark repaid: confirmation dialog; the row moves to *Repaid*; totals change.
7. Pull to refresh. Turn off the backend and refresh: the old data stays with an error banner and *Try again*.
8. Sign out, then confirm the dashboard can't be reached with the back button. Sign in again.
9. With TalkBack on, swipe through a loan row: it reads name, amount in rupees, due date and status as one item.
10. Set the system font size to the largest: nothing is cut off; the amounts still fit.

**Receipts** (needs the camera permission; a few more minutes):

11. *Add loan* → *Take photo*: Android asks for camera permission; allow it; take a photo; a small preview appears with "JPEG · NNN KB". Save: the loan appears and its row says **View receipt**.
12. Tap **View receipt**: the photo shows, with "JPEG · NNN KB · Added <date>". If it does not, tap *Try again*; if it still fails, check the backend terminal. (This step tests the image header.)
13. On that screen choose another photo from the gallery: it uploads at once and the details change ("Receipt replaced."). Then *Remove receipt*: confirm; the screen returns to "No receipt yet".
14. Deny the camera permission (Android Settings → Apps → Expo Go → Permissions): the app says so and the gallery still works.
15. Switch the phone to airplane mode, choose a photo on a loan's receipt screen: "The receipt was not uploaded. Can't reach the server…" with the photo still shown. Switch the connection back on and tap *Try again*.

## Test design

### Backend: Jest + Supertest, real PostgreSQL

The integration tests call the **real Express app** over HTTP (via Supertest) against a **real PostgreSQL test database**; only the clock and the OTP sender are replaced (a fake clock, and a sender that captures codes). Nothing in the database layer is mocked, so the SQL, constraints, transactions and locking are exercised for real.

| File | What it covers |
|---|---|
| `integration/auth.test.ts` (41) | OTP issue/verify: success, wrong code, attempt counting and lockout, expiry, single use, supersession by a newer code, resend cooldown, hourly cap, invalid phone, code never in the response, code stored hashed, concurrent verifies |
| `integration/sessions.test.ts` (26) | Missing/malformed/tampered/wrong-secret/`alg:none` tokens; borrowed session ids; token and session expiry; **revocation checked on every endpoint**; revocation straight in the database; logout isolation between sessions; a deleted user's token |
| `integration/loans.test.ts` (61) | Create/list/repay; every validation rule; amount spellings; exact decimals; **atomic repay** (concurrent requests → exactly one success, rest `409`); repaying again; ownership (`404` for another user's loan); status and `daysOverdue`; ordering; IST midnight boundaries |
| `integration/idempotency.test.ts` (18) | Same key twice → one loan; concurrent same-key requests; key reuse with different data → `422`; keys scoped per user; invalid keys |
| `integration/summary.test.ts` (23) | Totals for empty/mixed data; decimal exactness (`0.10 + 0.20 = 0.30`, the classic float failure); overdue boundary (due today vs yesterday, at IST midnight, near UTC midnight); repaid loans never overdue; per-user isolation; summary and list agree |
| `integration/errors-and-limits.test.ts` (16) | Error envelope shape; unknown route; bad JSON; oversized body; per-IP and global rate limits; `503` when the database is unreachable and `500` for unexpected failures, with no internals leaked; recovery when the database returns |
| `integration/receipts.test.ts` (61) | **Receipt photos.** Upload as JPEG, PNG and WebP; the response carries receipt details and never the image; replace (bytes, type, size and time all change; a failed replacement keeps the old photo); works on repaid loans and changes nothing else on the loan; exactly 5 MiB accepted and one byte more refused; a body far over the limit gets `413`; every validation case (missing fields, wrong types, bad base64, a `data:` URL, whitespace inside, URL-safe base64, wrong JSON types, invalid JSON, wrong request content type, bad loan id); **the bytes must really be the declared image** (text, HTML, SVG, PDF, and each image type declared as another are all refused, and nothing is stored); ownership (`404` for another user's loan on PUT, GET and DELETE, and their photo is untouched); `401` without a token even for a 9 MB body, and after logout; the download returns the exact bytes with the right headers (`nosniff`, `private, no-cache`); delete is idempotent; the loan list shows details but never the image; every other route is still limited to 10 KB; and the database `CHECK` constraints are tried directly (partial columns, wrong type, wrong size, over 5 MiB) |
| `unit/*` (136) | Money parsing, date/timezone maths, phone normalisation, OTP/JWT helpers, config validation, the database-safety guard, and **receipt image rules** (`unit/receipt-image.test.ts`, 24: file signatures per type and the confusions between them, base64 strictness with 0/1/2 padding, empty, exact size limit, oversized text refused before decoding, and that the body limit leaves room for the largest photo) |

Time is controlled by a `FakeClock`, so expiry, cooldowns and "overdue at midnight" are tested deterministically, not with sleeps.

### The tests cannot touch the development database

Four independent layers:

1. **Environment.** `npm test` sets `NODE_ENV=test`; in that mode the config reads `TEST_DATABASE_URL` only. `DATABASE_URL` is never consulted, even if set.
2. **URL guard** (`assertSafeTestDatabase`, run in Jest's global setup before anything connects): the database name must end in `_test`, the host must be `localhost`/`127.0.0.1`/`::1`, the URL must not use `host=`/`hostaddr=`/`service=` overrides, and it must not be the same database as `DATABASE_URL`. If any check fails the whole run stops with a clear message that does not echo the URL (it contains a password).
3. **Connection guard** (`assertConnectedToTestDatabase`): before any data is deleted, the live connection is asked `SELECT current_database()` and must end in `_test`.
4. **Narrow cleanup.** Between tests only four named tables are `TRUNCATE`d. Nothing is ever dropped.

Because of layers 2 and 3, a typo in `.env` produces an error, not data loss. `unit/db-guard.test.ts` tests the guard itself.

### Mobile: Jest (`jest-expo`) + React Native Testing Library

The screens, the auth context, the API client, the Zod schemas and TanStack Query all run for real. Only the **platform edge** is replaced:

- `fetch` → an in-memory fake backend that records every request (`tests/helpers/fakeApi.ts`). Tests assert on what was *sent* (method, path, headers, body) as well as on what is shown.
- `expo-secure-store` → an in-memory map; `expo-crypto` → predictable UUIDs; `expo-router` → a spy router; the Android date dialog → a mock whose callback the test invokes; `expo-image-picker` → mocks the tests tell what the camera or gallery "returns" (`tests/helpers/images.ts` builds tiny photos with real file signatures).

Tests run as `Platform.OS = 'android'` with the time zone pinned to `Asia/Kolkata`.

| File | What it covers |
|---|---|
| `utils/money.test.ts` (48) | Indian grouping, exactness beyond float range, input sanitising and parsing |
| `utils/dates.test.ts` (19) | Local-date handling with no UTC shift, parsing, formatting |
| `utils/phone.test.ts` (20), `utils/validation.test.ts` (15) | Phone/OTP input rules; the add-loan form rules |
| `theme.test.ts` (16) | WCAG contrast of every text and border colour pair |
| `services/client.test.ts` (16) | Envelope handling; Bearer header; no token on sign-in calls; timeout and network errors; invalid responses; non-JSON error pages; **401 rules** (current token ends the session; sign-in 401 and stale-token 401 do not) |
| `context/auth.test.tsx` (12) | Cold start (no token / valid / rejected / unreachable then retry / unreadable storage); sign-in; sign-out (server revoke, storage, **query cache cleared**); expiry while in use |
| `context/flash.test.tsx` (5) | Success clears itself after 4 s; errors persist until dismissed; replacement timing |
| `screens/login.test.tsx` (10) | Validation, normalisation to `+91`, double-tap protection, throttle and network errors, "resend too soon" goes on to the code screen, the expiry notice |
| `screens/verify.test.tsx` (15) | Digits-only code, attempts-left messages, lock/expiry messages, double-submit guard, sign-in, **60 s resend cooldown (fake timers)**, redirect when opened without a number |
| `screens/dashboard.test.tsx` (18) | Loading / empty / error / retry / stale-data states; server totals shown as given; Outstanding vs Repaid; **repay flow** (confirm first, one request, spinner, other rows disabled, totals and list refetched, `409`, failures); sign-out; session expiry while open |
| `screens/add-loan.test.tsx` (18) | Validation per field; date picker wiring and range; exact payload; **Idempotency-Key reused on retry, new when edited**; double-submit guard; server field errors; leaving mid-request is safe |
| `utils/receipt.test.ts` (32) | Decoded-size maths, type detection from a photo's first bytes, file-size text, and the photo checks (unreadable, not an image, exactly 5 MB accepted, one byte over refused with both sizes in the message) |
| `services/receipt-picker.test.ts` (14) | Camera permission asked first; refused → gallery suggested, camera not opened; blocked for good → settings explained; cancel is not an error; a camera or gallery that throws becomes a message; picker options (compressed, base64, no editing step) |
| `services/receipt-api.test.ts` (17) | `PUT`/`DELETE` requests (method, path, JSON body, Bearer token, no body on delete); 60-second upload timeout; the server's field message surfaces; **the image download**: Bearer token, exact bytes as a `data:` address labelled with the loan's own type, the server's message for a missing receipt, the 401 rule (current token ends the session, an older token's 401 does not), network failure, 60-second timeout, an empty image refused, no request for a loan without a receipt; a server that omits `receipt` is read as "none"; an unknown image type is rejected |
| `screens/add-loan-receipt.test.tsx` (21) | Choosing from camera and gallery, preview with type and size, replace, remove, cancel; every refusal explained inline; the form is kept; **POST then PUT in that order** with the exact bodies; no PUT without a photo or after Remove; a refused loan uploads nothing and keeps the photo; retry reuses the Idempotency-Key; **loan saved but upload failed** → back to the dashboard with a lasting message that says the loan was added and where to retry; controls locked while saving and one POST and one PUT however often Save is pressed |
| `screens/receipt.test.tsx` (26) | Loading, load error and retry, loan not found; no-receipt state; upload on choosing, "Uploading…", buttons locked; too-large and non-image refusals; **failed upload keeps the photo and Try again resends the same one**; Dismiss; old receipt kept after a failed replacement; the photo downloaded with the Bearer token and shown byte-for-byte; "Loading receipt…"; a failed download that says why and Try again that refetches; a downloaded photo that cannot be drawn and its retry; replace (the new photo is downloaded, the old never shown); remove with a confirmation (cancel sends nothing) and its failure; repaid loans |
| `screens/dashboard-receipt.test.tsx` (5) | "Add receipt" vs "View receipt" on each row (repaid loans too), navigation to the receipt screen, screen-reader labels |
| `contract/live-backend.test.ts` (8, opt-in) | The real client and schemas against a real running backend, including a receipt round trip (upload, list shows details, byte-exact download with the same header the app uses, `401` without it, delete, `404` afterwards) and a refused fake image |

Tests were not written to merely pass: when a test found a problem in the app, the app was fixed. Examples from this build: a missing `expo-asset` dependency (the app would not have bundled), and a gap that allowed two repayments to be confirmed at the same time.

The receipt tests were also checked by **breaking the code on purpose** and confirming the tests fail: switching off the image-signature check made 8 backend tests fail; making the add-loan screen never send the photo made 6 mobile tests fail; removing the phone-side size check made 3 fail; making the receipt screen forget a photo after a failed upload made 3 fail. Each change was reverted afterwards.

## How to reproduce the verification

Start PostgreSQL ([README §7](../README.md#7-postgresql-setup)), create `backend/.env` ([§8](../README.md#8-environment-variables)), then:

```bash
# Backend
cd backend
npm install
npm run typecheck
npm run lint
npm test                 # applies migrations to the test database, then runs 382 tests
npm run build
npm run migrate:up       # development database

# Mobile
cd ../mobile
npm install
npm run typecheck
npm run lint
npm test                 # 327 tests (+ 8 skipped live tests)
npx expo export --platform android --output-dir dist-check && rm -rf dist-check
```

PowerShell: replace `&& rm -rf dist-check` with a separate `Remove-Item -Recurse -Force dist-check`.

### Live check of the whole stack without a device

Runs the mobile app's real API client against your running backend (creates one throwaway user and one loan in the **development** database):

```bash
# terminal 1: backend, with its output saved (the OTP is printed there)
cd backend && npm run dev 2>&1 | tee /tmp/miniledger-server.log

# terminal 2
cd mobile
MINILEDGER_LIVE_API=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:4000 \
MINILEDGER_SERVER_LOG=/tmp/miniledger-server.log npx jest tests/contract
```

It checks: request code (response has no code) → wrong code → right code → `me` → create with an Idempotency-Key twice (same loan back) → list → summary → repay → repay again (`409`) → receipt upload, list, byte-exact download and removal → a fake image is refused → logout → the old token is refused.

The raw HTTP version of the same journey (curl) was also run; the responses in [api.md](api.md) are from it.

## Known gaps in the automated tests

- No end-to-end test drives a real device UI (no Detox/Maestro). Screen behaviour is tested at the component level.
- No load or long-running concurrency testing. Concurrency is tested with parallel requests (repay, idempotent create, OTP verify), not at scale.
- The in-memory per-IP rate limiter is tested in a single process only.
- The Docker Compose file is untested.
