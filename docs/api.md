# API reference

Base URL (local): `http://localhost:4000/api`. From the Android emulator: `http://10.0.2.2:4000/api`.

All requests and responses are JSON. The examples below are real responses captured from the running server (ids and tokens shortened).

## Conventions

**Success:** `{ "data": … }`

**Failure:** `{ "error": { "code": "…", "message": "…", "details": { … } } }`. `details` is present only when it helps. `message` is written for end users; `code` is for programs.

**Authentication:** every route except `GET /health`, `POST /auth/request-otp` and `POST /auth/verify-otp` needs `Authorization: Bearer <token>`. Any problem with the token (missing, malformed, wrong signature, expired, or its session revoked) gives the **same** `401 UNAUTHORIZED`, so the response does not reveal which.

**Money:** always a decimal **string** with two decimals (`"1500.00"`), never a JSON number, in responses. Requests accept a string (`"1500.5"`) or a plain JSON number (`1500`); both are normalised.

**Dates:** `dueDate` is a calendar date `YYYY-MM-DD` (no time zone). `createdAt` and `repaidAt` are ISO-8601 UTC timestamps.

**Phone numbers:** E.164 (`+911234567890`). A bare 10-digit number is read as `+91`. Spaces, dashes and parentheses are ignored.

**Request size:** bodies over 10 KB are refused (`413`). The one exception is the receipt upload (`PUT /loans/:id/receipt`), which accepts about 7 MB, and only after the token has been checked.

## Endpoints at a glance

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | no | Liveness + database check |
| POST | `/auth/request-otp` | no | Send (print) a one-time code |
| POST | `/auth/verify-otp` | no | Exchange phone + code for a token |
| GET | `/auth/me` | yes | The signed-in user |
| POST | `/auth/logout` | yes | Revoke the current session |
| POST | `/loans` | yes | Create a loan |
| GET | `/loans` | yes | List the user's loans |
| PATCH | `/loans/:id/repay` | yes | Mark a loan repaid |
| PUT | `/loans/:id/receipt` | yes | Add or replace the loan's receipt photo |
| GET | `/loans/:id/receipt` | yes | The receipt photo itself (binary image) |
| DELETE | `/loans/:id/receipt` | yes | Remove the receipt photo |
| GET | `/summary` | yes | `totalLent`, `totalRepaid`, `overdueAmount` |

---

## `GET /health`

```bash
curl http://localhost:4000/api/health
```
`200`
```json
{ "data": { "status": "ok", "database": "up", "time": "2026-10-22T18:35:40.671Z" } }
```
`503 SERVICE_UNAVAILABLE` when PostgreSQL cannot be reached.

---

## `POST /auth/request-otp`

Creates a one-time code and prints it **in the API terminal**. The response never contains the code. The response is identical for every valid number, so it does not reveal whether an account exists.

Request:
```json
{ "phone": "+911234567890" }
```
`200`
```json
{ "data": { "expiresInSeconds": 300, "resendAfterSeconds": 60 } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Phone missing or not a valid number. `details.fields.phone` has the message. |
| 429 | `OTP_RESEND_TOO_SOON` | Another code was requested less than 60 s ago. `details.retryAfterSeconds`; `Retry-After` header. |
| 429 | `OTP_REQUEST_LIMIT` | More than 5 codes for this number in the last hour. `details.retryAfterSeconds`. |
| 429 | `RATE_LIMITED` | Per-IP limit (10 requests per 15 minutes on this route). |

A new code **replaces** earlier ones: only the newest unconsumed code can be verified.

---

## `POST /auth/verify-otp`

Request:
```json
{ "phone": "+911234567890", "otp": "131084" }
```
`200`
```json
{
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs…",
    "tokenType": "Bearer",
    "expiresAt": "2026-10-29T18:35:41.000Z",
    "user": { "id": "c07bf68e-8194-49bf-80b2-da7c5b3180f4", "phone": "+919980565025" }
  }
}
```
The user account is created the first time a code is verified for a number.

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Phone invalid, or `otp` is not exactly 6 digits. |
| 401 | `INVALID_OTP` | Wrong code, or no usable code (never requested, already used, or superseded). `details`: `attemptsRemaining`, `locked`. |
| 401 | `OTP_EXPIRED` | The code is older than 5 minutes. |
| 429 | `OTP_ATTEMPTS_EXCEEDED` | The code was locked after 5 wrong guesses (even a correct code is refused). Request a new one. |
| 429 | `RATE_LIMITED` | Per-IP limit (30 requests per 15 minutes on this route). |

Example, wrong code:
```json
{ "error": { "code": "INVALID_OTP",
  "message": "Incorrect code. Check the code and try again.",
  "details": { "attemptsRemaining": 4, "locked": false } } }
