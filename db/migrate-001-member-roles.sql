-- Migration: Add member roles (bureau positions)
-- Run: bunx wrangler d1 execute join-db --file=./db/migrate-member-roles.sql --remote

-- Note: SQLite doesn't support ALTER TABLE to modify column constraints
-- The status field will now accept these values:
--   - pending: Awaiting approval
--   - active: Membre actif (approved member)
--   - honor: Membre d'honneur
--   - secretary: Secrétaire (unique)
--   - treasurer: Trésorier (unique)
--   - president: Président (unique)
--   - honorary_president: Président d'honneur (unique)
--   - vice_president: Vice-président (unique)
--   - rejected: Application rejected
--   - expired: Membership expired

-- Create a table to track unique bureau positions
CREATE TABLE IF NOT EXISTS bureau_positions (
  role TEXT PRIMARY KEY,
  member_id INTEGER UNIQUE,
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
);

-- Insert the unique positions (no member assigned initially)
INSERT OR IGNORE INTO bureau_positions (role, member_id) VALUES
  ('secretary', NULL),
  ('treasurer', NULL),
  ('president', NULL),
  ('honorary_president', NULL),
  ('vice_president', NULL);

-- Update existing 'active' statuses to remain as 'active'
-- No data migration needed for status values

-- Add enrollment_number column if it doesn't exist
-- SQLite doesn't have IF NOT EXISTS for columns, so we use a try-catch approach in the app
-- For now, we'll add it via ALTER TABLE (will fail silently if exists when run manually)

-- Create index for role lookups
CREATE INDEX IF NOT EXISTS idx_members_role ON members(status);
