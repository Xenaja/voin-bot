const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const flow = require('../core/flow');
const store = require('../core/store');
const yookassa = require('../core/yookassa');
const m = require('../core/messages');

let bot;

const pendingReplies = new Map();
const FILE_ID_CACHE_PATH = path.join(__dirname, '../data/tg_file_ids.json');

function loadFileIds() {
  try { return JSON.parse(fs.readFileSync(FILE_ID_CACHE_PATH, 'utf-8')); } catch { return {}; }
}
function saveFileIds(cache) {
  fs.writeFileSync(FILE_ID_CACHE_PATH, JSON.stringify(cache, null, 2));
}
let fileIdCache = loadFileIds();

// ─────────────────────────────────────────────
// SEND
// ─────────────────────────────────────────────

function keyboardFor(msg) {
  if (msg.urlButton) return Markup.inlineKeyboard([Markup.button.url(msg.urlButton.label, msg.urlButton.url)]);
  if (msg.button) return Markup.inlineKeyboard([Markup.button.callback(msg.button.label, msg.button.callback)]);
  return {};
}

async function sendBanner(chatId, file) {
  if (!file || !fs.existsSync(file)) {
    if (file) console.error(`[telegram] нет картинки ${file}`);
    return;
  }
  const key = 'banner_' + file.replace(/[^a-z0-9]/gi, '_');
  try {
    if (fileIdCache[key]) {
      await bot.telegram.sendPhoto(chatId, fileIdCache[key]);
    } else {
      const sent = await bot.telegram.sendPhoto(chatId, { source: file });
      fileIdCache[key] = sent.photo[sent.photo.length - 1].file_id;
      saveFileIds(fileIdCache);
    }
  } catch (err) {
    console.error(`[telegram] banner error: ${err.message}`);
  }
}

// Отправка файла (гайд). Ошибку пробрасываем — поллер/обработчик залогирует,
// а человек сможет запросить файл повторно кнопкой.
async function sendFile(chatId, fileKey) {
  const file = config.FILES[fileKey];
  if (fileIdCache[fileKey]) {
    try {
      await bot.telegram.sendDocument(chatId, fileIdCache[fileKey]);
      return;
    } catch (err) {
      console.error(`[telegram] cached file ${fileKey} failed, reuploading: ${err.message}`);
      delete fileIdCache[fileKey];
    }
  }
  const sent = await bot.telegram.sendDocument(chatId, { source: file, filename: config.GUIDE_FILENAME });
  fileIdCache[fileKey] = sent.document.file_id;
  saveFileIds(fileIdCache);
}

async function send(chatId, result) {
  for (const msg of (result.messages || [])) {
    if (msg.delayBefore) await new Promise(r => setTimeout(r, msg.delayBefore));
    if (msg.banner) await sendBanner(chatId, msg.banner);
    const opts = { ...keyboardFor(msg), link_preview_options: { is_disabled: true } };
    if (msg.parseMode) opts.parse_mode = msg.parseMode;
    await bot.telegram.sendMessage(chatId, msg.text, opts);
  }
  for (const fileKey of (result.files || [])) {
    try {
      await sendFile(chatId, fileKey);
    } catch (err) {
      console.error(`[telegram] file ${fileKey} → ${chatId} error: ${err.message}`);
      await notifyManagerText(`❗ Не удалось отправить PDF: [Telegram] ID: ${chatId} — ${err.message}`);
    }
  }
}

// Создаёт платёж ЮKassa и вешает кнопку оплаты на последнее сообщение результата
async function sendWithPayment(chatId, result) {
  if (!result.createPayment) return send(chatId, result);
  const { label } = result.createPayment;
  // ADMIN_TEST_AMOUNT в .env (например 1) — живая проверка оплаты: такая цена только у админов
  const testAmount = Number(process.env.ADMIN_TEST_AMOUNT) || 0;
  const amount = testAmount > 0 && isAdmin(Number(chatId)) ? testAmount : config.YOOKASSA_AMOUNT_GUIDE;
  // Заглушка оплаты для теста цепочки, пока нет ключей ЮKassa: только админам,
  // кнопка «Купить» сразу ведёт к выдаче PDF. Включается PAYMENT_STUB=true в .env.
  if (!config.YOOKASSA_SHOP_ID && config.PAYMENT_STUB && isAdmin(Number(chatId))) {
    const last = result.messages[result.messages.length - 1];
    last.button = { label, callback: 'stub_pay' };
    return send(chatId, result);
  }
  try {
    if (!config.YOOKASSA_SHOP_ID) throw new Error('YOOKASSA_SHOP_ID не задан');
    const payment = await yookassa.createPayment(chatId, amount);
    store.logPayment(payment.id, chatId, amount);
    store.savePaymentId(chatId, payment.id);
    const last = result.messages[result.messages.length - 1];
    delete last.button;
    last.urlButton = { label, url: payment.confirmation.confirmation_url };
    await send(chatId, result);
  } catch (err) {
    console.error('[yookassa] createPayment error:', err.response ? JSON.stringify(err.response.data) : err.message);
    await send(chatId, result);
    await send(chatId, { messages: [{ text: m.MSG_PAY_UNAVAILABLE, button: { label: m.BTN_RETRY, callback: 'buy_guide' } }] });
  }
}

