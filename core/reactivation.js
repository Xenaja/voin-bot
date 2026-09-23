const messages = require('./messages');
const config = require('../config');

// Собирает сообщение шага ре-активационной рассылки.
// Шаги 0..1 (крючок, мостик) — просто текст; шаги 2..4 (оффер + дожимы) — с URL-кнопкой
// на клуб в боте v2 (@VoinKodBot?start=reactivate).
function buildStepMessage(step) {
  const text = messages.REACTIVATION[step];
  if (text === undefined) return null;

  const msg = { text };
  if (step >= 2) {
    msg.urlButton = { label: messages.BTN_REACTIVATE, url: config.REACTIVATE_BOT_LINK };
  }
  return { messages: [msg], files: [] };
}

module.exports = { buildStepMessage };
