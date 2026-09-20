# Setup Guide

## Development Environment

### 1. Install Dependencies

```bash
bun install
```

### 2. Create Local Database

```bash
bun run db:init
```

### 3. Create Environment File

Create `.dev.vars` for local development:

```
ADMIN_TOKEN=local-dev-token
ADMIN_EMAIL=dev@example.com
REPLY_TO_EMAIL=dev@example.com
```

### 4. Start Development Server

```bash
bun run dev
```

Access the app at `http://localhost:4321`

## Cloudflare Setup

### Create D1 Database

```bash
wrangler d1 create join-db
```

Update the database ID in `wrangler.toml`.

### Set Secrets

```bash
wrangler secret put ADMIN_TOKEN
```

### Apply Database Schema (Production)

```bash
bun run db:migrate
```

## Testing

Tests require a built application:

```bash
bun run build
bun run test
```

## Updating Shared Packages

The design system (`@info-evry/astro-design`) and knowledge base (`@info-evry/knowledge`) are
maestro Bun workspace packages under `projects/`. Update them by editing those projects directly
and running `bun install` from the maestro root.
