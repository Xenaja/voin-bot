// Рассылка по пользователям AWAIT_PAYMENT в v1
// Запуск: node broadcast-birthday.js
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const db = new DatabaseSync(path.join(__dirname, 'data/users.db'));

const TEXT = `Привет! Это Саша 👋

Сегодня, 14 мая, у меня день рождения 🎂

И я решил сделать так: Код Воина отдаю за 500 рублей.

Не потому что он стал хуже. А потому что хочу, чтобы вы тоже получили пользу, а мне это будет как подарок — что мой продукт уходит в хорошие руки.

Так что если хочешь сделать мне приятно и себе забрать реально рабочий инструмент — действуй.

Акция — только сегодня и завтра. Дальше код снова станет 990 ₽.

С уважением и праздничным настроением,
Саша Боцман

*если возникнет трудность с оплатой — напиши прямо сюда, решим

Жми на кнопку, переводи и потом пиши мне в чат ГОТОВО 👇`;

const PAYMENT_URL = 'https://messenger.online.sberbank.ru/sl/iG5BSZHjgdNGIWbGo';

async function run() {
  const users = db.prepare(
    "SELECT chat_id FROM users WHERE state = 'AWAIT_PAYMENT' AND platform = 'telegram'"
  ).all();

  console.log(`Отправляем ${users.length} пользователям...`);

  let sent = 0, failed = 0;

  for (const { chat_id } of users) {
    try {
      await bot.telegram.sendMessage(chat_id, TEXT, {
        ...Markup.inlineKeyboard([
          Markup.button.url('👉 Внести 500 ₽', PAYMENT_URL),
        ]),
        link_preview_options: { is_disabled: true },
      });
      sent++;
      console.log(`✅ ${chat_id} (${sent}/${users.length})`);
      await new Promise(r => setTimeout(r, 100)); // пауза чтобы не флудить
    } catch (err) {
      failed++;
      console.error(`❌ ${chat_id}: ${err.description || err.message}`);
    }
  }

  console.log(`\nГотово. Отправлено: ${sent}, ошибок: ${failed}`);
  process.exit(0);
}

run();
