#!/usr/bin/env bash
# Elymum auto-deploy (run by elymum-update.timer every 2 minutes; safe to run by hand).
# When the tracked branch moved on GitHub: reset to it, build the new image while the old container keeps
# serving, then swap the container (the server pays out live stake players on SIGTERM). A commit whose
# build fails is not retried until a newer commit arrives; the old container keeps running meanwhile.
# Output goes to journald: journalctl -u elymum-update -n 100
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"
need_root

mkdir -p "$ELYMUM_STATE" "$(dirname "$ELYMUM_LOCK")"
exec 9>"$ELYMUM_LOCK"
if ! flock -n 9; then
  log "another Elymum job (update, backup or install) is running; skipping this check"
  exit 0
fi

cd "$ELYMUM_DIR" || exit 1
branch="$(cat "$ELYMUM_STATE/branch" 2>/dev/null || git rev-parse --abbrev-ref HEAD)"
[[ -n "$branch" && "$branch" != "HEAD" ]] || die "no branch recorded in $ELYMUM_STATE/branch"

app_running() {
  [[ -n "$(dc ps --status running -q app 2>/dev/null)" ]]
}

app_health() {
  local cid
  cid="$(dc ps -q app 2>/dev/null)"
  [[ -n "$cid" ]] || {
    echo "missing"
    return 0
  }
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo "unknown"
}

# installs the systemd units of this checkout when they differ from the installed ones
sync_units() {
  local changed=0 unit
  for unit in "$ELYMUM_DIR"/deploy/vps/systemd/*.service "$ELYMUM_DIR"/deploy/vps/systemd/*.timer; do
    if ! cmp -s "$unit" "/etc/systemd/system/$(basename "$unit")"; then
      install -m 644 "$unit" /etc/systemd/system/
      changed=1
    fi
  done
  if [[ "$changed" -eq 1 ]]; then
    systemctl daemon-reload
    log "systemd units updated"
  fi
}

if ! timeout 120 git fetch --quiet origin "$branch"; then
  log "git fetch failed (network or deploy key); will retry at the next check"
  exit 0
fi
remote="$(git rev-parse "origin/$branch")"
deployed="$(cat "$ELYMUM_STATE/deployed" 2>/dev/null || true)"
failed="$(cat "$ELYMUM_STATE/failed" 2>/dev/null || true)"

if [[ "$remote" == "$deployed" ]]; then
  # nothing new; make sure the stack is up (self-healing after a manual stop or a crash loop)
  if ! app_running; then
    log "app container is not running; starting the stack"
    dc up -d || log "docker compose up failed"
  fi
  exit 0
fi
if [[ "$remote" == "$failed" ]]; then
  exit 0
fi

log "new commit on $branch: ${deployed:0:12} -> ${remote:0:12} ($(git log -1 --format=%s "$remote" | cut -c1-80))"
git reset --hard --quiet "origin/$branch"

log "building the new image (the old container keeps serving)"
if ! dc build app; then
  echo "$remote" >"$ELYMUM_STATE/failed"
  log "BUILD FAILED for ${remote:0:12}; the previous version keeps running. It is retried when a newer commit arrives."
  exit 0
fi

log "swapping the app container (players reconnect in a few seconds)"
if ! dc up -d --remove-orphans; then
  echo "$remote" >"$ELYMUM_STATE/failed"
  log "docker compose up failed for ${remote:0:12}"
  exit 0
fi

# the Caddyfile changed: reload Caddy (no restart, certificates kept)
if [[ -z "$deployed" ]] || ! git diff --quiet "$deployed" "$remote" -- deploy/vps/caddy 2>/dev/null; then
  if dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
    log "Caddy configuration reloaded"
  fi
fi
sync_units

echo "$remote" >"$ELYMUM_STATE/deployed"
rm -f "$ELYMUM_STATE/failed"
date -u +%FT%TZ >"$ELYMUM_STATE/deployed-at"

status="starting"
for _ in $(seq 1 40); do
  status="$(app_health)"
  [[ "$status" == "healthy" ]] && break
  sleep 3
done
log "deployed ${remote:0:12}; app is $status"

# keep the disk clean: dangling images of earlier builds, build cache older than a week
docker image prune -f >/dev/null 2>&1 || true
docker builder prune -f --filter until=168h >/dev/null 2>&1 || true
