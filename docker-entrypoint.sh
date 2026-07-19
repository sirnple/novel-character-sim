#!/bin/sh
set -e

# SQLite lives on the Railway volume at /app/data (see Dockerfile + mount).
# Fresh volume mounts are root-owned; the app must be able to create novels.db + WAL.
DATA_DIR="${RAILWAY_VOLUME_MOUNT_PATH:-/app/data}"
mkdir -p "$DATA_DIR"

# Best-effort: make the volume writable for the app user (uid 1001) and root.
# chown may fail on some hosts; chmod is enough if we stay root or world-writable.
if chown -R 1001:1001 "$DATA_DIR" 2>/dev/null; then
  true
fi
chmod -R u+rwX,g+rwX "$DATA_DIR" 2>/dev/null || true
# Ensure the directory itself is writable even if recursive chmod skips lost+found
chmod 777 "$DATA_DIR" 2>/dev/null || true

# Prefer dropping privileges when runuser exists (debian slim).
if command -v runuser >/dev/null 2>&1; then
  exec runuser -u nextjs -- "$@"
fi

# Fallback: run as root (still works; volume is writable).
exec "$@"
