# Troubleshooting

Find the symptom, read the cause, apply the fix. Commands are for bash; PowerShell equivalents are given where they differ.

Quick health check for the whole chain, in order:

1. PostgreSQL up? `pg_isready` (or `docker compose ps`)
2. Backend up and talking to the database? `curl http://localhost:4000/api/health` → `{"data":{"status":"ok","database":"up",…}}`
3. App can reach the backend? In the emulator's Chrome open `http://10.0.2.2:4000/api/health`.

---

## Setup and environment

### "Invalid environment configuration" when starting the backend

The message lists each problem on its own line. Typical causes:

| Line says | Fix |
|---|---|
| `JWT_SECRET: JWT_SECRET is required.` | There is no `backend/.env`. Run `npm run setup:env` in `backend/` (it creates the file with fresh random secrets), or copy `.env.example` by hand (`cp .env.example .env`; PowerShell: `Copy-Item .env.example .env`) and fill it in. |
| `… still holds the placeholder from .env.example` | Replace `REPLACE_ME…` with a generated secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `… must be at least 32 characters` | The secret is too short. Generate a new one as above. |
| `JWT_SECRET and OTP_HMAC_SECRET must be different values` | Generate two separate secrets. |
| `DATABASE_URL: is required when NODE_ENV=development` | Add `DATABASE_URL=…` (copy it from `.env.example`). |
| `APP_TIMEZONE` error | Use an IANA name such as `Asia/Kolkata`, not `IST`. |

The `.env` file must be in `backend/`, and you must start the server from `backend/` (`npm run dev`).

### Dependency installation fails

- **Wrong Node version:** `node --version` must be 22 or newer (`engines` in both `package.json` files). Install a current LTS.
- **Peer-dependency errors (`ERESOLVE`) in `mobile/`:** versions are pinned for Expo SDK 58 and the committed `package-lock.json` resolves them. Delete `mobile/node_modules` and run `npm install` again without changing any versions. Do **not** run `npm audit fix --force` (it downgrades Expo).
- **Corporate proxy or offline:** `npm config get registry` should be `https://registry.npmjs.org/`. Set `npm config set proxy …` if your network requires one.
- **Windows long paths / antivirus locking files:** move the project to a short path such as `C:\dev\MiniLedger`.

### Port 4000 is already in use (`EADDRINUSE`)

An old backend is still running, or another program uses the port.

```bash
# macOS / Linux
lsof -i :4000
kill <pid>
```
```powershell
# Windows
netstat -ano | findstr :4000
taskkill /PID <pid> /F
```
Or change `PORT=4001` in `backend/.env` and set `EXPO_PUBLIC_API_URL` to the same port in `mobile/.env`.

Expo's dev server (port 8081) can clash the same way; answer **Y** if it offers another port.

---

## PostgreSQL

### Connection refused (`ECONNREFUSED 127.0.0.1:5432`) or `/api/health` shows `503`

PostgreSQL isn't running or isn't on that port.

- Docker: `docker compose up -d`, then `docker compose ps` (status should be *healthy*).
- Local install: start the service (`brew services start postgresql@16`, `sudo systemctl start postgresql`, or *Services* → PostgreSQL on Windows). `pg_isready` should say *accepting connections*.
- Port clash with another PostgreSQL on 5432: stop the other one, or map a different port and update both URLs in `backend/.env`.

The API recovers by itself when the database returns; you do not have to restart it.

### `password authentication failed for user "miniledger"`

The role doesn't exist or its password differs from `DATABASE_URL`. Recreate it ([README §7](../README.md#7-postgresql-setup)), or fix the password in `.env`. With Docker, the role is only created on the **first** start of a volume; if you changed `POSTGRES_PASSWORD` later, either change `.env` back or remove the volume (this **deletes your data**: `docker compose down -v`).

### `database "miniledger_dev" does not exist` (or `miniledger_test`)

Create it:

```bash
psql -U postgres -c "CREATE DATABASE miniledger_dev OWNER miniledger;"
psql -U postgres -c "CREATE DATABASE miniledger_test OWNER miniledger;"
```
With Docker the second database is created from `docker/initdb/` **only when the data volume is first created**; if the volume already existed, run the two commands above via `docker compose exec db psql -U miniledger -d postgres -c "CREATE DATABASE miniledger_test;"`.

### Migration failures

