# Setup Guide

## Development Environment

### 1. Install Dependencies

```bash
bun install
```

### 2. Initialize Git Submodules

If you didn't clone with `--recursive`:

```bash
git submodule update --init
```

### 3. Create Local Database

```bash
bun run db:init
```

### 4. Create Environment File

Create `.dev.vars` for local development:

```
ADMIN_TOKEN=local-dev-token
ADMIN_EMAIL=dev@example.com
REPLY_TO_EMAIL=dev@example.com
```

### 5. Start Development Server

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

## Updating Submodules

To update the design system or knowledge base:

```bash
git submodule update --remote design
git submodule update --remote knowledge
```