```

---

## `GET /auth/me`

`200`
```json
{ "data": { "user": { "id": "c07bf68e-…", "phone": "+919980565025" } } }
```
`401 UNAUTHORIZED` if the token is not valid.

## `POST /auth/logout`

Revokes the session the token belongs to. The same token is refused from then on.
`200`
```json
{ "data": { "loggedOut": true } }
```

---

## `POST /loans`

Request:
```json
{ "friendName": "Asha", "amount": "1500.00", "dueDate": "2026-12-01" }
```

| Field | Rules |
|---|---|
| `friendName` | Trimmed; 1–80 characters; no control characters. |
| `amount` | Greater than 0; at most 10 digits before and 2 after the decimal point (max `9999999999.99`). A string or a JSON number. |
| `dueDate` | A real calendar date `YYYY-MM-DD`, year 2000–2100. Past dates are allowed (recording a loan that is already overdue). |

Optional header **`Idempotency-Key: <UUID>`** makes the call safe to retry. The first call returns `201`. A repeat with the same key and same body returns **`200`** with the **same loan** and the header `Idempotent-Replayed: true`, and creates nothing. The same key with a *different* body gives `422`. Keys are scoped per user. The mobile app always sends one.

`201`
```json
{
  "data": {
    "id": "519a2e9d-3eeb-4633-9a0f-77f4e935d184",
    "userId": "c07bf68e-8194-49bf-80b2-da7c5b3180f4",
    "friendName": "Asha",
    "amount": "1500.00",
    "dueDate": "2026-12-01",
    "createdAt": "2026-10-22T18:35:41.851Z",
    "repaidAt": null,
    "status": "outstanding",
    "daysOverdue": 0,
    "receipt": null
  }
}
```

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Any field invalid, or the `Idempotency-Key` is not a UUID. `details.fields` maps field → message, e.g. `{ "amount": "Amount must be greater than 0." }`. |
| 400 | `INVALID_JSON` | The body is not valid JSON. |
| 401 | `UNAUTHORIZED` | Missing or invalid token. |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 10 KB. |
| 422 | `IDEMPOTENCY_KEY_REUSED` | The key was already used for a different loan. |

### The loan object

| Field | Type | Meaning |
|---|---|---|
| `id`, `userId` | uuid string | |
| `friendName` | string | |
| `amount` | decimal string | Exact, two decimals |
| `dueDate` | `YYYY-MM-DD` | |
| `createdAt` | ISO timestamp | |
| `repaidAt` | ISO timestamp or `null` | `null` = not repaid |
| `status` | `"outstanding"` \| `"overdue"` \| `"repaid"` | Computed by the database. `overdue` = not repaid and `dueDate` is before today in `APP_TIMEZONE`. A loan due today is `outstanding`. A repaid loan is never overdue. |
| `daysOverdue` | integer | Whole days past the due date for overdue loans, otherwise `0` |
| `receipt` | object or `null` | `null` when no photo is attached. Otherwise `{ "contentType": "image/jpeg" \| "image/png" \| "image/webp", "sizeBytes": 2048, "uploadedAt": "<ISO timestamp>" }`. These are details only: the image is never part of the loan JSON (fetch it with `GET /loans/:id/receipt`). |

---

## `GET /loans`

Only the signed-in user's loans. Order: not-repaid loans first, earliest due date first (so overdue ones lead); then repaid loans, most recently repaid first.

`200`
```json
{
  "data": {
    "loans": [
      { "id": "9ebaf65a-…", "userId": "c07bf68e-…", "friendName": "Overdue Friend", "amount": "250.50",
        "dueDate": "2026-10-01", "createdAt": "2026-10-22T18:35:41.911Z", "repaidAt": null,
        "status": "overdue", "daysOverdue": 22, "receipt": null },
      { "id": "519a2e9d-…", "userId": "c07bf68e-…", "friendName": "Smoke Test Friend", "amount": "1500.00",
        "dueDate": "2026-11-01", "createdAt": "2026-10-22T18:35:41.851Z", "repaidAt": "2026-10-22T18:35:41.950Z",
        "status": "repaid", "daysOverdue": 0,
        "receipt": { "contentType": "image/jpeg", "sizeBytes": 2048, "uploadedAt": "2026-10-22T18:36:02.114Z" } }
    ]
  }
}
```
There is no pagination (see the README's known limitations).

---

## `PATCH /loans/:id/repay`

No body. Sets `repaidAt` to now, **atomically**: the database applies the change only if the loan belongs to the user and is not already repaid, so two simultaneous requests produce exactly one success and one `409`.

`200` returns the loan object with `"status": "repaid"` and `repaidAt` set.

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `:id` is not a UUID. |
| 401 | `UNAUTHORIZED` | Missing or invalid token. |
| 404 | `NOT_FOUND` | No such loan **for this user**. Another user's loan gives the same `404`, never `403`, so ids cannot be probed. |
| 409 | `ALREADY_REPAID` | Already repaid. Nothing changed. `details.repaidAt` holds the original repayment time. |

```json
{ "error": { "code": "ALREADY_REPAID",
  "message": "This loan has already been marked as repaid.",
  "details": { "repaidAt": "2026-10-22T18:35:41.950Z" } } }