| Message | Cause and fix |
|---|---|
| `relation "users" already exists` | The tables were created by hand or by an older run without the `pgmigrations` bookkeeping table. On a **throwaway** database, drop the schema and migrate again. Never do this on data you care about. |
| `Not run migration … is preceding already run migration …` | Migration files were renamed or a file with an earlier timestamp was added after later ones had run. Keep applied files unchanged; add new files with later timestamps. |
| `permission denied for schema public` | PostgreSQL 15+ no longer lets ordinary roles create tables in `public` by default. Make `miniledger` the database owner (`CREATE DATABASE … OWNER miniledger`) as in the setup steps. |
| `function gen_random_uuid() does not exist` | PostgreSQL older than 13. Install 13 or newer (16 is used). |
| `no such file` / "Cannot find module node-pg-migrate" | Run `npm install` in `backend/`. |

---

## Authentication

### "Incorrect code" even though I typed what I saw

- A **newer request invalidates older codes.** If you pressed *Send* or *Resend* twice, use the code from the **latest** `[MiniLedger DEV OTP]` block.
- The printed number is **masked**; match it to yours by its last four digits. If you have several backend terminals open, make sure you're reading the one that is actually running.
- Codes are single-use. After a successful sign-in the same code is "no valid code".

### "This code has expired"

Codes last 5 minutes (`OTP_TTL_SECONDS`). Go back and request a new one.

### "Too many incorrect attempts … locked"

Five wrong guesses lock the code (`OTP_MAX_ATTEMPTS`). Even the correct code is refused afterwards; request a new code.

### "Resend code in NNs" or `OTP_RESEND_TOO_SOON` / `OTP_REQUEST_LIMIT`

The throttle is working: one code per 60 s and five per hour per phone number. Wait, or while developing raise `OTP_RESEND_COOLDOWN_SECONDS` / `OTP_MAX_REQUESTS_PER_HOUR` in `backend/.env` and restart. A `RATE_LIMITED` response is the per-IP limit; waiting for the `Retry-After` time fixes it (it also resets if you restart the server).

### I can't find the code

Look in the terminal that runs `npm run dev` (or `npm start`), not the Expo terminal. If the backend runs in the background or under a process manager, its output file holds the codes. The code is intentionally **not** in the API response and **not** in the JSON logs.

### The app keeps returning to the sign-in screen: "Your session expired"

Each cause is legitimate: the session was revoked (you logged out on another device or via the API), it passed its 7 days, or the database was reset so the session row no longer exists. Sign in again. If it happens immediately after every sign-in, check that the phone's clock is roughly correct and that `JWT_SECRET` did not change between the two requests (changing it invalidates every token).

### `401 UNAUTHORIZED` from curl or Postman

All token problems give the identical 401 by design. Check: header is exactly `Authorization: Bearer <token>` (no quotes, one space); the token was copied whole (about 250 characters); you haven't logged out; the server's `JWT_SECRET` is unchanged; the token is under 7 days old.

---

## Android networking

### The emulator can't reach the backend ("Can't reach the server")

1. In the emulator's Chrome, open `http://10.0.2.2:4000/api/health`. If that works, the API is fine and the app's URL is wrong. If not, continue.
2. **Use `10.0.2.2`, not `localhost`.** Inside the emulator `localhost` is the emulator itself.
3. Is the backend running and listening on all interfaces? `HOST=0.0.0.0` (the default) in `backend/.env`. A value of `127.0.0.1` still works for the emulator via `10.0.2.2` on most setups, but not for a phone.
4. After editing `mobile/.env`, restart with a cleared cache: `npx expo start --clear` (the value is compiled into the bundle).
5. A VPN or firewall on the computer can block the emulator. Try with them off.

### A physical phone can't reach the computer

1. Phone and computer on the **same Wi-Fi network**, and the network doesn't isolate devices (many guest/campus networks do).
2. Use your computer's **LAN IP**: `ipconfig` (Windows, "IPv4 Address"), `ipconfig getifaddr en0` (macOS Wi-Fi), `hostname -I` (Linux). Set `EXPO_PUBLIC_API_URL=http://192.168.x.x:4000`.
3. Test from the **phone's browser**: `http://192.168.x.x:4000/api/health`. Failing that is a network/firewall problem, not an app problem.
4. **Windows Firewall:** allow Node.js for *Private* networks (the prompt appears the first time the server runs; or *Windows Security → Firewall → Allow an app*).
5. Make sure the backend isn't bound only to `127.0.0.1` (`HOST=0.0.0.0`).
6. **Alternative over USB:** enable USB debugging, run `adb reverse tcp:4000 tcp:4000`, and set `EXPO_PUBLIC_API_URL=http://localhost:4000`.
7. **Symptom of a wrong address: "The server took too long to respond."** The default address `10.0.2.2` exists only inside the Android emulator; a real phone waits for it and times out. Use the LAN IP or the USB route above. `adb reverse` must be run again after unplugging the cable or restarting `adb`.
8. **Expo Go** must be a version that supports Expo SDK 58. If the store version is older, use the emulator or a development build.

