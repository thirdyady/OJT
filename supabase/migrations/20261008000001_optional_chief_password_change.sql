BEGIN;
-- The Chief chooses when to rotate the initial password. Keep the private
-- emergency rotation flag, but do not enable it during ordinary provisioning.
ALTER TABLE dtr_private.chief_secret ALTER COLUMN must_change SET DEFAULT false;
UPDATE dtr_private.chief_secret SET must_change = false WHERE must_change;
-- Password/recovery hashes, version, request validation and audit rules remain intact.
COMMIT;
