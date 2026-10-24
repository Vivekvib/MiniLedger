-- Runs once, when the Docker data volume is first created.
-- The test suite refuses to run against any database whose name does not end in "_test",
-- so it gets its own database, separate from miniledger_dev.
CREATE DATABASE miniledger_test OWNER miniledger;
