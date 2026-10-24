# Database

PostgreSQL 16. The schema lives in plain SQL files in [`backend/migrations/`](../backend/migrations) and is applied with `node-pg-migrate`. The API talks to it through `pg` with parameterized queries only; there is no ORM.

## Entity relationships

```
users 1 ──────< sessions        a user can have many sessions (one per sign-in)
users 1 ──────< loans           a user can have many loans
otp_codes                       no foreign key: codes exist before the user does (see below)
```

Deleting a user cascades to their sessions and loans. (There is no delete-user endpoint; this protects the data if a user is removed by hand.)

## Tables

### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `phone` | `text` NOT NULL | E.164, unique |
| `created_at` | `timestamptz` | default `now()` |

Constraints: `users_phone_e164` (`phone ~ '^\+[1-9][0-9]{7,14}$'`), `users_phone_unique`.
A row is created the first time a code is **verified** for a number, not when a code is requested, so requesting codes cannot be used to find out which numbers have accounts.

### `otp_codes`

One row per code issued.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `phone` | `text` NOT NULL | E.164 (same check as `users`) |
| `code_hash` | `text` NOT NULL | HMAC-SHA256 of `phone:code`, keyed by `OTP_HMAC_SECRET`. **The code itself is never stored.** |
| `expires_at` | `timestamptz` | `created_at + OTP_TTL_SECONDS` |
| `attempts` | `smallint` | wrong guesses so far (≥ 0) |
| `locked_at` | `timestamptz` | set when attempts reach the limit |
| `consumed_at` | `timestamptz` | set on successful use: codes are single-use |
| `created_at` | `timestamptz` | |

Index: `otp_codes_phone_created_idx (phone, created_at DESC)`, which serves both "newest code for this phone" and the throttling counts.

Verification selects the newest code for the phone `FOR UPDATE`, so two simultaneous guesses are serialised and every failed attempt is counted. Codes older than a day are deleted opportunistically when a new code is issued.

### `sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | **Also the JWT `jti`** |
| `user_id` | `uuid` NOT NULL | FK → `users(id)` ON DELETE CASCADE |
| `created_at` | `timestamptz` | |
| `expires_at` | `timestamptz` | `created_at + JWT_TTL_SECONDS`; check `expires_at > created_at` |
| `revoked_at` | `timestamptz` | set by logout |

Index: `sessions_user_idx (user_id)`.
A session is *active* when it exists, belongs to the token's user, `revoked_at IS NULL` and `expires_at > now`. The API checks this on every protected request.

### `loans`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` NOT NULL | FK → `users(id)` ON DELETE CASCADE |
| `friend_name` | `text` NOT NULL | trimmed length 1–80 |
| `amount` | `numeric(12,2)` NOT NULL | `> 0` |
| `due_date` | `date` NOT NULL | a calendar date, no time zone |
| `created_at` | `timestamptz` | |
| `repaid_at` | `timestamptz` | `NULL` = outstanding; must be `>= created_at` |
| `idempotency_key` | `uuid` | optional, for safe retries of `POST /loans` |
| `receipt_data` | `bytea` | the receipt photo; `NULL` = no receipt. **Never selected by the list queries.** |
| `receipt_content_type` | `text` | `image/jpeg`, `image/png` or `image/webp` |
| `receipt_size_bytes` | `integer` | 1 to 5,242,880, and equal to the real size of `receipt_data` |
| `receipt_uploaded_at` | `timestamptz` | when the photo was last added or replaced |

Constraints: `loans_friend_name_length`, `loans_amount_positive`, `loans_repaid_after_created`, and for receipts `loans_receipt_all_or_none` (the four receipt columns are all set or all `NULL`), `loans_receipt_content_type` (only the three image types) and `loans_receipt_size` (1 byte to 5 MiB, and `receipt_size_bytes = octet_length(receipt_data)`). The API checks all of this first; the constraints are the last line of defence, and a test tries to break each one directly.

Indexes:
- `loans_user_due_idx (user_id, due_date)`: the loan list and the summary scan one user's loans.
- `loans_user_idempotency_key_uniq (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`: a partial unique index. A key can be used once per user; rows without a key are unconstrained. It is what makes retried creates atomic (`INSERT … ON CONFLICT DO NOTHING`).

