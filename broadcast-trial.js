// Разовая рассылка 06.08.2026: предложить бесплатный месяц (акция trial) всей базе,
// кроме действующих участников клуба, отписавшихся и уже получивших trial-оффер.
// Каждому успешно получившему ставится state=TRIAL_OFFER_SENT — дальше он живёт в штатной
// trial-механике: кнопка = бесплатный вход до TRIAL_END, last-call, «вход закрыт».
// Запуск на сервере (бот должен работать — он обслуживает кнопку):
//   node broadcast-trial.js --dry   — только посчитать аудиторию
//   node broadcast-trial.js         — отправить
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { DatabaseSync } = require('node:sqlite');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const db = new DatabaseSync('./data/users.db');
const DRY = process.argv.includes('--dry');

const TEXT = `Привет! Это Саша Боцман 👋

У меня для тебя редкая штука: до 13:00 завтрашнего дня (7 августа, по Москве) в мой клуб «Первый шаг» можно зайти бесплатно на целый месяц — без оплаты и карты.

Плюс прямо сейчас там идёт игра с воинами — выбираешь своего, и всю неделю тебя ждут задания под его характер.

Жми ниже, и ты внутри 👇

<i>Нажимая «Войти в клуб бесплатно», ты соглашаешься с <a href="https://docs.google.com/document/d/1ER2N6yuLuMsZBAb1S6ww5E-4T4CikbZvjxUxK-lHCCQ">офертой</a> и <a href="https://docs.google.com/document/d/1fRv1d2pykL1pzUe2BSQVJqyc9qw4rJOPou6CJUoDvbU">политикой конфиденциальности</a>.</i>`;

// Админы получают рассылку только руками через тест — не спамим себе
const EXCLUDE = new Set(['343054483', '718850812']);

const upsertTrialOffer = db.prepare(`
  INSERT INTO users (platform, chat_id, state, updated_at, reminder_count)
  VALUES ('telegram', ?, 'TRIAL_OFFER_SENT', datetime('now'), 0)
  ON CONFLICT(platform, chat_id) DO UPDATE SET
    state          = 'TRIAL_OFFER_SENT',
    updated_at     = datetime('now'),
    reminder_count = 0
`);

async function run() {
  const users = db.prepare(`
    SELECT chat_id FROM users
    WHERE COALESCE(opt_out, 0) = 0
      AND state NOT IN ('COMPLETED_CLUB', 'COMPLETED_BUNDLE', 'TRIAL_OFFER_SENT')
  `).all().filter(u => !EXCLUDE.has(String(u.chat_id)));

  console.log('Аудитория:', users.length, DRY ? '(dry-run, не отправляю)' : '');
  if (DRY) process.exit(0);

  let sent = 0, failed = 0;
  for (const { chat_id } of users) {
    try {
      await bot.telegram.sendMessage(chat_id, TEXT, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([Markup.button.callback('Войти в клуб бесплатно', 'trial_join')]),
        link_preview_options: { is_disabled: true },
      });
      // Стейт меняем только доставленным: заблокировавшие бота остаются как были
      upsertTrialOffer.run(String(chat_id));
      sent++;
    } catch (e) {
      failed++;
    }
    if ((sent + failed) % 100 === 0) console.log(`...${sent + failed}/${users.length} (ok=${sent}, fail=${failed})`);
    await new Promise(r => setTimeout(r, 100));
  }
  console.log('Готово. Отправлено:', sent, '| не доставлено (блокировки и т.п.):', failed);
  process.exit(0);
}
run();
