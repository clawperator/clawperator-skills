#!/bin/bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
npx -y tsx "$DIR/get_bedroom_temperature.ts" "$@"
