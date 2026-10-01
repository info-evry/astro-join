-- Migration: Add enrollment_number column for student ID numbers
-- Run: bunx wrangler d1 execute join-db --file=./db/migrate-002-enrollment-number.sql --remote
--
-- NOTE: db/schema.sql now creates members.enrollment_number itself, so on a
-- database freshly built from the schema this ALTER fails with "duplicate column
-- name" (the column already exists): treat that error as "already applied".

-- Add enrollment_number column (student registration number)
ALTER TABLE members ADD COLUMN enrollment_number TEXT;

-- Create index for enrollment_number lookups
CREATE INDEX IF NOT EXISTS idx_members_enrollment_number ON members(enrollment_number);
