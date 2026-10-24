-- Up Migration
-- One optional receipt photo per loan, stored with the loan it belongs to. The list queries name
-- their columns explicitly, so the image bytes (kept out of line by PostgreSQL's TOAST storage)
-- are read only when the receipt itself is requested.
--
-- Stored in the database rather than on disk so that a receipt and its loan always change
-- together (one transaction, one backup) and the app needs no upload folder to configure.
ALTER TABLE loans
  ADD COLUMN receipt_data         bytea,
  ADD COLUMN receipt_content_type text,
  ADD COLUMN receipt_size_bytes   integer,
  ADD COLUMN receipt_uploaded_at  timestamptz,
  -- All four columns are set together or all are NULL.
  ADD CONSTRAINT loans_receipt_all_or_none CHECK (
    (receipt_data IS NULL AND receipt_content_type IS NULL
       AND receipt_size_bytes IS NULL AND receipt_uploaded_at IS NULL)
    OR
    (receipt_data IS NOT NULL AND receipt_content_type IS NOT NULL
       AND receipt_size_bytes IS NOT NULL AND receipt_uploaded_at IS NOT NULL)
  ),
  ADD CONSTRAINT loans_receipt_content_type CHECK (
    receipt_content_type IN ('image/jpeg', 'image/png', 'image/webp')
  ),
  -- 5 MiB maximum, and the recorded size must be the real size.
  ADD CONSTRAINT loans_receipt_size CHECK (
    receipt_size_bytes BETWEEN 1 AND 5242880
    AND receipt_size_bytes = octet_length(receipt_data)
  );

-- Down Migration
ALTER TABLE loans
  DROP CONSTRAINT loans_receipt_size,
  DROP CONSTRAINT loans_receipt_content_type,
  DROP CONSTRAINT loans_receipt_all_or_none,
  DROP COLUMN receipt_uploaded_at,
  DROP COLUMN receipt_size_bytes,
  DROP COLUMN receipt_content_type,
  DROP COLUMN receipt_data;
