#!/bin/sh
# Elymum container entrypoint. Hosts such as Render mount the persistent disk owned by root. Started as
# root, make DATA_DIR (journal, contracts registry, server key, site data) writable for the unprivileged
# `node` user, then drop to it; started as any other user, run as is.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "${DATA_DIR:-/data}"
  chown -R node:node "${DATA_DIR:-/data}"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
