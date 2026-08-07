// Ретро-волна акции 07.08.2026: trial-оффер тем, кто пришёл 6–7 августа из сторис
// по НЕакционным ссылкам (лендинг ig/site, прямой /start) и бесплатный вход не увидел.
// Перед запуском TRIAL_END в config.js продлён до 23:59 08.08 + pm2 restart.
//   node broadcast-trial-retro.js --dry — посчитать аудиторию
//   node broadcast-trial-retro.js       — отправить
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { DatabaseSync } = require('node:sqlite');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const db = new DatabaseSync('./data/users.db');
const DRY = process.argv.includes('--dry');

const TEXT = `Привет! Это снова Саша 👋
Ты на днях заглянул ко мне в бота из сторис и, похоже, самое главное прошло мимо тебя: в эти дни в клуб «Первый шаг» можно было зайти бесплатно на целый месяц.
Будет нечестно, если ты пропустишь такую возможность из-за технической неполадки.

Поэтому лично для тебя вход ещё открыт — до конца завтрашнего дня, без оплаты и привязки карты.

Внутри уже идёт игра с архетипами-воинами: выбираешь своего, и всю неделю тебя ждут задания под его характер.
Через месяц сам решишь, оставаться ли дальше за 690 ₽ — без твоего подтверждения ничего не спишется.

Жми на кнопку и ты внутри 👇
<i>Нажимая «Войти в клуб бесплатно», ты соглашаешься с <a href="https://docs.google.com/document/d/1ER2N6yuLuMsZBAb1S6ww5E-4T4CikbZvjxUxK-lHCCQ">офертой</a> и <a href="https://docs.google.com/document/d/1fRv1d2pykL1pzUe2BSQVJqyc9qw4rJOPou6CJUoDvbU">политикой конфиденциальности</a>.</i>`;

const EXCLUDE = new Set(['343054483', '718850812', '1737899880']);

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
    WHERE started_at >= '2026-08-06'
      AND COALESCE(source, '') != 'trial0608'
      AND state NOT IN ('COMPLETED_CLUB', 'COMPLETED_BUNDLE', 'TRIAL_OFFER_SENT')
      AND COALESCE(opt_out, 0) = 0
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
      upsertTrialOffer.run(String(chat_id));
      sent++;
    } catch (e) {
      failed++;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  console.log('Готово. Отправлено:', sent, '| не доставлено (блокировки):', failed);
  process.exit(0);
}
run();