```

---

## Receipts

An optional photo of a receipt, at most one per loan. Allowed on repaid loans too. All three routes need the Bearer token, and all three give `404 NOT_FOUND` for a loan that is not the signed-in user's (the same answer as for a loan that does not exist).

| Rule | Value |
|---|---|
| Types | `image/jpeg`, `image/png`, `image/webp` |
| Size | at most **5 MB** (5,242,880 bytes) after decoding |
| Check on the bytes | the file's own first bytes must match the declared type, so a text file, SVG or PDF sent as `image/jpeg` is refused |
| Request body | JSON with the image as plain **base64** text (no `data:image/...;base64,` prefix, no line breaks) |

### `PUT /loans/:id/receipt`

Adds the photo, or replaces the one already there. Replacing is all-or-nothing: if the new photo is refused, the old one stays.

Request:
```json
{ "contentType": "image/jpeg", "data": "/9j/4AAQSkZJRgABAQ…" }
```
`200` returns the **loan object** with its new `receipt` (real response, ids shortened):
```json
{
  "data": {
    "id": "5c364742-…", "userId": "9caeed6b-…", "friendName": "Asha", "amount": "1500.00",
    "dueDate": "2026-12-01", "createdAt": "2026-10-23T18:18:39.368Z", "repaidAt": null,
    "status": "outstanding", "daysOverdue": 0,
    "receipt": { "contentType": "image/jpeg", "sizeBytes": 2048, "uploadedAt": "2026-10-23T18:18:39.454Z" }
  }
}
```

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `contentType` is not one of the three types (`details.fields.contentType`), or `data` is missing, empty, not valid base64, over 5 MB, or not really that kind of image (`details.fields.data`). |
| 400 | `INVALID_JSON` | The body is not valid JSON. |
| 401 | `UNAUTHORIZED` | Missing, invalid, expired or revoked token. Checked **before** the body is read, so an unauthenticated large upload is refused cheaply. |
| 404 | `NOT_FOUND` | Not this user's loan, or no such loan. |
| 413 | `PAYLOAD_TOO_LARGE` | The request body is over the upload limit (about 7 MB), far above any allowed photo. |

Real error responses:
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request.",
  "details": { "fields": { "data": "The file is not a valid JPEG image." } } } }

{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request.",
  "details": { "fields": { "data": "The image is too large. The maximum size is 5 MB." } } } }

{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request.",
  "details": { "fields": { "data": "The image data must be base64 text." } } } }

{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request.",
  "details": { "fields": { "contentType": "Content type must be image/jpeg, image/png or image/webp." } } } }
```

