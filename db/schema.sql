-- Asso Info Evry - Membership Database Schema
-- D1 SQLite

-- Members table
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  student_id TEXT,
  -- Also added by migrate-002-enrollment-number.sql to databases created before
  -- it was part of this schema. Its index (idx_members_enrollment_number) is only
  -- created by that migration: schema.sql runs on every deploy, including against
  -- databases whose column does not exist yet, and an index here would fail there.
  enrollment_number TEXT,
  phone TEXT,
  telegram TEXT,
  discord TEXT,
  enrollment_track TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  approved_at DATETIME,
  expires_at DATETIME,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for email lookups
CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);

-- Membership status history
CREATE TABLE IF NOT EXISTS membership_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by TEXT,
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

-- Application settings
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- `status` is free text on purpose (no CHECK): the values the application reads
-- and writes are listed in src/shared/membership.js (STATUS_LABELS).

-- Insert default settings
-- ('current_year' must equal DEFAULT_ACADEMIC_YEAR in src/shared/membership.js:
-- a test checks it)
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('membership_open', 'true'),
  ('current_year', '2024-2025'),
  ('enrollment_tracks', '["L1 Informatique","L2 Informatique","L3 Informatique","M1 Informatique","M2 Informatique","Autre"]');
