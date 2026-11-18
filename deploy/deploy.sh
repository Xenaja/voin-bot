#!/usr/bin/env bash
# Выкладка кода на сервер mp-onedash (179.253.173.238). Запуск из корня проекта: bash deploy/deploy.sh
# Не трогает на сервере .env и data/ (база, кэш file_id). После выкладки — рестарт службы.
set -euo pipefail
HOST=${HOST:-mp-onedash}
DIR=/opt/voin-bot
tar --exclude=node_modules --exclude=data --exclude=.env --exclude=.git --exclude=lending --exclude=docs \
    --exclude=mockups --exclude='*.mov' --exclude='*.mp4' -czf /tmp/voin-bot.tgz .
scp -q /tmp/voin-bot.tgz "$HOST:/root/voin-bot.tgz"
ssh "$HOST" "set -e; mkdir -p $DIR/data; tar -xzf /root/voin-bot.tgz -C $DIR; chown -R root:root $DIR; \
  cd $DIR && npm ci --omit=dev --no-audit --no-fund >/dev/null; \
  cp deploy/voin-bot.service deploy/yk-watch.service deploy/yk-watch.timer /etc/systemd/system/; systemctl daemon-reload; \
  chmod +x deploy/backup.sh; cp deploy/voin-bot-backup.cron /etc/cron.d/voin-bot-backup; chmod 644 /etc/cron.d/voin-bot-backup; \
  if systemctl is-enabled --quiet voin-bot; then systemctl restart voin-bot; sleep 3; systemctl is-active voin-bot; else echo 'служба не включена — запуск: systemctl enable --now voin-bot'; fi"
