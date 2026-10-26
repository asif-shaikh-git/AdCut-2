#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/adcut"
[ -d node_modules ] || npm install
exec npm run dev -- --host "${HOST:-localhost}"
