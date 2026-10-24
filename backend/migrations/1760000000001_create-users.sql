-- Up Migration
CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT users_phone_unique UNIQUE (phone)
);

-- Down Migration
DROP TABLE users;
