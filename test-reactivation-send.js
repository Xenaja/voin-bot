// РАЗОВЫЙ ТЕСТ ре-активационной цепочки: шлёт указанному chat_id все 5 сообщений
// подряд (с паузой), с кнопкой на @VoinKodBot начиная с оффера. Ничего не пишет в БД.
// Запуск: node test-reactivation-send.js <chat_id>
require('dotenv').config();
const https = require('https');
const { Telegraf, Markup } = require('telegraf');
const messages = require('./core/messages');
const config = require('./config');

const CHAT_ID = process.argv[2];
if (!CHAT_ID) { console.error('Укажи chat_id: node test-reactivation-send.js <chat_id>'); process.exit(1); }

// Тот же IPv4-агент, что и в основном адаптере (у сервера проблемы с IPv6 до api.telegram.org)
const bot = new Telegraf(process.env.TELEGRAM_TOKEN, { telegram: { agent: new https.Agent({ family: 4 }) } });

async function run() {
  for (let step = 0; step < messages.REACTIVATION.length; step++) {
    const text = `[ТЕСТ ${step + 1}/${messages.REACTIVATION.length}]\n\n` + messages.REACTIVATION[step];
    const opts = { link_preview_options: { is_disabled: true } };
    if (step >= 2) {
      const kb = Markup.inlineKeyboard([Markup.button.url(messages.BTN_REACTIVATE, config.REACTIVATE_BOT_LINK)]);
      Object.assign(opts, kb);
    }
    await bot.telegram.sendMessage(CHAT_ID, text, opts);
    console.log(`✅ шаг ${step} отправлен`);
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log('Готово.');
  process.exit(0);
}
run().catch(e => { console.error('Ошибка:', e.message); process.exit(1); });