**Why the receipt is in the table.** One loan has at most one photo of at most 5 MB, so a `bytea` column keeps it in the same transaction and backup as the loan, with no second storage system and no orphaned files. PostgreSQL stores large values out of line (TOAST), and the list and summary queries never read `receipt_data` (the column list is explicit, never `SELECT *`), so they stay fast whatever is stored. At scale you would move files to object storage and keep only a reference here.

**There is no `status` or `is_repaid` column.** Whether a loan is repaid is `repaid_at IS NOT NULL`. One fact stored one way cannot get out of sync with itself.

## Migrations

| File | Creates |
|---|---|
| `1760000000001_create-users.sql` | `users` |
| `1760000000002_create-otp-codes.sql` | `otp_codes` + index |
| `1760000000003_create-sessions.sql` | `sessions` + index |
| `1760000000004_create-loans.sql` | `loans` + both indexes |
| `1760000000005_add-loan-receipt.sql` | the four receipt columns and their three `CHECK` constraints on `loans` |

Each file has an `-- Up Migration` and a `-- Down Migration` section.

```bash
cd backend
npm run migrate:up          # apply everything not yet applied, to DATABASE_URL
npm run migrate:down        # roll back ONE migration (drops that table, or for the receipt migration the receipt columns, and their data)
npm run migrate:test:up     # same as migrate:up, but for TEST_DATABASE_URL
```

`node-pg-migrate` records applied files in a `pgmigrations` table, so `migrate:up` is safe to repeat. Never edit an applied migration; add a new file instead. `npm test` applies the migrations to the test database itself before the first test.

## Financial calculation rules

1. **Money is exact.** Stored as `NUMERIC(12,2)`, moved through JSON as a **string**, and formatted on the phone from the string. No floating-point number ever holds an amount. (`0.1 + 0.2` problems cannot happen.)
2. **Input.** At most 10 digits before and 2 after the decimal point; greater than zero. `1500`, `1500.5` and `"1500.50"` are all accepted and stored as `1500.50`. A value with more than 2 decimals is **rejected**, not rounded.
3. **Summary is computed in SQL** by a single query, so the three totals come from the same consistent snapshot:

   ```sql
   SELECT
     COALESCE(SUM(amount), 0)                                          AS total_lent,
     COALESCE(SUM(amount) FILTER (WHERE repaid_at IS NOT NULL), 0)     AS total_repaid,
     COALESCE(SUM(amount) FILTER (WHERE repaid_at IS NULL
                                    AND due_date < $today::date), 0)   AS overdue_amount
   FROM loans WHERE user_id = $1;
   ```
   (each cast `::numeric(18,2)::text`, so an empty result is `"0.00"`).

4. **"Overdue" has one definition**, shared by the loan list and the summary (`backend/src/modules/loans/loan-sql.ts`):

   > overdue ⇔ `repaid_at IS NULL` **and** `due_date < today`

   - `today` is the calendar date in `APP_TIMEZONE` (default `Asia/Kolkata`), computed by the application clock and passed in as a `DATE` parameter. It is **not** the database server's local date and not UTC, so a loan due today turns overdue at midnight India time, wherever the server runs.
   - A loan due **today** is not overdue; it becomes overdue when the day rolls over.
   - A **repaid** loan is never overdue, whatever its due date.
   - `daysOverdue` is `today − due_date` in whole days, only for overdue loans.
5. **Repayment is atomic.** One statement decides the outcome:

   ```sql
   UPDATE loans SET repaid_at = GREATEST($now, created_at)
    WHERE id = $1 AND user_id = $2 AND repaid_at IS NULL
   RETURNING …;
   ```
   (`GREATEST` keeps `repaid_at >= created_at` even if the server clock steps backwards.) Zero rows means "not yours or doesn't exist" (`404`) or "already repaid" (`409`); the code tells them apart with a follow-up read. Two simultaneous requests cannot both succeed because PostgreSQL row-locks the first and the second re-checks `repaid_at IS NULL` afterwards.
6. **Creation is idempotent on request.** With an `Idempotency-Key`, the insert uses the partial unique index; a conflict returns the existing loan if the details match (`200`, replayed) and `422` if they differ.

## Inspecting the data

```bash
psql postgres://miniledger:miniledger_local@localhost:5432/miniledger_dev
```
```sql
\dt                                   -- list tables
SELECT * FROM pgmigrations;           -- applied migrations
SELECT friend_name, amount, due_date, repaid_at FROM loans ORDER BY created_at DESC LIMIT 10;
```
(With Docker: `docker compose exec db psql -U miniledger -d miniledger_dev`.)
