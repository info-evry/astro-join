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
│   │   ├── admin.js          # Admin CRUD operations
│   │   ├── apply.js          # Application submission
│   │   └── members.js        # Public member stats
│   ├── lib/
│   │   └── settings-defaults.js   # Default values for admin settings
│   │       (router, validation, and rate limiting come from `astro-core`)
│   ├── shared/
│   │   └── response.js       # JSON response helpers
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
# Build first (required for Workers tests)
bun run build

# Run tests with Vitest
bunx vitest run

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

### Admin (Authorization header required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/admin/members` | List all members with statistics |
| `GET` | `/api/admin/stats` | Detailed admin statistics |
| `GET` | `/api/admin/settings` | Get settings |
| `PUT` | `/api/admin/settings` | Update settings |
| `GET` | `/api/admin/export` | Export members to CSV |
| `PUT` | `/api/admin/members/:id` | Update member |
| `DELETE` | `/api/admin/members/:id` | Delete member |
| `POST` | `/api/admin/members/batch` | Batch update members |

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
| `membership_open` | boolean-ish | `true`, `false`, `'true'`, or `'false'` |
| `current_year` | string | Academic year range `YYYY-YYYY` (second year = first + 1), e.g. `2024-2025` |
| `enrollment_tracks` | array of strings | 1-20 entries, each a non-empty string up to 60 characters |

`enrollment_tracks` also determines which `enrollmentTrack` values `POST /api/apply` accepts; it falls back to the defaults in `src/lib/settings-defaults.js` when unset.

## Member Statuses

| Status | Description |
|--------|-------------|
| `pending` | Application submitted, awaiting review |
| `active` | Approved active member |
| `rejected` | Application rejected |
| `expired` | Membership expired |
| `honor` | Honorary member |
| `president` | Bureau - President |
| `vicepresident` | Bureau - Vice President |
| `treasurer` | Bureau - Treasurer |
| `secretary` | Bureau - Secretary |

## Database Schema

### Members
- `id`, `first_name`, `last_name`, `email`
- `enrollment_track` (L3 Info, M1 Info, etc.)
- `enrollment_number` (student ID)
- `status` (pending, active, rejected, etc.)
- `discord`, `telegram`, `phone` (contact info)
- `created_at`, `approved_at`

## Related Repositories

- `astro-core` (`astro-core` workspace package) - Shared code library (Router, helpers)
- `astro-design` (`@info-evry/astro-design` workspace package) - Shared design system
- `astro-knowledge` (`@info-evry/knowledge` workspace package) - Shared content
- `astro-asso` (maestro workspace project) - Association website
- `astro-ndi` (maestro workspace project) - NDI registration platform

## License

AGPL-3.0 - Asso Info Evry
