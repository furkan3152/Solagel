# shellcheck shell=bash
# Shared settings of the Elymum VPS scripts (sourced, not run).

ELYMUM_DIR="${ELYMUM_DIR:-/opt/elymum}"
ELYMUM_ENV="${ELYMUM_ENV:-$ELYMUM_DIR/.env}"
ELYMUM_COMPOSE="$ELYMUM_DIR/deploy/vps/docker-compose.yml"
ELYMUM_BACKUPS="${ELYMUM_BACKUPS:-$ELYMUM_DIR/backups}"
ELYMUM_STATE="/var/lib/elymum"
ELYMUM_LOCK="/run/lock/elymum.lock"
ELYMUM_VOLUME="elymum-data"
ELYMUM_IMAGE="elymum-app:latest"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

# docker compose with the project's file and .env (for ${GAME_DOMAIN})
dc() {
  docker compose -f "$ELYMUM_COMPOSE" --env-file "$ELYMUM_ENV" "$@"
}

# value of KEY in the .env file (empty when unset)
env_get() {
  local key="$1"
  [[ -f "$ELYMUM_ENV" ]] || return 0
  sed -n "s/^${key}=//p" "$ELYMUM_ENV" | tail -n 1 | sed -e "s/^['\"]//" -e "s/['\"]$//"
}

# sets KEY=VALUE in the .env file (replaces the line, or appends it)
env_set() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp "$ELYMUM_ENV.XXXXXX")"
  if grep -q "^${key}=" "$ELYMUM_ENV" 2>/dev/null; then
    awk -v k="$key" -v v="$value" 'BEGIN { FS = OFS = "=" } $1 == k { print k "=" v; next } { print }' "$ELYMUM_ENV" >"$tmp"
  else
    cat "$ELYMUM_ENV" >"$tmp" 2>/dev/null || true
    printf '%s=%s\n' "$key" "$value" >>"$tmp"
  fi
  chmod 600 "$tmp"
  mv "$tmp" "$ELYMUM_ENV"
}

need_root() {
  [[ "$(id -u)" -eq 0 ]] || die "run this as root (sudo -i first)"
}

# checks that a .tar.gz is complete and holds only relative paths inside the archive
verify_backup() {
  local file="$1" listing
  [[ -s "$file" ]] || die "backup file $file is missing or empty"
  gzip -t "$file" 2>/dev/null || die "$file is not a complete gzip file (truncated download?)"
  listing="$(tar tzf "$file" 2>/dev/null)" || die "$file is not a readable tar archive"
  if grep -Eq '^/|(^|/)\.\.(/|$)' <<<"$listing"; then
    die "$file contains absolute or '..' paths; refusing it"
  fi
  grep -Eq '^(\./)?(server-key\.json|auth-secret|chains/|site/|profiles|leaderboards)' <<<"$listing" ||
    log "warning: $file does not look like an Elymum data directory (no server-key.json, chains/, site/ ...)"
}
