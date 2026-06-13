#!/bin/sh
set -e

# Ensure the persistent data directory exists and is owned by appuser.
# Database file and the generated app-secret live here. Mount this as a volume
# to persist data across redeploys (see docker-compose.yml / README).
mkdir -p /app/data
chown -R appuser:appgroup /app/data

# Drop to non-root user and exec the command.
exec su-exec appuser "$@"