async function sendText(chatId, text) {
  return bot.telegram.sendMessage(chatId, text, { link_preview_options: { is_disabled: true } });
}

async function notifyManagerText(text) {
  try {
    await bot.telegram.sendMessage(config.MANAGER_TG_ID, text);
  } catch (err) {
    console.error('[telegram] notifyManager error:', err.message);
  }
}

async function notifyManager(chatId, text) {
  const msg = `💬 Сообщение вне сценария\n[Telegram] ID: ${chatId}\n\n"${text}"`;
  const keyboard = Markup.inlineKeyboard([Markup.button.callback('✍️ Ответить', `reply_${chatId}`)]);
  try {
    await bot.telegram.sendMessage(config.MANAGER_TG_ID, msg, keyboard);
  } catch (err) {
    console.error('[telegram] notifyManager error:', err.message);
  }
}

// ─────────────────────────────────────────────
// DISPATCH
// ─────────────────────────────────────────────

function isAdmin(fromId) {
  return config.ADMIN_TELEGRAM_IDS.includes(fromId);
}

async function dispatch(chatId, action, payload, userInfo) {
  console.log(`[dispatch] chatId=${chatId} action=${action}`);
  try {
    const result = flow.handleAction({ chatId, action, payload });
    if (userInfo) store.saveUserInfo(chatId, userInfo);
    await sendWithPayment(chatId, result);
    if (result.notifyManager && result.originalText && String(chatId) !== String(config.MANAGER_TG_ID)) {
      await notifyManager(chatId, result.originalText);
    }
  } catch (err) {
    console.error(`[telegram] dispatch error (${action}):`, err.message);
  }
}

async function handleAdminMsg(text, chatId) {
  const result = await global.adminRouter.handleAdminCommand(text, 'telegram', chatId);
  if (result.file) {
    try {
      const tempDir = path.join(__dirname, '../data/temp');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      const filePath = path.join(tempDir, result.file.filename);
      fs.writeFileSync(filePath, result.file.content, 'utf-8');
      await bot.telegram.sendDocument(chatId, { source: filePath }, { caption: result.text });
      fs.unlinkSync(filePath);
    } catch {
      await bot.telegram.sendMessage(chatId, result.text + '\n\n' + result.file.content);
    }
    return;
  }
  if (result.text) await bot.telegram.sendMessage(chatId, result.text);
}

function registerAction(callbackName, action) {
  bot.action(callbackName, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const chatId = String(ctx.chat.id);
    if (isAdmin(ctx.from.id) && !store.isInTestMode(chatId)) return;
    await dispatch(chatId, action, null, { username: ctx.from.username, firstName: ctx.from.first_name });
  });
}

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────

