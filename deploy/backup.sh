#!/usr/bin/env bash
# Ежедневный бэкап базы (пользователи + журнал платежей). На сервере: /etc/cron.d/voin-bot-backup.
# Ноутбук забирает копии скриптом beget-server/scripts/pull-onedash-backups.ps1.
set -euo pipefail
DIR="/opt/voin-bot"
DEST="${DEST:-/var/backups/voin-bot}"
STAMP="$(date +%Y%m%d-%H%M)"
mkdir -p "$DEST"
# sqlite3 .backup корректно снимает копию у работающего бота (WAL), cp — не всегда.
sqlite3 "$DIR/data/users.db" ".backup '$DEST/voin-$STAMP.db'"
find "$DEST" -type f -mtime +30 -delete
echo "$(date '+%F %T') бэкап готов: $DEST/voin-$STAMP.db"
