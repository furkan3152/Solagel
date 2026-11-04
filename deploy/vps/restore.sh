#!/usr/bin/env bash
# Elymum: load a backup (.tar.gz of DATA_DIR) into the elymum-data volume.
#   restore.sh <file.tar.gz>                       a file on this server
#   restore.sh --url <server> --token <token>      download it from the running server first
#                                                  (<server> e.g. https://slana-wo00.onrender.com, or the
#                                                  full .../api/admin/backup URL; token: /admin → Network →
#                                                  Backup & move → Copy migration command)
# Options: --yes (no questions), --no-start (leave the app stopped afterwards).
# The archive is checked first (complete gzip, readable tar, no absolute or '..' paths). If the volume
# already holds data, a safety backup of it is written to /opt/elymum/backups before it is replaced.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"
need_root

file=""
url=""
token=""
yes=0
start=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) url="${2:?--url needs a value}"; shift 2 ;;
    --token) token="${2:?--token needs a value}"; shift 2 ;;
    --yes | -y) yes=1; shift ;;
    --no-start) start=0; shift ;;
    -h | --help) sed -n '2,11p' "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) file="$1"; shift ;;
  esac
done

if [[ -n "$url" ]]; then
  [[ -n "$token" ]] || { read -rsp "Admin session token: " token; echo; }
  [[ -n "$token" ]] || die "a token is needed to download the backup"
  url="${url%/}"
  [[ "$url" == */api/admin/backup ]] || url="$url/api/admin/backup"
  mkdir -p "$ELYMUM_BACKUPS"
  chmod 700 "$ELYMUM_BACKUPS"
  file="$ELYMUM_BACKUPS/migrated-$(date -u +%Y%m%d-%H%M%S).tar.gz"
  log "downloading the backup from ${url%%/api/*}"
  umask 077
  # the token goes through a header file, not the command line (other users could read it in ps)
  hdr="$(mktemp)"
  trap 'rm -f "$hdr"' EXIT
  printf 'Authorization: Bearer %s\n' "$token" >"$hdr"
  curl -fsS --retry 3 --retry-delay 5 -H @"$hdr" "$url" -o "$file" || die "download failed (expired token? wrong URL?)"
  log "downloaded $(du -h "$file" | cut -f1)"
fi
[[ -n "$file" ]] || die "give a backup file, or --url and --token (see --help)"
file="$(readlink -f "$file")"
log "checking $file"
verify_backup "$file"
log "archive OK: $(tar tzf "$file" | wc -l) entries"

image="$ELYMUM_IMAGE"
docker image inspect "$image" >/dev/null 2>&1 || image="debian:bookworm-slim"

if ! docker volume inspect "$ELYMUM_VOLUME" >/dev/null 2>&1; then
  # labelled as compose's own volume, so `docker compose up` uses it without a warning
  docker volume create --label com.docker.compose.project=elymum --label com.docker.compose.volume=elymum-data "$ELYMUM_VOLUME" >/dev/null
fi

was_running=0
if [[ -f "$ELYMUM_COMPOSE" && -f "$ELYMUM_ENV" ]] && [[ -n "$(dc ps --status running -q app 2>/dev/null)" ]]; then
  was_running=1
fi

nonempty="$(docker run --rm --network none --user 0 --entrypoint sh -v "$ELYMUM_VOLUME":/data "$image" -c 'ls -A /data | head -n 1')"
if [[ -n "$nonempty" || "$was_running" -eq 1 ]]; then
  echo
  if [[ "$was_running" -eq 1 ]]; then
    echo "The game server is running on volume $ELYMUM_VOLUME; it will be stopped."
  fi
  echo "The volume $ELYMUM_VOLUME already holds data or is in use."
  echo "It will be backed up to $ELYMUM_BACKUPS first, then REPLACED by $file."
  if [[ "$yes" -ne 1 ]]; then
    read -rp "Type RESTORE to continue: " answer
    [[ "$answer" == "RESTORE" ]] || die "cancelled"
  fi
fi

# no auto-deploy may restart the app while the volume is replaced
if [[ "${ELYMUM_LOCK_HELD:-0}" != "1" ]]; then # (install.sh already holds it)
  mkdir -p "$(dirname "$ELYMUM_LOCK")"
  exec 9>"$ELYMUM_LOCK"
  flock -w 1800 9 || die "another Elymum job held the lock for 30 minutes; try again later"
  export ELYMUM_LOCK_HELD=1
fi

if [[ "$was_running" -eq 1 ]]; then
  log "stopping the game server (it pays out live stake players first)"
  dc stop -t 45 app
fi
if [[ -n "$nonempty" ]]; then
  log "safety backup of the current data"
  "$ELYMUM_DIR/deploy/vps/backup.sh"
fi

log "restoring into volume $ELYMUM_VOLUME"
# shellcheck disable=SC2016 # $1 is expanded by the container's shell
docker run --rm --network none --user 0 --entrypoint sh \
  -v "$ELYMUM_VOLUME":/data \
  -v "$(dirname "$file")":/restore:ro \
  "$image" -c 'find /data -mindepth 1 -delete && tar xzf "/restore/$1" -C /data --no-same-owner && chown -R 1000:1000 /data' sh "$(basename "$file")"
log "restore done"

if [[ "$start" -eq 1 && -f "$ELYMUM_ENV" ]] && docker image inspect "$ELYMUM_IMAGE" >/dev/null 2>&1; then
  log "starting the stack"
  dc up -d
fi
