# 📒 MiniLedger

[![Start Here](https://img.shields.io/badge/Start%20Here-First--time%20guide-1D1B16?style=for-the-badge)](START-HERE.md)
[![API Docs](https://img.shields.io/badge/API%20Docs-docs%2Fapi.md-1F4D3F?style=for-the-badge)](docs/api.md)

![Node.js](https://img.shields.io/badge/Node.js-22-5FA04E?style=flat&logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?style=flat&logo=typescript&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?style=flat&logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat&logo=postgresql&logoColor=white)
![Zod](https://img.shields.io/badge/Zod-Validation-3E67B1?style=flat&logo=zod&logoColor=white)
![JWT](https://img.shields.io/badge/Auth-JWT%20HS256-000000?style=flat&logo=jsonwebtokens&logoColor=white)
![Expo](https://img.shields.io/badge/Expo-SDK%2058-000020?style=flat&logo=expo&logoColor=white)
![React Native](https://img.shields.io/badge/React%20Native-0.88-61DAFB?style=flat&logo=react&logoColor=black)
![Jest](https://img.shields.io/badge/Jest-Backend%20%2B%20Mobile-C21325?style=flat&logo=jest&logoColor=white)
![Android](https://img.shields.io/badge/Platform-Android-3DDC84?style=flat&logo=android&logoColor=white)

A small full-stack app for keeping track of money you lend to friends: who owes what, when it is due, what has come back, and what is overdue.

- **Mobile app:** Expo (React Native) + TypeScript, Android first.
- **API:** Node.js + Express 5 + TypeScript.
- **Database:** PostgreSQL, accessed with raw parameterized SQL.

## 🎥 Demo

[![Watch the screen recording](https://img.shields.io/badge/▶_Watch_the_demo-Google_Drive-1F4D3F?style=for-the-badge&logo=googledrive&logoColor=white)](https://drive.google.com/drive/folders/12JEa66udY3TsVpIIEKxeN_3xWiAbQE8a?usp=sharing)

A short screen recording of the app on a real Android phone: sign-in with OTP, adding a loan with a receipt photo, recording part payments, marking a loan repaid, and the summary totals.

**New here and not technical?** Read [START-HERE.md](START-HERE.md): a step-by-step first-time guide with every command, written for someone who has never set up a project like this.

Sign-in is a **mock one-time-code login**: the code is printed in the terminal where the API runs. It is never sent by SMS and never returned by the API. See [Security notes](#19-security-notes) and [Known limitations](#18-known-limitations).


---

## Contents

1. [What it does](#1-what-it-does)
2. [Technology stack](#2-technology-stack)
3. [Architecture overview](#3-architecture-overview)
4. [Folder structure](#4-folder-structure)
5. [Prerequisites](#5-prerequisites)
6. [Install dependencies](#6-install-dependencies)
7. [PostgreSQL setup](#7-postgresql-setup)
8. [Environment variables](#8-environment-variables)
9. [Create the schema (migrations)](#9-create-the-schema-migrations)
10. [Start the backend](#10-start-the-backend)
11. [Start the mobile app](#11-start-the-mobile-app)
12. [Using the app](#12-using-the-app)
13. [Request and verify a mock OTP](#13-request-and-verify-a-mock-otp)
14. [Android networking](#14-android-networking)
15. [Try the API without the app](#15-try-the-api-without-the-app)
16. [Run the tests](#16-run-the-tests)
17. [Troubleshooting](#17-troubleshooting)
18. [Known limitations](#18-known-limitations)
19. [Security notes](#19-security-notes)
20. [Receipt upload](#20-receipt-upload)

More detail: [architecture](docs/architecture.md) · [API](docs/api.md) · [database](docs/database.md) · [testing](docs/testing.md) · [troubleshooting](docs/troubleshooting.md).

---

## 1. What it does

| Feature | How it behaves |
|---|---|
| **Mock OTP login** | Enter a phone number, receive a 6-digit code **in the API terminal**, enter it to sign in. Codes expire after 5 minutes, allow 5 wrong tries, and can be requested at most once per 60 seconds (5 per hour) per phone. |
| **Add a loan** | Friend name, amount (₹, up to 2 decimals) and due date. Sending the same request twice (for example after a dropped connection) does not create two loans. |
| **Mark repaid** | One tap and a confirmation. The change is atomic on the server: repaying twice is refused with `409` and changes nothing. |
| **Receipt photo** *(optional)* | Attach a photo of a receipt when adding a loan (take one with the camera or choose one from the gallery), or add, view, replace and remove it later from the loan's row. JPEG, PNG or WebP, up to 5 MB. See [Receipt upload](#20-receipt-upload). |
| **Summary** | `totalLent`, `totalRepaid` and `overdueAmount`, calculated by the database (exact decimal arithmetic), shown as a ruled table at the top of the dashboard. |
| **Dashboard** | The summary, then every loan: Outstanding first (overdue ones lead, in words and in red), then Repaid. Pull down to refresh. Loading, empty, error and retry states are all handled. |
| **Log out / session expiry** | Logging out revokes the session **on the server**. A revoked or expired token is rejected on the very next request and the app returns to the sign-in screen with a message. |
| **Protected screens** | The app cannot show the dashboard without a valid session. Every API route except sign-in and health requires a token. |

### Input validation

Every request is validated on the server (Zod) and the app checks the same rules first, for instant feedback. The server is the authority: its field messages are shown next to the same fields.

| Input | Rule | Message example |
|---|---|---|
| Phone | 8 to 15 digits with country code (`+` then a non-zero digit); spaces, hyphens, dots and brackets are ignored; the app treats a 10-digit number as `+91` | "Enter a valid phone number with country code, for example +911234567890." |
| One-time code | exactly 6 digits | |
| Friend name | trimmed, 1 to 80 characters, no control characters | "Friend name is required." |
| Amount | greater than 0, up to 10 digits before and 2 after the decimal point; more than 2 decimals is **rejected, not rounded** | "Amount must be greater than 0." |
| Due date | a real calendar date as `YYYY-MM-DD`, in the years 2000 to 2100 (past dates are allowed on purpose) | "Enter a valid due date in YYYY-MM-DD format." |
| Loan id | a UUID | "Loan id must be a valid UUID." |
| `Idempotency-Key` header | optional, a UUID | "Idempotency-Key must be a UUID." |
| Receipt photo | JPEG, PNG or WebP only; at most 5 MB; the file's own first bytes must match the declared type (a renamed text file or an SVG is refused); valid base64 | "The image is too large. The maximum size is 5 MB." |
| Request body | JSON only; at most 10 KB (a receipt upload allows about 7 MB, only after the user is authenticated) | `413 PAYLOAD_TOO_LARGE` |

Invalid input never reaches the database and never produces a `500`. All failures use one envelope: `{ "error": { "code", "message", "details" } }`, documented in [docs/api.md](docs/api.md).

Money is shown as `₹1,50,000.00` (Indian digit grouping, INR only). "Overdue" means *not repaid and the due date is before today*, where "today" is the calendar day in `Asia/Kolkata` (configurable). A loan due today is not overdue until the day rolls over.

## 2. Technology stack

| Layer | Choices |
|---|---|
| API | Node.js ≥ 22, TypeScript, Express 5, Zod (validation), `pg` with raw parameterized SQL, `node-pg-migrate` (plain SQL migrations), `jsonwebtoken` (HS256), `helmet`, `cors`, `express-rate-limit`, `pino` |
| Database | PostgreSQL 16 (Docker Compose file included) |
| Mobile | Expo SDK 58, React Native 0.88, TypeScript, Expo Router, React Context (`AuthContext`), TanStack Query, `expo-secure-store`, `expo-image-picker` (receipt photos), Zod |
| Tests | Backend: Jest + Supertest against a real PostgreSQL test database. Mobile: Jest (`jest-expo`) + React Native Testing Library |

## 3. Architecture overview

```
┌────────────────────┐  HTTP + JSON   ┌──────────────────────────┐   SQL    ┌────────────┐
│  Expo mobile app   │ ─────────────▶ │  Express API             │ ───────▶ │ PostgreSQL │
│  (Android first)   │ Bearer token   │  routes → controllers →  │  (pg,    │            │
│                    │ ◀───────────── │  services → repositories │  params) │            │
└────────────────────┘                └──────────────────────────┘          └────────────┘
   token in SecureStore                  prints mock OTP to terminal
```

- The **app never calculates money or "overdue"**: the summary and each loan's status come from the API, which gets them from SQL.
- The **API is layered**: routes → controllers → services → repositories. Only repositories contain SQL. `createApp({ config, pool, clock, otpSender, logger })` receives everything it needs, which is how the tests run the real app against a test database with a fake clock.
- **Receipts** are stored in PostgreSQL itself (a `bytea` column on the loan, at most 5 MB) and served only to the loan's owner by an authenticated route. The loan list carries receipt *details* (type, size, time), never the image bytes.
- **Auth:** the JWT carries a session id; the API looks that session up in PostgreSQL on **every** protected request, so logout and expiry take effect immediately.

Full explanation, including the data flow for each feature: [docs/architecture.md](docs/architecture.md).

## 4. Folder structure

```
MiniLedger/
├── README.md
├── docker-compose.yml            PostgreSQL 16 for local use (dev + test databases)
├── docker/initdb/                creates the miniledger_test database on first start
├── .gitignore  .editorconfig
├── START-HERE.md                 first-time walkthrough for a non-technical reader
├── docs/                         architecture, api, database, testing, troubleshooting
├── backend/
│   ├── .env.example              copy to .env (git-ignored)
│   ├── migrations/               SQL migrations (users, otp_codes, sessions, loans, loan receipt columns)
│   ├── scripts/setup-env.mjs     creates .env with fresh random secrets (npm run setup:env)
│   ├── src/
│   │   ├── server.ts  app.ts     entry point, app factory
│   │   ├── config/               environment validation
│   │   ├── database/             pool + transaction helper
│   │   ├── middleware/           authenticate, validate, rate-limit, error-handler
│   │   ├── modules/{auth,loans,summary,health}/   routes, controller, service, repository, validation
│   │   └── utils/                clock, money, dates, phone, receipt-image, errors, logger
│   └── tests/                    unit/, integration/, setup/ (test-database safety guards)
└── mobile/
    ├── .env.example              copy to .env (git-ignored)
    ├── app.json
    ├── src/
    │   ├── app/                  Expo Router screens: (auth)/login, (auth)/verify, (app)/index, (app)/add-loan, (app)/receipt/[id]
    │   ├── components/           Button, TextField, LoanRow, SummaryTable, Banner, DateField, ReceiptChooser, ReceiptDraft, ...
    │   ├── context/              AuthContext, FlashContext
    │   ├── hooks/                TanStack Query hooks for loans and summary
    │   ├── services/             API client, endpoints, receipt picker (camera/gallery), secure token storage, query client
    │   ├── theme/                the "Paper & Ink" design tokens
    │   └── utils/                money, dates, phone, validation, receipt
    └── tests/                    utils/, services/, context/, screens/, contract/ (opt-in live API check)
```

## 5. Prerequisites

| Need | Version | Check |
|---|---|---|
| Node.js | 22 or newer | `node --version` |
| npm | comes with Node | `npm --version` |
| PostgreSQL 16 **or** Docker with Compose | any recent | `psql --version` / `docker compose version` |
| Android Studio with an Android emulator (AVD) | recent | for running the app on an emulator |

You do not need an Expo account. You do not need to install anything globally: every tool runs through `npx` or `npm run`.

## 6. Install dependencies

From the repository root.

**macOS / Linux (bash):**
```bash
cd backend && npm install && cd ..
cd mobile  && npm install && cd ..
```

**Windows (PowerShell):**
```powershell
cd backend; npm install; cd ..
cd mobile;  npm install; cd ..
```

`npm install` may print `npm audit` warnings for the mobile app. They are in development tooling (Expo CLI, Jest), not in the app that ships. See [Security notes](#19-security-notes).

## 7. PostgreSQL setup

Pick **one** option. Either way you end up with a server on `localhost:5432`, a role `miniledger` (password `miniledger_local`), and two databases: `miniledger_dev` and `miniledger_test`. These credentials are local-only and already match `backend/.env.example`.

### Option A: Docker (recommended)

```bash
docker compose up -d
```

The first start creates both databases. Check it is ready:

```bash
docker compose ps
```

Stop it later with `docker compose stop` (your data is kept). Avoid `docker compose down -v`: it deletes the data volume.

> The Docker Compose file is included but **was not run** when this project was built (no Docker daemon was available in the build environment). The PostgreSQL used for verification was a native PostgreSQL 16 install.

### Option B: PostgreSQL installed on your machine

Create the role and databases once, as a PostgreSQL superuser.

**macOS / Linux:**
```bash
sudo -u postgres psql <<'SQL'
CREATE USER miniledger WITH PASSWORD 'miniledger_local';
CREATE DATABASE miniledger_dev  OWNER miniledger;
CREATE DATABASE miniledger_test OWNER miniledger;
SQL
```

**Windows (PowerShell)**, using the `psql` that the PostgreSQL installer provides (it asks for the `postgres` password you set during installation):
```powershell
psql -U postgres -c "CREATE USER miniledger WITH PASSWORD 'miniledger_local';"
psql -U postgres -c "CREATE DATABASE miniledger_dev OWNER miniledger;"
psql -U postgres -c "CREATE DATABASE miniledger_test OWNER miniledger;"
```

## 8. Environment variables

### Backend: `backend/.env`

**Easiest:** from `backend/`, run `npm run setup:env`. It copies `.env.example` to `.env` and fills in two fresh random secrets for you (it never overwrites an existing `.env`). Then skip to the variable table below. To do it by hand instead, copy the example and fill in the two secrets yourself:

**bash:**
```bash
cd backend
cp .env.example .env
```
**PowerShell:**
```powershell
cd backend
Copy-Item .env.example .env
```

Generate two **different** secrets (each must be at least 32 characters) and paste them into `.env` as `JWT_SECRET` and `OTP_HMAC_SECRET`. Run this command twice:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The server refuses to start while either still contains the `REPLACE_ME` placeholder, and refuses if both are equal.

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` or `production`. `npm test` sets `test`. |
| `PORT` / `HOST` | `4000` / `0.0.0.0` | Listen address. `0.0.0.0` lets an emulator or phone reach the API. |
| `DATABASE_URL` | see `.env.example` | Development database. **Never read when `NODE_ENV=test`.** |
| `TEST_DATABASE_URL` | see `.env.example` | Used only by the tests. Its database name must end in `_test`. |
| `JWT_SECRET` | *(required)* | Signs access tokens (HS256). ≥ 32 characters. |
| `OTP_HMAC_SECRET` | *(required)* | Keys the hash that protects stored one-time codes. ≥ 32 characters, different from `JWT_SECRET`. |
| `JWT_TTL_SECONDS` | `604800` (7 days) | Session lifetime. |
| `OTP_TTL_SECONDS` | `300` | How long a code is valid. |
| `OTP_MAX_ATTEMPTS` | `5` | Wrong guesses before a code is locked. |
| `OTP_RESEND_COOLDOWN_SECONDS` | `60` | Minimum gap between code requests per phone. |
| `OTP_MAX_REQUESTS_PER_HOUR` | `5` | Code requests per phone per hour. |
| `APP_TIMEZONE` | `Asia/Kolkata` | Defines "today" for overdue calculations. Any IANA name. |
| `CORS_ORIGINS` | *(empty)* | Comma-separated browser origins. Native apps send no `Origin`, so this only matters for Expo web. |
| `LOG_LEVEL` | `info` | `fatal` … `trace`, or `silent`. |

### Mobile: `mobile/.env` (optional)

The only setting is where the API is. If you leave it unset, the app uses `http://10.0.2.2:4000` on Android (the emulator's address for your computer) and `http://localhost:4000` elsewhere.

```bash
cd mobile
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
```

```
EXPO_PUBLIC_API_URL=http://10.0.2.2:4000
```

`EXPO_PUBLIC_*` values are compiled into the app and are visible to anyone who has it. Never put a secret there. See [Android networking](#14-android-networking) for the right value for a phone.

## 9. Create the schema (migrations)

From `backend/`. This applies the five SQL files in `backend/migrations/` to the **development** database named by `DATABASE_URL`.

```bash
npm run migrate:up
```

Expected: it lists `1760000000001_create-users` through `1760000000005_add-loan-receipt` and ends with `Migrations complete!`. If you set the project up before receipts existed, run it again: it applies only the new `add-loan-receipt` migration and keeps your data. Running it again is safe (nothing to do).

You do **not** need to migrate the test database by hand: `npm test` does it automatically before the first test. If you want to, `npm run migrate:test:up` does it explicitly.

`npm run migrate:down` rolls back **one** migration (the most recent). It drops that table and its data, so only use it on a database you can lose.

## 10. Start the backend

From `backend/`:

```bash
npm run dev
```

You should see a banner saying mock authentication is active, then a log line `MiniLedger API listening` with port 4000. Keep this terminal open: **the one-time codes appear here**.

Check it:

```bash
curl http://localhost:4000/api/health
```
```json
{"data":{"status":"ok","database":"up","time":"2026-10-22T18:35:40.671Z"}}
```

For a production-style run: `npm run build` then `npm start`.

## 11. Start the mobile app

In a **second** terminal, from `mobile/`:

```bash
npm run android
```

This starts the Expo dev server and opens the app on a running Android emulator (start one first from Android Studio → Device Manager). If you prefer to start the dev server alone:

```bash
npm start
```

then press `a` in that terminal to open Android.

The first start compiles the JavaScript bundle and can take a minute.

**On a physical Android phone with Expo Go:** see [Android networking](#14-android-networking). The project owner ran the app this way over USB (with `adb reverse tcp:4000 tcp:4000` and `EXPO_PUBLIC_API_URL=http://localhost:4000`) and it worked. Expo Go must support Expo SDK 58; `npm run android` installs a matching Expo Go on a USB-connected phone.

## 12. Using the app

1. **Sign in.** Enter a phone number (a 10-digit number is treated as `+91`) and tap *Send verification code*.
2. **Enter the code** that appeared in the backend terminal ([next section](#13-request-and-verify-a-mock-otp)).
3. **Dashboard.** You see Total lent, Total repaid and Overdue at the top, then your loans. A new account is empty.
4. **Add a loan.** Tap *Add loan*, fill in the friend's name, amount and due date, tap *Save loan*. You return to the dashboard with the loan listed and the summary updated.
5. **Mark repaid.** Tap *Mark repaid* on a loan and confirm. The loan moves to *Repaid* and the totals update.
6. **Add a receipt (optional).** On the *Add loan* screen, under *Receipt photo (optional)*, tap *Take photo* or *Choose from gallery*. A small preview appears with its type and size; tap *Remove* to drop it. When you save, the loan is created first and the photo is uploaded right after. To add one later, tap **Add receipt** on any loan row; to look at one, tap **View receipt**. On that screen you can replace the photo with another or remove it. Details in [Receipt upload](#20-receipt-upload).
7. **Sign out** from the top right. After that, the dashboard is unreachable until you sign in again.

Tip: to see an overdue loan, add one with a due date in the past (the date picker allows past dates on purpose).

## 13. Request and verify a mock OTP

1. In the app, enter your number and tap *Send verification code*.
2. Look at the terminal where `npm run dev` is running. A block like this appears:

   ```
   [MiniLedger DEV OTP] +91••••••4170 -> 131084  (valid for 5 min)
   ```

   The number is masked (first digits hidden); match it by the last four digits. The 6-digit code after `->` is the one to type.
3. Type the code in the app and tap *Verify and sign in*.

What to expect: a wrong code shows how many attempts are left (5 in total); after that the code is locked and you request a new one; the *Resend* button is disabled for 60 seconds after each request; codes can be used only once and expire after 5 minutes.

The code is deliberately **not** in the API response and **not** in the structured logs. It is written straight to the terminal by a development-only component that refuses to run when `NODE_ENV=production`.

## 14. Android networking

The app reaches the API over HTTP at the address in `EXPO_PUBLIC_API_URL`. What "your computer" is called depends on where the app runs.

| Where the app runs | `EXPO_PUBLIC_API_URL` | Notes |
|---|---|---|
| **Android emulator** (default) | `http://10.0.2.2:4000` | `10.0.2.2` is the emulator's alias for the computer it runs on. Inside the emulator, `localhost` means the emulator itself, **not** your computer. |
| **Physical phone, same Wi-Fi** | `http://<computer-LAN-IP>:4000` | Find the IP with `ipconfig` (Windows), `ipconfig getifaddr en0` (macOS) or `hostname -I` (Linux), e.g. `http://192.168.1.23:4000`. The backend must listen on `0.0.0.0` (the default). Allow Node through the computer's firewall; Windows asks the first time. The phone and computer must be on the same network, and some guest or campus networks block device-to-device traffic. |
| **Physical phone over USB** | `http://localhost:4000` | Enable USB debugging, then run `adb reverse tcp:4000 tcp:4000` (run it again whenever you re-plug the cable or restart `adb`). Confirmed working by the project owner. Without this, the app waits and then says "The server took too long to respond", because the emulator-only address `10.0.2.2` does not exist on a real phone. |
| iOS simulator | `http://localhost:4000` | Not the target of this project; not tested. |

After changing `mobile/.env`, restart the dev server with a cleared cache so the new value is compiled in:

```bash
npx expo start --clear
```

Quick test that the emulator can reach the API: open Chrome inside the emulator and visit `http://10.0.2.2:4000/api/health`. You should see the JSON above.

## 15. Try the API without the app

Handy for checking the backend on its own, or with Postman. Every route and error is documented in [docs/api.md](docs/api.md); this is the short path. Replace the phone number with any valid number.

**bash:**
```bash
BASE=http://localhost:4000/api

# 1. Ask for a code (then read it in the backend terminal)
curl -s -X POST $BASE/auth/request-otp -H 'Content-Type: application/json' \
  -d '{"phone":"+911234567890"}'

# 2. Exchange the code for a token
curl -s -X POST $BASE/auth/verify-otp -H 'Content-Type: application/json' \
  -d '{"phone":"+911234567890","otp":"123456"}'
# Copy the "token" value from the response:
TOKEN=PASTE_TOKEN_HERE

# 3. Create a loan, list loans, read the summary
curl -s -X POST $BASE/loans -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"friendName":"Asha","amount":"1500.00","dueDate":"2026-12-01"}'
curl -s $BASE/loans   -H "Authorization: Bearer $TOKEN"
curl -s $BASE/summary -H "Authorization: Bearer $TOKEN"

# 4. Mark a loan repaid (use an id from the list)
curl -s -X PATCH $BASE/loans/LOAN_ID/repay -H "Authorization: Bearer $TOKEN"

# 5. Receipt photo: upload (JSON with base64), download, remove.
#    Replace receipt.jpg with any JPEG, PNG or WebP photo up to 5 MB. (macOS: use `base64 -i receipt.jpg`.)
DATA=$(base64 -w0 receipt.jpg)
curl -s -X PUT $BASE/loans/LOAN_ID/receipt -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"contentType\":\"image/jpeg\",\"data\":\"$DATA\"}"
curl -s $BASE/loans/LOAN_ID/receipt -H "Authorization: Bearer $TOKEN" -o downloaded.jpg
curl -s -X DELETE $BASE/loans/LOAN_ID/receipt -H "Authorization: Bearer $TOKEN"
```

**PowerShell** (use `Invoke-RestMethod`; plain `curl` in PowerShell is an alias with different behaviour):
```powershell
$base = "http://localhost:4000/api"

Invoke-RestMethod -Method Post "$base/auth/request-otp" -ContentType "application/json" `
  -Body '{"phone":"+911234567890"}'

$login = Invoke-RestMethod -Method Post "$base/auth/verify-otp" -ContentType "application/json" `
  -Body '{"phone":"+911234567890","otp":"123456"}'
$headers = @{ Authorization = "Bearer $($login.data.token)" }

Invoke-RestMethod -Method Post "$base/loans" -Headers $headers -ContentType "application/json" `
  -Body '{"friendName":"Asha","amount":"1500.00","dueDate":"2026-12-01"}'
(Invoke-RestMethod "$base/loans"   -Headers $headers).data
(Invoke-RestMethod "$base/summary" -Headers $headers).data

# Receipt photo: upload, download, remove (use a real loan id and a JPEG you have)
$data = [Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\receipt.jpg"))
$body = @{ contentType = "image/jpeg"; data = $data } | ConvertTo-Json
Invoke-RestMethod -Method Put "$base/loans/LOAN_ID/receipt" -Headers $headers -ContentType "application/json" -Body $body
Invoke-WebRequest "$base/loans/LOAN_ID/receipt" -Headers $headers -OutFile downloaded.jpg
Invoke-RestMethod -Method Delete "$base/loans/LOAN_ID/receipt" -Headers $headers
```

In Postman: set the request body to *raw → JSON*, and put the token under *Authorization → Bearer Token*.

## 16. Run the tests

Details and results: [docs/testing.md](docs/testing.md).

**Backend** (needs PostgreSQL running and the `miniledger_test` database to exist):

```bash
cd backend
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` runs the real app against the **test** database. It cannot touch the development database: four independent guards (see [docs/testing.md](docs/testing.md)) refuse to run unless the database is named `*_test`, is on this computer, and differs from `DATABASE_URL`.

**Mobile** (no database or server needed; the network is faked at the `fetch` boundary):

```bash
cd mobile
npm run typecheck
npm run lint
npm test
npx expo export --platform android --output-dir dist-check     # checks the app bundles for Android; delete dist-check afterwards
```

Test counts when this was written: backend **382** (14 files), mobile **327** run by default plus **8** opt-in live tests. The receipt feature adds 85 backend tests (image rules, every validation case, upload/replace/remove/download, ownership and login checks, size limits, database constraints) and 115 mobile tests (photo checks, camera and gallery handling, add-loan with a receipt, the receipt screen, the loan-row link, the API calls).

**Optional live check** (mobile client against your running backend; creates one throwaway user and loan in the **development** database, including a receipt upload and download). Start the backend with its output saved to a file, then:

```bash
# terminal 1
cd backend && npm run dev 2>&1 | tee /tmp/miniledger-server.log

# terminal 2
cd mobile
MINILEDGER_LIVE_API=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:4000 \
MINILEDGER_SERVER_LOG=/tmp/miniledger-server.log npx jest tests/contract
```

(PowerShell: set the three variables with `$env:NAME = "value"` first, then run `npx jest tests/contract`.)

## 17. Troubleshooting

The common ones are below; the full list is in [docs/troubleshooting.md](docs/troubleshooting.md).

| Symptom | Likely cause and fix |
|---|---|
| Backend exits with `Invalid environment configuration` | `.env` is missing, or `JWT_SECRET` / `OTP_HMAC_SECRET` still hold the placeholder, are shorter than 32 characters, or are equal. Re-do [step 8](#8-environment-variables). |
| `ECONNREFUSED 127.0.0.1:5432` or `/api/health` says `database: down` | PostgreSQL is not running. `docker compose up -d` or start your local service. |
| `database "miniledger_dev" does not exist` | Create it ([step 7](#7-postgresql-setup)), then `npm run migrate:up`. |
| `EADDRINUSE: address already in use :::4000` | Something is already on port 4000 (often an old `npm run dev`). Stop it, or set `PORT=4001` in `backend/.env` and update `EXPO_PUBLIC_API_URL`. |
| App says "Can't reach the server" | Wrong API address for where the app runs. Emulator: `10.0.2.2`. Phone: your LAN IP. See [step 14](#14-android-networking). |
| "Incorrect code" / "expired" | Use the **newest** code from the backend terminal; a new request invalidates earlier codes. After 5 wrong tries or 5 minutes, request a new one. |
| `Too many` / "Resend code in 42s" | The throttle is working as designed. Wait for the timer. |
| App returns to sign-in saying the session expired | The token was revoked (logout elsewhere) or expired (7 days). Sign in again. |
| "Camera access was not allowed" when tapping *Take photo* | Allow the camera for the app (Android Settings → Apps → Expo Go → Permissions → Camera), or use *Choose from gallery*, which needs no permission. |
| "That photo is too large" | The limit is 5 MB. Photos taken by the app are already compressed; pick a smaller one. |
| "The receipt was not uploaded" | The loan is saved; only the photo failed. On the receipt screen the photo stays and *Try again* resends it. If you left the screen, tap **Add receipt** on the loan. |
| Receipt picture does not appear ("Couldn't load the receipt photo. …") | The message ends with the reason (for example "Can't reach the server" or "Receipt not found."). Tap *Try again*. If the rest of the app works, look at the backend terminal: it logs a `GET …/receipt` line with the status. |
| `npm test` says the test database is unsafe | `TEST_DATABASE_URL` must name a database ending in `_test` on `localhost`/`127.0.0.1`, different from `DATABASE_URL`. |

## 18. Known limitations

Chosen to keep the project focused. Each one is a deliberate trade-off or an unverified area, not a hidden defect.

- **Mock OTP only.** Codes are printed in the server terminal. There is no SMS delivery. The sender is an interface (`OtpSender`), so a real provider is a one-file change, and the mock refuses to run in production.
- **Not run on a device in the build environment.** Nothing was launched on an Android emulator or phone there. The project owner has run the app (before receipts) on a real phone, but layout details, TalkBack, keyboard behaviour on Android's edge-to-edge screens and the native date dialog are otherwise unverified. A manual checklist is in [docs/testing.md](docs/testing.md).
- **Docker Compose not run.** The compose file is included but was not started in the build environment (no Docker daemon). A native PostgreSQL 16 was used instead.
- **`expo-doctor` and `npx expo install` could not run** (the build environment blocks Expo's API host). Dependency versions were taken from the Expo SDK 58 `bundledNativeModules.json` and installed with npm.
- **INR only, one timezone.** The currency is fixed to rupees and "today" uses one configured timezone for everyone.
- **Receipts are stored in the database.** Simple and transactional, and fine for photos of up to 5 MB. A production system with many photos would use object storage (S3 or similar) and keep only a reference in the database. There is no thumbnail generation, one receipt per loan, no virus scanning, and no upload-specific rate limit beyond the global per-IP limit. The photo is sent as base64 inside JSON, which is about a third larger on the wire than the file itself.
- **Receipt camera and gallery not confirmed on a device.** The picker is wired to `expo-image-picker` and unit-tested with the picker mocked; the real camera, permission dialog, gallery and image display were not run in the build environment. If Android closes the app while the camera is open (low memory), the photo is lost and the user simply takes it again.
- **No partial repayments, editing, deleting or pagination.** A loan is either outstanding or repaid; the list returns all of a user's loans.
- **Single token, no refresh.** Sessions last 7 days and then require a new sign-in.
- **Rate limits per IP are in memory.** They reset when the server restarts and are not shared between server instances. Per-phone OTP limits are in the database and do persist.
- **Offline sign-out.** If the phone cannot reach the server when you sign out, the app signs out locally but the server session stays valid until it expires.
- **Plain HTTP in development.** Fine for a local emulator; a deployed app needs HTTPS (and Android release builds block cleartext HTTP by default).
- **`npm audit` reports findings in mobile dev tooling** (see [Security notes](#19-security-notes)).
- **Two additions beyond the approved plan:** an optional `Idempotency-Key` header on `POST /api/loans`, which the app always sends, so a retried request cannot create a duplicate loan; and the optional receipt photo (built after the mandatory features and their tests were done, as requested).

## 19. Security notes

What is in place:

- **OTP:** 6 digits from a cryptographically secure generator; only an HMAC-SHA256 (keyed by `OTP_HMAC_SECRET`) of phone + code is stored; compared in constant time; single use; 5-minute expiry; 5 attempts then lock; per-phone throttling in the database plus per-IP limits; the response to *request code* never contains the code.
- **Sessions:** HS256 JWT with the algorithm pinned (no `alg: none`). The `jti` is a row in `sessions`; **every protected request** verifies the JWT *and* looks the session up, so a logged-out or expired session is rejected immediately. All auth failures return the same generic 401.
- **Authorization:** every loan query includes the signed-in user's id. Another user's loan gives `404`, not `403`, so ids cannot be probed.
- **SQL:** only parameterized queries; no string-built SQL with user input.
- **Money:** exact decimals end to end (`NUMERIC(12,2)` in PostgreSQL, strings in JSON, string-only formatting on the phone). Never floating point.
- **Atomic repayment:** a single `UPDATE … WHERE repaid_at IS NULL` decides the winner, so concurrent or repeated requests cannot double-repay.
- **Validation:** Zod on every request body, parameter and the idempotency header; 10 KB body limit (except the receipt route, below); `helmet`; restrictive CORS.
- **Receipts:** only the loan's owner can upload, see or remove a receipt (another user's loan gives `404`). The image route needs the Bearer token like every other route, and a logged-out session is refused there too. Uploads are accepted only as JPEG, PNG or WebP **after checking the file's own first bytes**, so an SVG, HTML page or renamed file cannot be stored or served; the size is checked before the data is decoded; the route's larger body limit applies only after the user is authenticated; images are served with their stored type, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline` and `Cache-Control: private, no-cache`; the database also enforces type, size and all-or-nothing with `CHECK` constraints.
- **Errors and logs:** one error handler; no stack traces, SQL or secrets in responses. The request log holds method, path, status and duration only: no headers, bodies, tokens or OTPs.
- **Secrets:** `.env` files are git-ignored, only `.env.example` files are committed, and the server refuses placeholder or short secrets. The mobile app holds no secrets; its token is kept in `expo-secure-store` (Android Keystore-backed).
- **Tests cannot hit the dev database** (four layers, see [docs/testing.md](docs/testing.md)).

Things to know:

- The Docker credentials (`miniledger` / `miniledger_local`) are **local-only** and publish only on `127.0.0.1`. Do not reuse them anywhere real.
- **`npm audit` in `mobile/`** reports 49 findings (31 high, 18 moderate), all from three transitive packages in **development tooling**: `braces` and `sprintf-js` (used by Jest and Babel) and `node-forge` (used by the Expo CLI dev server). They run on a developer's machine, not inside the shipped app. There is no non-breaking fix available (`npm audit fix --force` would downgrade Expo). `backend/` reports 0 vulnerabilities in production dependencies.

## 20. Receipt upload

An optional photo of the receipt can be attached to any loan.

### Using it (in the app)

| You want to | Do this |
|---|---|
| Attach a photo while adding a loan | *Add loan* → under **Receipt photo (optional)** tap *Take photo* (camera) or *Choose from gallery*. A preview with the type and size appears; *Remove* drops it. Tap *Save loan*: the loan is saved first, then the photo is uploaded. |
| Add a photo to a loan you already saved | On the dashboard tap **Add receipt** on the loan's row, then take or choose a photo. It uploads straight away. |
| Look at a receipt | Tap **View receipt** on the loan's row. |
| Replace it | On the receipt screen take or choose another photo. |
| Remove it | On the receipt screen tap *Remove receipt* and confirm. |

Receipts can be added to repaid loans too. The camera asks for permission the first time; if you say no, the app tells you and offers the gallery, which needs no permission.

### Rules

- **Types:** JPEG, PNG or WebP. **Size:** at most 5 MB (5,242,880 bytes). Photos taken or chosen in the app are re-compressed to a JPEG at quality 0.6 first, which keeps a readable receipt far below the limit.
- **One receipt per loan.** Uploading again replaces it.
- The phone checks type and size before uploading and says why in words ("That photo is too large (6.0 MB). The maximum is 5.0 MB. Try a smaller photo."). The server checks everything again.

### If something goes wrong

- **The loan is saved but the photo could not be uploaded** (for example the connection dropped): you are returned to the dashboard with a message that stays until dismissed, saying the loan *was* added and that you can tap **Add receipt** on it. Nothing is duplicated.
- **A failed upload from the receipt screen** keeps the photo on screen with a *Try again* button that sends the same photo again.
- **A photo that is too large, not an image, or from a camera that is not allowed** is explained under the buttons and nothing is sent.

### How it works

| Part | What happens |
|---|---|
| Mobile | `expo-image-picker` returns the photo as base64 (`quality 0.6`); `utils/receipt.ts` detects the type from its first bytes and checks the size; `PUT /api/loans/:id/receipt` sends `{ "contentType", "data" }` as JSON with a 60-second timeout (ordinary requests get 15 seconds). To show it, the app downloads the image with the same `fetch` call (and Bearer token) as every other request, turns it into a `data:` address, and gives that to React Native's `Image`; the download is cached per upload time, so a replaced photo is always fetched fresh. (An earlier version handed `Image` the address plus a header and left Android's own image loader to fetch it; on a real phone that showed "Couldn't load the receipt photo", so it was replaced.) |
| API | Three routes, all behind login: `PUT` (add or replace, returns the updated loan), `GET` (the image itself, binary), `DELETE` (remove; safe to repeat). The upload body limit is raised to about 7 MB for that one route and only after authentication; every other route keeps the 10 KB limit. |
| Database | Four columns on `loans` (`receipt_data bytea`, `receipt_content_type`, `receipt_size_bytes`, `receipt_uploaded_at`) added by migration `1760000000005_add-loan-receipt.sql`, with `CHECK` constraints. The loan list never selects the image bytes; it returns only `receipt: { contentType, sizeBytes, uploadedAt }` or `null`. |

Full request and response details: [docs/api.md](docs/api.md#receipts). Schema: [docs/database.md](docs/database.md).

### What this does not do

It stores photos in PostgreSQL, which suits an assignment and small data. At scale you would store files in object storage and keep a reference. See [Known limitations](#18-known-limitations).


Verification commands to run from a clean checkout are in [docs/testing.md](docs/testing.md#how-to-reproduce-the-verification).
