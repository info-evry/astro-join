# Join - Asso Info Evry Membership Portal

Membership application system for Association Info Evry. Students can apply for membership and administrators can manage applications.

**Live site**: https://asso.info-evry.fr/adhesion

## Features

### Public
- Membership benefits overview
- Application form with validation
- Contact information collection (email, phone, Discord, Telegram)
- Enrollment track selection
- Mobile-responsive glassmorphism design
- SF Symbols icons

### Admin Dashboard (`/manage`)
- Secure authentication with admin token
- View and filter applications by status
- Approve/reject applications individually or in batch
- Edit member information
- Assign bureau roles (president, treasurer, secretary, etc.)
- Export members to CSV
- Real-time statistics

## Tech Stack

- **Framework**: Astro 7.x (SSR mode)
- **Runtime**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **Design**: Shared design system via the maestro Bun workspace (`@info-evry/astro-design`)
- **Content**: Shared knowledge base via the maestro Bun workspace (`@info-evry/knowledge`)
- **Testing**: Vitest with Cloudflare Workers pool

## Project Structure

```
astro-join/
├── src/
│   ├── pages/
│   │   ├── index.astro       # Public membership page
│   │   ├── manage.astro      # Admin dashboard
│   │   └── api/[...slug].ts  # API route handler
│   ├── api/                  # API handlers
│   │   ├── admin.js          # Admin members, batch, stats and settings
│   │   ├── admin-csv.js      # Admin CSV export / import
│   │   ├── apply.js          # Application submission
│   │   └── members.js        # Public config and stats
│   ├── lib/                  # Worker-only helpers (admin auth options, settings reader, counters, SQL)
│   │   (router, auth, csv, ids, d1, validation, rate limiting and error helpers come from `astro-core`)
│   ├── shared/
│   │   └── membership.js     # Membership model used by the Worker AND the dashboard (see below)
│   ├── client/               # Browser code: public form and admin dashboard
│   ├── layouts/
│   │   ├── BaseLayout.astro  # Public layout
│   │   └── AdminLayout.astro # Admin layout
│   └── components/
│       ├── Header.astro      # Site header
│       └── Footer.astro      # Site footer
├── db/
│   ├── schema.sql            # Database schema
│   └── migrate-*.sql         # Migrations
├── test/                     # API tests
├── public/                   # Static assets
└── docs/
    └── setup.md              # Setup guide
```

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- Wrangler CLI (install via Bun: `bunx wrangler`)
- Cloudflare account with Workers and D1 access

### Installation

```bash
# Clone the maestro repo (this project is part of its Bun workspace)
git clone https://github.com/info-evry/astro-maestro.git
cd astro-maestro
bun install
```

### Local Development

#### Via Maestro (recommended)

From the maestro root:
```bash
bun run dev:join
```

This sets up the database, environment variables, and starts the dev server on **port 4322**.
Admin interface at: http://localhost:4322/adhesion/manage (token: `dev-admin-token`)

#### Standalone

```bash
bun run dev
```

See `docs/setup.md` for database configuration.

### Testing

```bash
# Everything: build, Workers API tests, then browser (happy-dom) admin tests
bun run test

# Workers API tests only (needs a fresh `bun run build` first)
bun run test:workers

# Admin dashboard DOM tests only (test/dom, no build needed)
bun run test:dom

# Watch mode
bunx vitest
```

For detailed development and deployment instructions, see [maestro docs](../../docs/DEVELOPMENT.md).

## Environment Configuration

### Cloudflare Bindings

| Binding | Type | Description |
|---------|------|-------------|
| `DB` | D1 Database | SQLite database for members |
| `RATE_LIMIT` | KV Namespace | Fixed-window rate limiting counters for `/api/apply` and `/api/admin/*` |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ADMIN_TOKEN` | Secret token for admin authentication |
| `ADMIN_EMAIL` | Email for admin notifications |
| `REPLY_TO_EMAIL` | Reply-to email for notifications |

### Setting Secrets

```bash
wrangler secret put ADMIN_TOKEN
```

## API Endpoints

### Public

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/config` | Membership configuration |
| `GET` | `/api/stats` | Public membership statistics |
| `POST` | `/api/apply` | Submit membership application |

`POST /api/apply` answers `403 membership_closed` while the `membership_open` setting is off; the public form reads `membershipOpen` from `/api/config` and disables itself with an explanation.

### Admin (Authorization header required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/admin/members` | List all members with statistics |
| `GET` | `/api/admin/stats` | Detailed admin statistics |
| `GET` | `/api/admin/settings` | Get settings (typed values: booleans and arrays come back parsed) |
| `PUT` | `/api/admin/settings` | Update settings (atomic) |
| `GET` | `/api/admin/export` | Export members to CSV (`?status=<status>` or `?status=bureau`; any other value is a 400) |
| `POST` | `/api/admin/import` | Import members from CSV (`{ csv }`, 2000 rows maximum) |
| `PUT` | `/api/admin/members/:id` | Update member (fields and/or status, atomic) |
| `DELETE` | `/api/admin/members/:id` | Delete member |
| `POST` | `/api/admin/members/batch` | Batch status change (`{ memberIds, status, reason }`, 1000 ids maximum) |
| `DELETE` | `/api/admin/members/batch` | Batch delete (`{ ids }`, 1000 ids maximum, atomic) |

### Errors

