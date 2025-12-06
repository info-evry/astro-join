-- Migration: Add enrollment_number column for student ID numbers
-- Run: bunx wrangler d1 execute join-db --file=./db/migrate-add-enrollment-number.sql --remote

-- Add enrollment_number column (student registration number)
ALTER TABLE members ADD COLUMN enrollment_number TEXT;

-- Create index for enrollment_number lookups
CREATE INDEX IF NOT EXISTS idx_members_enrollment_number ON members(enrollment_number);
