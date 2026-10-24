-- Up Migration
-- One row per issued OTP. The code itself is never stored: only an HMAC of phone:code.
CREATE TABLE otp_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        text NOT NULL,
  code_hash    text NOT NULL,
  expires_at   timestamptz NOT NULL,
  attempts     smallint NOT NULL DEFAULT 0,
  locked_at    timestamptz,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT otp_codes_phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT otp_codes_attempts_nonneg CHECK (attempts >= 0)
);

CREATE INDEX otp_codes_phone_created_idx ON otp_codes (phone, created_at DESC);

-- Down Migration
DROP TABLE otp_codes;
