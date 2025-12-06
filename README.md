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

- **Framework**: Astro 5.x (SSR mode)
- **Runtime**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **Design**: Shared design system via git submodule
- **Content**: Shared knowledge base via git submodule
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
│   │   └── router.js         # API router
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
├── core/                     # Shared code library (submodule)
├── design/                   # Shared design system (submodule)
├── knowledge/                # Shared content (submodule)
├── test/                     # API tests
├── public/                   # Static assets
└── docs/
    └── setup.md              # Setup guide
```

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (v3+)
- Cloudflare account with Workers and D1 access

### Installation

```bash
# Clone with submodules
git clone --recursive https://github.com/info-evry/astro-join.git
cd astro-join

# Install dependencies
bun install
```

### Local Development

```bash
bun run dev
```

Visit `http://localhost:4321`

### Database Setup

```bash
# Initialize local D1 database
bun run db:init
```

See [docs/setup.md](./docs/setup.md) for production Cloudflare D1 configuration.

### Testing

```bash
# Build first (required for Workers tests)
bun run build

# Run tests
bun run test

# Watch mode
bun run test:watch
```

## Environment Configuration

### Cloudflare Bindings

| Binding | Type | Description |
|---------|------|-------------|
| `DB` | D1 Database | SQLite database for members |

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

- [astro-core](https://github.com/info-evry/astro-core) - Shared code library (Router, helpers)
- [astro-design](https://github.com/info-evry/astro-design) - Shared design system
- [astro-knowledge](https://github.com/info-evry/astro-knowledge) - Shared content
- [astro-asso](https://github.com/info-evry/astro-asso) - Association website
- [astro-ndi](https://github.com/info-evry/astro-ndi) - NDI registration platform

## License

AGPL-3.0 - Asso Info Evry