### `GET /loans/:id/receipt`

Returns the **image bytes**, not JSON. Real response headers:
```
HTTP/1.1 200 OK
Content-Type: image/jpeg
Content-Length: 2048
Content-Disposition: inline
Cache-Control: private, no-cache
X-Content-Type-Options: nosniff
```
The body is byte-for-byte the photo that was uploaded. `404 NOT_FOUND` ("Receipt not found.") when the loan has no receipt, or is not the user's. The app downloads this route with `fetch` and its Bearer token like every other call, then shows the bytes as a `data:` address. Any query string (for example `?v=…`) is ignored by the server.

### `DELETE /loans/:id/receipt`

Removes the photo. No body. Safe to repeat: removing a receipt that is not there still returns `200` with the loan (`"receipt": null`). `404` only if the loan is not the user's.

### Try it with curl

```bash
# base64 -w0 is GNU/Linux; on macOS use: base64 -i receipt.jpg
DATA=$(base64 -w0 receipt.jpg)
curl -s -X PUT  http://localhost:4000/api/loans/LOAN_ID/receipt -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"contentType\":\"image/jpeg\",\"data\":\"$DATA\"}"
curl -s -o downloaded.jpg http://localhost:4000/api/loans/LOAN_ID/receipt -H "Authorization: Bearer $TOKEN"
curl -s -X DELETE http://localhost:4000/api/loans/LOAN_ID/receipt -H "Authorization: Bearer $TOKEN"
```

---

## `GET /summary`

Calculated by one SQL query over the user's loans using exact `NUMERIC` arithmetic.

`200`
```json
{
  "data": {
    "totalLent": "1750.50",
    "totalRepaid": "1500.00",
    "overdueAmount": "250.50",
    "currency": "INR",
    "asOf": "2026-10-23",
    "timezone": "Asia/Kolkata"
  }
}
```

| Field | Meaning |
|---|---|
| `totalLent` | Sum of **all** the user's loans, repaid or not (everything ever lent) |
| `totalRepaid` | Sum of loans that have been repaid |
| `overdueAmount` | Sum of loans that are not repaid and past their due date |
| `asOf` | The date "today" was taken to be, in `timezone` |

A user with no loans gets `"0.00"` for each total. Outstanding (not yet repaid) is `totalLent − totalRepaid`.

---

## Other errors any route can return

| Status | `code` | When |
|---|---|---|
| 404 | `NOT_FOUND` | Unknown route |
| 429 | `RATE_LIMITED` | Global per-IP limit (300 requests per minute). `Retry-After` header set. |
| 500 | `INTERNAL_ERROR` | Unexpected failure. The message is generic; details go only to the server log. |
| 503 | `SERVICE_UNAVAILABLE` | PostgreSQL unreachable or out of connections. |

## Try it with curl

A complete walk-through (sign in, create, list, summary, repay, logout) is in the [README, section 15](../README.md#15-try-the-api-without-the-app), for both bash and PowerShell.

A few quick negative checks:

```bash
# No token → 401
curl -i http://localhost:4000/api/summary

# Zero amount and an impossible date → 400 with per-field messages
curl -s -X POST http://localhost:4000/api/loans \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"friendName":"X","amount":0,"dueDate":"2026-02-30"}'

# Same Idempotency-Key twice → 201 then 200 with the same id
KEY=$(node -e "console.log(require('crypto').randomUUID())")
for i in 1 2; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:4000/api/loans \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY" \
    -d '{"friendName":"Asha","amount":"10.00","dueDate":"2026-12-01"}'
done
```
