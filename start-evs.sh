#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/evs"
command -v docker >/dev/null || { echo "Install Docker Desktop first"; exit 1; }
make up
echo "creating an AdCut API key (shown once)..."
docker compose -f deploy/compose/compose.yaml -f deploy/compose/compose.floci.yaml run --rm -T migrate \
  pnpm --silent evs keys:create --name adcut --scopes videos:read,videos:write,playback:mint
echo "EVS console: http://localhost:3000   API: http://localhost:8080   -> paste the key in AdCut > Publish"