function start() {
  const telegramOpts = {};
  if (config.TELEGRAM_PROXY) {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    telegramOpts.agent = new HttpsProxyAgent(config.TELEGRAM_PROXY);
    console.log(`[telegram] через прокси ${config.TELEGRAM_PROXY}`);
  }
  bot = new Telegraf(config.TELEGRAM_TOKEN, { telegram: telegramOpts });

  bot.start(async (ctx) => {
    try {
      const chatId = String(ctx.chat.id);
      if (isAdmin(ctx.message.from.id) && !store.isInTestMode(chatId)) {
        await handleAdminMsg('/admin', chatId);
        return;
      }
      await dispatch(chatId, 'START', ctx.startPayload || null, { username: ctx.from.username, firstName: ctx.from.first_name });
    } catch (err) {
      console.error('[telegram] /start error:', err.message);
    }
  });

  bot.command('myid', (ctx) => ctx.reply(`Твой Telegram ID: ${ctx.from.id}`).catch(() => {}));

  bot.command('help', (ctx) => ctx.reply(m.MSG_HELP).catch(err => console.error('[telegram] /help error:', err.message)));

  // /stop — отказ от напоминаний (политика конфиденциальности)
  bot.command('stop', async (ctx) => {
    try {
      const chatId = String(ctx.chat.id);
      if (isAdmin(ctx.message.from.id) && !store.isInTestMode(chatId)) return;
      store.setOptOut(chatId, true);
      await ctx.reply('🔕 Готово. Больше не буду присылать тебе напоминания.\n\nЕсли передумаешь — напиши /start, и всё вернётся.');
    } catch (err) {
      console.error('[telegram] /stop error:', err.message);
    }
  });

  // /delete — удаление своих данных (политика конфиденциальности)
  bot.command('delete', async (ctx) => {
    try {
      const chatId = String(ctx.chat.id);
      if (isAdmin(ctx.message.from.id) && !store.isInTestMode(chatId)) return;
      store.deleteUser(chatId);
      await ctx.reply('🗑 Готово. Все твои данные удалены из бота.\n\nЕсли захочешь вернуться — просто напиши /start.');
    } catch (err) {
      console.error('[telegram] /delete error:', err.message);
    }
  });

  registerAction('consent', 'BTN_CONSENT');
  registerAction('buy_guide', 'BUY');
  registerAction('resend_guide', 'RESEND_GUIDE');

  // Заглушка оплаты (см. sendWithPayment): «оплачено» без денег — только админам
  bot.action('stub_pay', async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const chatId = String(ctx.chat.id);
    if (!config.PAYMENT_STUB || config.YOOKASSA_SHOP_ID || !isAdmin(ctx.from.id)) return;
    const user = store.getUser(chatId);
    if (!user || user.state !== 'AWAIT_PAYMENT_GUIDE') return;
    console.log(`[stub] тестовая «оплата» без денег: ${chatId}`);
    await send(chatId, flow.handlePaymentSuccess({ chatId }));
  });
  // Кнопки из старых сообщений клуба (до 11.2026) — ведём в начало нового пути
  for (const legacy of ['about', 'want', 'pay_club', 'renew_club', 'club_cancel', 'trial_join']) {
    registerAction(legacy, 'START');
  }

  // Менеджер: кнопка «Ответить»
  bot.action(/^reply_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    pendingReplies.set(ctx.from.id, ctx.match[1]);
    await ctx.reply(`✍️ Напишите ответ для ID ${ctx.match[1]}:`);
  });

  bot.on('text', async (ctx) => {
    try {
      const fromId = ctx.message.from.id;
      const text = ctx.message.text;
      const chatId = String(ctx.chat.id);
      const staff = isAdmin(fromId) || fromId === config.MANAGER_TG_ID;

      // Менеджер: ожидает ввода ответа
      if (staff && pendingReplies.has(fromId)) {
        const targetChatId = pendingReplies.get(fromId);
        pendingReplies.delete(fromId);
        try {
          await sendText(targetChatId, text);
          await ctx.reply(`✅ Отправлено ${targetChatId}`);
        } catch (err) {
          await ctx.reply(`❌ Ошибка: ${err.message}`);
        }
        return;
      }

      // Менеджер: reply под уведомлением
      if (staff && ctx.message.reply_to_message) {
        const match = (ctx.message.reply_to_message.text || '').match(/\[Telegram\] ID: (\d+)/i);
        if (match) {
          try {
            await sendText(match[1], text);
            await ctx.reply(`✅ Отправлено ${match[1]}`);
          } catch (err) {
            await ctx.reply(`❌ Ошибка: ${err.message}`);
          }
          return;
        }
      }

      if (isAdmin(fromId)) {
        if (text.startsWith('/')) { await handleAdminMsg(text, chatId); return; }
        if (!store.isInTestMode(chatId)) return;
      }

      await dispatch(chatId, 'TEXT', text, { username: ctx.from.username, firstName: ctx.from.first_name });
    } catch (err) {
      console.error('[telegram] text error:', err.message);
    }
  });

  // Ручной long polling: обрывы связи с Telegram не роняют процесс, просто повтор через 3 с
  let offset = 0;
  async function poll() {
    let delay = 0;
    try {
      const updates = await bot.telegram.getUpdates(25, 100, offset, ['message', 'callback_query']);
      for (const update of updates) {
        offset = update.update_id + 1;
        bot.handleUpdate(update).catch(err => console.error('[telegram] handleUpdate error:', err.message));
      }
    } catch (err) {
      console.error('[telegram] poll error:', err.message);
      delay = 3000;
    }
    setTimeout(poll, delay);
  }

  bot.telegram.deleteWebhook().then(poll).catch(poll);
  console.log('[telegram] bot started (long polling)');

  process.once('SIGINT', () => process.exit(0));
  process.once('SIGTERM', () => process.exit(0));

  return { send, sendWithPayment, sendText, notifyManager, notifyManagerText };
}

module.exports = { start };
