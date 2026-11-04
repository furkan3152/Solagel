#!/usr/bin/env bash
# Elymum daily backup (elymum-backup.timer, 04:00; safe to run by hand any time).
# Tars the elymum-data volume through a throwaway container of the app image (no download needed) into
# /opt/elymum/backups/elymum-data-YYYYmmdd-HHMM.tar.gz (mode 600, the file holds the server key) and keeps
# the newest 14. The game keeps running: the journal is written atomically on every change, other stores
# at most 30 s behind. Output goes to journald: journalctl -u elymum-backup -n 50
#
# Offsite copy (optional, not installed): install rclone, `rclone config` a remote (e.g. "b2"), then add
#   rclone copy /opt/elymum/backups b2:elymum-backups --max-age 25h
# to the end of this script, or as a separate timer. Encrypt the remote (rclone "crypt"): the files hold secrets.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"
need_root

KEEP="${KEEP:-14}"
mkdir -p "$ELYMUM_BACKUPS" "$(dirname "$ELYMUM_LOCK")"
chmod 700 "$ELYMUM_BACKUPS"

# wait (at most 30 min) for a running deploy to finish instead of skipping the day
# (restore.sh already holds it when it asks for a safety backup)
if [[ "${ELYMUM_LOCK_HELD:-0}" != "1" ]]; then
  exec 9>"$ELYMUM_LOCK"
  flock -w 1800 9 || die "another Elymum job held the lock for 30 minutes; no backup today"
fi

docker volume inspect "$ELYMUM_VOLUME" >/dev/null 2>&1 || die "volume $ELYMUM_VOLUME does not exist (is the server installed?)"
image="$ELYMUM_IMAGE"
docker image inspect "$image" >/dev/null 2>&1 || image="debian:bookworm-slim"

name="elymum-data-$(date -u +%Y%m%d-%H%M).tar.gz"
tmp="$ELYMUM_BACKUPS/.$name.partial"
umask 077
rm -f "$tmp"
log "backing up volume $ELYMUM_VOLUME to $ELYMUM_BACKUPS/$name"
# tar exit 1 = a file changed while it was read (the archive is still complete)
set +e
docker run --rm --network none --user 0 --entrypoint tar \
  -v "$ELYMUM_VOLUME":/data:ro \
  "$image" czf - --warning=no-file-changed --warning=no-file-removed --ignore-failed-read -C /data . >"$tmp"
rc=$?
set -e
if [[ "$rc" -gt 1 ]]; then
  rm -f "$tmp"
  die "tar failed (exit $rc)"
fi
gzip -t "$tmp" || {
  rm -f "$tmp"
  die "the new backup does not pass gzip -t"
}
chmod 600 "$tmp"
mv "$tmp" "$ELYMUM_BACKUPS/$name"
log "backup done: $name ($(du -h "$ELYMUM_BACKUPS/$name" | cut -f1))"

# keep the newest $KEEP
mapfile -t old < <(find "$ELYMUM_BACKUPS" -maxdepth 1 -type f -name 'elymum-data-*.tar.gz' -printf '%T@ %p\n' | sort -rn | tail -n +"$((KEEP + 1))" | cut -d' ' -f2-)
for f in "${old[@]}"; do
  rm -f -- "$f"
  log "removed old backup $(basename "$f")"
done
