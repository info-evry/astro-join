# Join - Asso Info Evry Membership System

Système d'adhésion pour l'Association Info Evry. Cette application permet aux étudiants de soumettre des demandes d'adhésion et aux administrateurs de gérer les membres.

## Tech Stack

- **Framework**: Astro 5.x
- **Runtime**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **Design**: Shared design system (git submodule)

## Structure

```
join/
├── src/
│   ├── api/          # API handlers
│   ├── layouts/      # Astro layouts
│   ├── lib/          # Utilities (router)
│   ├── pages/        # Astro pages
│   └── shared/       # Response helpers
├── db/               # Database schema
├── design/           # Design system (submodule)
├── knowledge/        # Association data (submodule)
├── public/           # Static assets
└── test/             # API tests
```

## Features

### Public
- Landing page with membership benefits
- Application form with validation
- Contact information collection

### Admin (`/manage`)
- Authentication with admin token
- View pending applications
- Approve/reject applications individually or in batch
- Edit member information
- Export members to CSV
- Filter by status and enrollment track

## Development

### Prerequisites

- [Bun](https://bun.sh/) or Node.js
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

### Setup

1. Clone with submodules:
```bash
git clone --recursive <repo-url>
```

2. Install dependencies:
```bash
bun install
```

3. Initialize the local database:
```bash
bun run db:init
```

4. Start development server:
```bash
bun run dev
```

### Testing

```bash
# Build first (required for workers tests)
bun run build

# Run tests
bun run test

# Run tests in watch mode
bun run test:watch
```

### Environment Variables

Set the admin token as a secret:
```bash
wrangler secret put ADMIN_TOKEN
```

## API Endpoints

### Public

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/config` | Get membership configuration |
| GET | `/api/stats` | Get public membership stats |
| POST | `/api/apply` | Submit membership application |

### Admin (requires Authorization header)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/members` | List all members with stats |
| GET | `/api/admin/stats` | Detailed admin stats |
| GET | `/api/admin/export` | Export members to CSV |
| GET | `/api/admin/settings` | Get settings |
| PUT | `/api/admin/members/:id` | Update member |
| PUT | `/api/admin/settings` | Update settings |
| POST | `/api/admin/members/batch` | Batch update members |
| DELETE | `/api/admin/members/:id` | Delete member |

## Deployment

See [docs/deploy.md](docs/deploy.md) for deployment instructions.

## License

MIT - Asso Info Evry