### "Network request failed" only on a release build

Android blocks plain `http://` in release builds by default. Development builds and the emulator allow it. A deployed API needs HTTPS.

### The app shows a white or red screen at start

Read the Expo terminal: red-box errors are printed there too. Usual fixes: `npx expo start --clear`; make sure `npm install` completed in `mobile/`; confirm Node 22+.

---

## Receipt photos

### "Camera access was not allowed" / the camera does not open

Android asks for the camera the first time you tap *Take photo*. If you refused, the app says so and offers *Choose from gallery* (no permission needed). To allow it later: Android *Settings → Apps → Expo Go* (or MiniLedger, for an installed build) *→ Permissions → Camera → Allow*. If Android no longer shows the dialog, that settings page is the only way.

### "That photo is too large (N MB). The maximum is 5.0 MB."

Receipts are limited to 5 MB. Photos picked or taken inside the app are already compressed, so this usually means a very high-resolution image from another source. Take a new photo from the app, or pick a smaller one.

### "That file type isn't supported"

Only JPEG, PNG and WebP photos work. A screenshot saved as another type, a PDF or a video is refused.

### "The receipt was not uploaded" (and the loan is saved)

The loan and the photo are two requests; the loan went through, the photo did not (usually a dropped connection or a very slow one). On the receipt screen the photo stays and *Try again* resends it. If you left that screen, tap **Add receipt** on the loan's row and choose the photo again. A big photo on a slow connection can hit the 60-second upload limit; use a smaller photo or a better connection.

### The receipt picture does not appear ("Couldn't load the receipt photo")

The message ends with the reason, for example "Can't reach the server" (the same connection problem as the rest of the app: see *Android networking*), "Receipt not found." (reopen the dashboard to refresh the list) or a sign-in message (the session ended). Tap *Try again*. The picture is downloaded with the same `fetch` call as everything else, from `GET /api/loans/:id/receipt`; the backend terminal logs one `GET …/receipt` line with its status for each attempt. You can also check with `curl` and your token (README §15). If the message says "The photo was downloaded but could not be displayed", the file arrived but Android could not draw it; take or choose the photo again.

### `413` / "Request body is too large" when calling the API with curl

Only the receipt route accepts a large body (about 7 MB); every other route stops at 10 KB. A photo over 5 MB is refused with a clear `400` message instead. Also remember that base64 is about a third larger than the file.

### `column "receipt_data" does not exist`

The database is missing the receipt migration. From `backend/`, run `npm run migrate:up` (it keeps your data and only adds the new columns). For the test database, `npm test` does it itself.

---

## Tests

### `npm test` (backend) fails immediately with "Refusing to run tests…"

This is the safety guard doing its job. `TEST_DATABASE_URL` in `backend/.env` must point at a database whose name **ends in `_test`**, on **localhost/127.0.0.1**, and must differ from `DATABASE_URL`. See [testing.md](testing.md).

### `TEST_DATABASE_URL is not set`

Add it to `backend/.env` (copy the line from `.env.example`). Tests never fall back to `DATABASE_URL`.

### "Could not apply migrations to the test database"

The test database doesn't exist or the role can't reach it. Create it ([README §7](../README.md#7-postgresql-setup)). The message includes the migration tool's own error below it.

### Tests hang or "did not exit"

Make sure PostgreSQL is up, and that no other `npm test` is running against the same test database (the suite runs in-band, one file at a time, and truncates tables between tests).

### Mobile tests: "Cannot find module 'expo-asset'" or similar

Run `npm install` in `mobile/` again; do not install packages one by one with different versions.

### The live contract test says "No one-time code … found"

`MINILEDGER_SERVER_LOG` must be the file holding the backend's terminal output (`npm run dev 2>&1 | tee file`), and the backend must be running against the same `EXPO_PUBLIC_API_URL` you gave the test.

---

## Still stuck?

Collect: the exact error text, the command you ran, the output of `node --version`, `curl http://localhost:4000/api/health`, and the last 20 lines of the backend terminal. Don't paste `.env` files or tokens anywhere.