Every error body is `{ error, code }` (`astro-core/http`): `error` is a French message, `code` the stable identifier to switch on
(`invalid_body`, `invalid_id`, `unauthorized`, `not_found`, `conflict`, `payload_too_large`, `internal_error`, plus domain codes such as
`invalid_status`, `invalid_field`, `invalid_track`, `invalid_settings`, `no_changes`, `too_many_ids`, `too_many_rows`, `membership_closed`).
A malformed id (path or body) is `400 invalid_id`, a malformed/null/array JSON body `400 invalid_body`, a duplicate (email, bureau role already
held) `409 conflict`, and a real failure `500 internal_error` whose body never contains the underlying message. (The rate limiter's 429 message
is still English, see astro-core.)

### CSV

The export (`GET /api/admin/export`) is `;`-separated with a UTF-8 BOM, so French Excel opens it correctly. Columns: ID, Prénom, Nom, Email,
Numéro étudiant, Numéro inscription, Cursus, Téléphone, Telegram, Discord, Statut, Notes, Date adhésion, Date approbation, Date expiration.
A cell starting with `= + - @ TAB CR |` is prefixed with `'` (formula injection); phone numbers are left as they are.

The import accepts `,` `;` or tab (detected from the header line), removes that `'` guard, and re-imports its own exports (and the previous comma
format). Prénom, Nom and Email are required; Téléphone, Numéro étudiant, Numéro inscription, Cursus, Telegram, Discord, Statut and Notes are optional
and a blank cell never overwrites a stored value. Existing members are matched by email. A row that cannot be imported (missing field, invalid email,
unknown status label, field too long, bureau role already taken) is reported as `Ligne N : ...` and skipped; the others are written in batches.
Members who become active are approved (`approved_at`, `expires_at`) and every status change is written to `membership_history`.

### Rate Limiting

Requests are rate limited using a KV-backed fixed window (see `RATE_LIMIT` binding above):

| Rule | Scope | Limit |
|------|-------|-------|
| `apply` | `POST /api/apply` | 5 requests / 10 minutes per IP |
| `admin` | `/api/admin/*` (any method) | 60 requests / minute per IP |

Requests over the limit receive `429 Too Many Requests` with a `Retry-After` header. If the `RATE_LIMIT` binding is missing (e.g. local dev without KV configured), requests are allowed through and a warning is logged.

### Settings

Settings are stored as key/value rows in the `settings` table and managed via `GET`/`PUT /api/admin/settings`. `PUT` only accepts the following allowlisted keys; unknown keys or invalid values are rejected with `400`:

| Key | Type | Validation |
|-----|------|------------|
| `membership_open` | boolean-ish | `true`, `false`, `'true'`, or `'false'` on write; `GET` always returns a real boolean |
| `current_year` | string | Academic year range `YYYY-YYYY` (second year = first + 1), e.g. `2024-2025` |
| `enrollment_tracks` | array of strings | 1-20 entries, each a non-empty string up to 60 characters |

`enrollment_tracks` also determines which `enrollmentTrack` values `POST /api/apply` and `PUT /api/admin/members/:id` accept (a member may keep a
track they already have); it falls back to `DEFAULT_ENROLLMENT_TRACKS` in `src/shared/membership.js` when unset. The default academic year is
`DEFAULT_ACADEMIC_YEAR` in the same file (a test checks `db/schema.sql` seeds the same value).

## Member Statuses

The vocabulary lives in `src/shared/membership.js`, imported by the Worker and by the dashboard (one table of French labels, one definition of
"active"). `members.status` is free text in the database (no CHECK constraint): the values below are the ones the application reads and writes.

| Status | Description |
|--------|-------------|
| `pending` | Application submitted, awaiting review |
| `active` | Approved active member |
| `honor` | Honorary member |
| `president` | Bureau - President (unique) |
| `vice_president` | Bureau - Vice President (unique) |
| `secretary` | Bureau - Secretary (unique) |
| `treasurer` | Bureau - Treasurer (unique) |
| `honorary_president` | Bureau - Honorary President (several allowed) |
| `rejected` | Application rejected |
| `expired` | Membership expired |

`active`, `honor` and every bureau role count as **active members** (`ACTIVE_STATUSES`): `/api/stats`, the admin members list and the admin
stats all use that one definition. A member entering that set from outside it (pending, rejected, expired) is approved: `approved_at` is set
(SQLite `YYYY-MM-DD HH:MM:SS` UTC, like `created_at`) and `expires_at` is the end of the academic year (31 August, `expiryDateFor`). Moving
between active statuses keeps the dates.

Bureau uniqueness is enforced by an atomic `UPDATE ... WHERE NOT EXISTS` (a second holder is a `409`). The `bureau_positions` table created by
`migrate-001-member-roles.sql` is reserved and unused; it is kept in deployed databases and must not be dropped without a reviewed migration.

## Database Schema

### Members
- `id`, `first_name`, `last_name`, `email`
- `enrollment_track` (L3 Info, M1 Info, etc.)
- `student_id`, `enrollment_number` (student numbers)
- `status` (pending, active, rejected, etc.)
- `discord`, `telegram`, `phone` (contact info)
- `notes`, `created_at`, `approved_at`, `expires_at`

`db/schema.sql` now creates `enrollment_number` itself; `migrate-002-enrollment-number.sql` still adds it (and its index) to databases created
before. On a database built from the schema that migration fails with `duplicate column name`, which must be treated as "already applied".

## Related Repositories

- `astro-core` (`astro-core` workspace package) - Shared code library (Router, helpers)
- `astro-design` (`@info-evry/astro-design` workspace package) - Shared design system
- `astro-knowledge` (`@info-evry/knowledge` workspace package) - Shared content
- `astro-asso` (maestro workspace project) - Association website
- `astro-ndi` (maestro workspace project) - NDI registration platform

## License

AGPL-3.0 - Asso Info Evry
