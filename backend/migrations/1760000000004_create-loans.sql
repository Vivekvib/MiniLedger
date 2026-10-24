-- Up Migration
-- Repayment state is derived from repaid_at (NULL = outstanding), so there is no
-- separate boolean that could drift out of sync.
CREATE TABLE loans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  friend_name      text NOT NULL,
  amount           numeric(12, 2) NOT NULL,
  due_date         date NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  repaid_at        timestamptz,
  -- Optional client-supplied key that makes POST /api/loans safe to retry.
  idempotency_key  uuid,
  CONSTRAINT loans_friend_name_length CHECK (char_length(btrim(friend_name)) BETWEEN 1 AND 80),
  CONSTRAINT loans_amount_positive CHECK (amount > 0),
  CONSTRAINT loans_repaid_after_created CHECK (repaid_at IS NULL OR repaid_at >= created_at)
);

CREATE INDEX loans_user_due_idx ON loans (user_id, due_date);

-- A key is unique per user; rows without a key are unconstrained.
CREATE UNIQUE INDEX loans_user_idempotency_key_uniq
  ON loans (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Down Migration
DROP TABLE loans;
