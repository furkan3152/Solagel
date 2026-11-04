#!/usr/bin/env bash
# Elymum at a glance: containers and health, CPU / memory, the deployed commit, the last backup, disk.
#   /opt/elymum/deploy/vps/status.sh
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"
need_root

section() { printf '\n== %s ==\n' "$1"; }

domain="$(env_get GAME_DOMAIN)"
section "Containers"
dc ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}' 2>/dev/null || dc ps

section "CPU / memory"
mapfile -t ids < <(dc ps -q 2>/dev/null)
if [[ "${#ids[@]}" -gt 0 ]]; then
  docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}' "${ids[@]}"
else
  echo "no containers running"
fi

section "Public health check"
if [[ -n "$domain" ]]; then
  if out="$(curl -fsS --max-time 8 "https://$domain/api/health" 2>&1)"; then
    echo "https://$domain/api/health -> $out"
  else
    echo "https://$domain/api/health FAILED: $out"
  fi
else
  echo "GAME_DOMAIN is not set in $ELYMUM_ENV"
fi

section "Deploy"
cd "$ELYMUM_DIR" || exit 1
echo "branch:   $(cat "$ELYMUM_STATE/branch" 2>/dev/null || git rev-parse --abbrev-ref HEAD)"
deployed="$(cat "$ELYMUM_STATE/deployed" 2>/dev/null || true)"
if [[ -n "$deployed" ]]; then
  echo "deployed: $(git log -1 --format='%h %s (%cr)' "$deployed" 2>/dev/null || echo "$deployed") at $(cat "$ELYMUM_STATE/deployed-at" 2>/dev/null || echo '?')"
else
  echo "deployed: (nothing recorded yet)"
fi
if [[ -s "$ELYMUM_STATE/failed" ]]; then
  echo "LAST BUILD FAILED for $(cut -c1-12 "$ELYMUM_STATE/failed"): journalctl -u elymum-update -n 200"
fi
echo "auto-deploy: $(systemctl is-active elymum-update.timer 2>/dev/null || true) (next: $(systemctl show elymum-update.timer -p NextElapseUSecRealtime --value 2>/dev/null || echo '?'))"

section "Backups"
last="$(find "$ELYMUM_BACKUPS" -maxdepth 1 -type f -name 'elymum-data-*.tar.gz' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n 1 | cut -d' ' -f2-)"
if [[ -n "$last" ]]; then
  echo "last:  $(basename "$last") ($(du -h "$last" | cut -f1), $(date -r "$last" '+%F %R'))"
else
  echo "last:  none yet"
fi
echo "count: $(find "$ELYMUM_BACKUPS" -maxdepth 1 -type f -name 'elymum-data-*.tar.gz' 2>/dev/null | wc -l)"
echo "timer: $(systemctl is-active elymum-backup.timer 2>/dev/null || true)"

section "Disk"
df -h / | tail -n 1 | awk '{ print "root: " $3 " used of " $2 " (" $5 ")" }'
docker system df 2>/dev/null || true

section "Recent server log (last 15 lines)"
dc logs --no-color --tail 15 app 2>/dev/null || true
