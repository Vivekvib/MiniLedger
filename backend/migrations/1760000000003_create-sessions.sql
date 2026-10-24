-- Up Migration
-- `id` doubles as the JWT `jti`. Revoking a session (logout) sets revoked_at, and the
-- auth middleware checks this table on every protected request.
CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Down Migration
DROP TABLE sessions;
