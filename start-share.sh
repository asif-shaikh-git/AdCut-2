#!/usr/bin/env bash
# Public watch pages for published ads. Needs Node 20+ and an EVS key (the one start-evs.sh printed).
set -euo pipefail
: "${EVS_KEY:?run:  EVS_KEY=evs_xxx ./start-share.sh}"
cd "$(dirname "$0")/share"
export EVS_API="${EVS_API:-http://localhost:8080}" PORT="${PORT:-8090}"
exec node server.mjs
