#!/bin/bash
set -e

echo "🚀 Join Info Evry - Deploy Script"
echo "=================================="

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Update submodules
echo -e "${YELLOW}📦 Updating submodules...${NC}"
git submodule update --init --recursive

# Install dependencies
echo -e "${YELLOW}📥 Installing dependencies...${NC}"
bun install

# Build
echo -e "${YELLOW}🔨 Building...${NC}"
bun run build

# Run tests
echo -e "${YELLOW}🧪 Running tests...${NC}"
if bun run test; then
  echo -e "${GREEN}✅ Tests passed${NC}"
else
  echo -e "${RED}❌ Tests failed - aborting deployment${NC}"
  exit 1
fi

# Deploy
echo -e "${YELLOW}🚀 Deploying to Cloudflare...${NC}"
bunx wrangler deploy

echo -e "${GREEN}✅ Deployment complete!${NC}"
