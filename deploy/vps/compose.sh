#!/usr/bin/env bash
# docker compose for the Elymum stack, with the right file, project and .env. Examples:
#   /opt/elymum/deploy/vps/compose.sh ps
#   /opt/elymum/deploy/vps/compose.sh logs -f --tail 200 app
#   /opt/elymum/deploy/vps/compose.sh restart app
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"
dc "$@"
