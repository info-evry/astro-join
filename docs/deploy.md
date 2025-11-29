# Deployment Guide

## Prerequisites

- Cloudflare account
- Wrangler CLI authenticated (`wrangler login`)

## Initial Setup

### 1. Create D1 Database

```bash
wrangler d1 create join-db
```

Copy the `database_id` from the output and update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "join-db"
database_id = "YOUR_DATABASE_ID"
```

### 2. Initialize Database Schema

```bash
wrangler d1 execute join-db --file=./db/schema.sql
```

### 3. Set Admin Token

```bash
wrangler secret put ADMIN_TOKEN
```

Enter a secure token when prompted.

## Deploy

### Using the deploy script

```bash
./deploy.sh
```

### Manual deployment

```bash
bun run deploy
```

## Custom Domain

1. Go to Cloudflare Dashboard > Workers & Pages
2. Select `join-info-evry`
3. Go to Custom Domains
4. Add domain (e.g., `asso.info-evry.fr/join`)

## Monitoring

- View logs: `wrangler tail join-info-evry`
- Check metrics in Cloudflare Dashboard

## Troubleshooting

### Database errors

Check D1 database status:
```bash
wrangler d1 info join-db
```

Run migrations:
```bash
wrangler d1 execute join-db --file=./db/schema.sql
```

### Build errors

Clear build cache:
```bash
rm -rf dist/ .astro/
bun run build
```
