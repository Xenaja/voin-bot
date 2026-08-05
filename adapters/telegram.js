const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const config = require('../config');
const flow = require('../core/flow');
const { handleAdminCommand } = require('../core/admin');
const store = require('../core/store');
const yookassa = require('../core/yookassa');

let bot;

const pendingReplies = new Map();
const FILE_ID_CACHE_PATH = './data/tg_file_ids.json';

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

async function send(chatId, result) {
  for (const msg of (result.messages || [])) {
    // Пауза перед сообщением (авто-цепочка знакомства: Шаг 2 через 3с, Шаг 3 через 5с).
    // Поллинг не блокируется — handleUpdate запускается fire-and-forget.
    if (msg.delayBefore) await new Promise(r => setTimeout(r, msg.delayBefore));

    // Баннер
    if (msg.banner) {
      try {
        const bannerKey = 'banner_' + msg.banner.replace(/[^a-z0-9]/gi, '_');
        if (fileIdCache[bannerKey]) {
          await bot.telegram.sendPhoto(chatId, fileIdCache[bannerKey]);
        } else {
          const sent = await bot.telegram.sendPhoto(chatId, { source: msg.banner });
          fileIdCache[bannerKey] = sent.photo[sent.photo.length - 1].file_id;
          saveFileIds(fileIdCache);
        }
      } catch (err) {
        console.error(`[telegram] banner error: ${err.message}`);
      }
    }

    // Три кнопки (3 тарифа)
    if (msg.buttons3 && msg.buttons3.length) {
      const keyboard = Markup.inlineKeyboard(
        msg.buttons3.map(b => [Markup.button.callback(b.label, b.callback)])
      );
      const opts = { ...keyboard, link_preview_options: { is_disabled: true } };
      if (msg.parseMode) opts.parse_mode = msg.parseMode;
      await bot.telegram.sendMessage(chatId, msg.text, opts);
      continue;
    }

    // URL-кнопка или callback-кнопка
    if (msg.button || msg.urlButton) {
      const btn = msg.urlButton
        ? Markup.button.url(msg.urlButton.label, msg.urlButton.url)
        : Markup.button.callback(msg.button.label, msg.button.callback);
      const keyboard = Markup.inlineKeyboard([btn]);
      const opts = { ...keyboard, link_preview_options: { is_disabled: true } };
      if (msg.parseMode) opts.parse_mode = msg.parseMode;
      await bot.telegram.sendMessage(chatId, msg.text, opts);
      continue;
    }

    // Просто текст
    const opts = { link_preview_options: { is_disabled: true } };
    if (msg.parseMode) opts.parse_mode = msg.parseMode;
    await bot.telegram.sendMessage(chatId, msg.text, opts);
  }

  // Файлы
  for (const fileKey of (result.files || [])) {
    try {
      if (fileIdCache[fileKey]) {
        await bot.telegram.sendDocument(chatId, fileIdCache[fileKey]);
      } else {
        const sent = await bot.telegram.sendDocument(chatId, { source: config.FILES[fileKey] });
        fileIdCache[fileKey] = sent.document.file_id;
        saveFileIds(fileIdCache);
      }
    } catch (err) {
      console.error(`[telegram] file ${fileKey} error: ${err.message}`);
    }
  }

  for (const msg of (result.trailingMessages || [])) {
    await bot.telegram.sendMessage(chatId, msg.text, { link_preview_options: { is_disabled: true } });
  }
}

// Отправка с созданием платежа ЮКасса
async function sendWithPayment(chatId, result) {
  if (result.createPayment && config.YOOKASSA_SHOP_ID) {
    const product = result.createPayment;
    const amount = config[`YOOKASSA_AMOUNT_${product.toUpperCase()}`] || config.YOOKASSA_AMOUNT_CLUB;
    // save_payment_method передаём только если YooKassa включила «Автоплатежи».
    // До этого флаг небезопасен: YooKassa вернёт ошибку и платёж не создастся.
    const savePaymentMethod = config.AUTORENEW_ENABLED;
    try {
      const payment = await yookassa.createPayment(chatId, amount, { savePaymentMethod });
      store.savePaymentId(chatId, payment.id);
      const payUrl = payment.confirmation.confirmation_url;
      const payMsg = { text: `После оплаты я пришлю ссылку для входа в закрытый клуб «Первый шаг» в течение 1 минуты 👌`, urlButton: { label: `💳 Оплатить ${amount} ₽`, url: payUrl } };
      if (result.messages && result.messages.length > 0) {
        result.messages[result.messages.length - 1].urlButton = { label: `💳 Оплатить ${amount} ₽`, url: payUrl };
      } else {
        if (!result.messages) result.messages = [];
        result.messages.push(payMsg);
      }
    } catch (err) {
      console.error('[yookassa] createPayment error:', err.message);
      const fallbackMsg = { text: `После оплаты я пришлю ссылку для входа в закрытый клуб «Первый шаг» в течение 1 минуты 👌`, urlButton: { label: `💳 Оплатить`, url: config.PAYMENT_LINK } };
      if (result.messages && result.messages.length > 0) {
        result.messages[result.messages.length - 1].urlButton = { label: `💳 Оплатить`, url: config.PAYMENT_LINK };
      } else {
        if (!result.messages) result.messages = [];
        result.messages.push(fallbackMsg);
      }
    }
  }
  await send(chatId, result);
}

async function sendText(chatId, text) {
  return bot.telegram.sendMessage(chatId, text, { link_preview_options: { is_disabled: true } });
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
// КЛУБ
// ─────────────────────────────────────────────

async function createClubInvite(chatId) {
  if (!config.CLUB_CHANNEL_ID) {
    console.error('[club] CLUB_CHANNEL_ID не задан');
    return 'https://t.me/+7TOIRKAUYzg5MjNi'; // fallback
  }
  const expireDate = Math.floor(Date.now() / 1000) + config.CLUB_ACCESS_DAYS * 24 * 60 * 60;
  const link = await bot.telegram.createChatInviteLink(config.CLUB_CHANNEL_ID, {
    expire_date: expireDate,
    member_limit: 1,
    name: `user_${chatId}`,
  });
  return link.invite_link;
}

async function kickFromClub(chatId) {
  if (!config.CLUB_CHANNEL_ID) return;
  try {
    await bot.telegram.banChatMember(config.CLUB_CHANNEL_ID, Number(chatId));
    await bot.telegram.unbanChatMember(config.CLUB_CHANNEL_ID, Number(chatId));
  } catch (err) {
    console.error(`[club] kick error for ${chatId}:`, err.message);
  }
}

// ─────────────────────────────────────────────
// DISPATCH
// ─────────────────────────────────────────────

function isAdmin(fromId) {
  return config.ADMIN_TELEGRAM_IDS && config.ADMIN_TELEGRAM_IDS.includes(fromId);
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
  if (global.adminRouter) {
    const result = await global.adminRouter.handleAdminCommand(text, 'telegram', chatId);
    if (result.file) {
      try {
        const path = require('path');
        const tempDir = path.join(__dirname, '../data/temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const filePath = path.join(tempDir, result.file.filename);
        fs.writeFileSync(filePath, result.file.content, 'utf-8');
        await bot.telegram.sendDocument(chatId, { source: filePath }, { caption: result.text });
        fs.unlinkSync(filePath);
      } catch (err) {
        await bot.telegram.sendMessage(chatId, result.text + '\n\n' + result.file.content);
      }
      return;
    }
    if (result.text) await bot.telegram.sendMessage(chatId, result.text);
  } else {
    const result = handleAdminCommand(text, 'telegram', chatId);
    if (result.broadcast) {
      for (const item of result.broadcast) {
        if (item.platform === 'telegram') {
          try { await sendText(item.chatId, item.text); } catch { /* skip */ }
        }
      }
    }
    if (result.text) await bot.telegram.sendMessage(chatId, result.text);
  }
}

function registerAction(callbackName, action) {
  bot.action(callbackName, async (ctx) => {
    ctx.answerCbQuery().catch(() => {}); // не блокируем если устарел
    const fromId = ctx.from.id;
    const chatId = String(ctx.chat.id);
    if (isAdmin(fromId) && !store.isInTestMode(chatId)) return;
    const userInfo = { username: ctx.from.username, firstName: ctx.from.first_name };
    await dispatch(chatId, action, null, userInfo);
  });
}

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────

function start() {
  bot = new Telegraf(config.TELEGRAM_TOKEN);

  // /start
  bot.start(async (ctx) => {
    try {
      const fromId = ctx.message.from.id;
      const chatId = String(ctx.chat.id);
      if (isAdmin(fromId) && !store.isInTestMode(chatId)) return;
      const userInfo = { username: ctx.from.username, firstName: ctx.from.first_name };
      const source = ctx.startPayload || null;
      await dispatch(chatId, 'START', source, userInfo);
    } catch (err) {
      console.error('[telegram] /start error:', err.message);
    }
  });

  // /myid
  bot.command('myid', async (ctx) => {
    await ctx.reply(`Твой Telegram ID: ${ctx.from.id}`);
  });

  // /help — справка + контакт Оператора (упомянут в политике конфиденциальности, п.9)
  bot.command('help', async (ctx) => {
    try {
      await ctx.reply(
        '👋 Я бот «Код Воина».\n\n' +
        'Команды:\n' +
        '/start — начать заново\n' +
        '/stop — отписаться от рассылки\n' +
        '/delete — удалить свои данные\n\n' +
        'По любым вопросам — в том числе по политике конфиденциальности и обработке данных — ' +
        'напиши прямо сюда, я передам Оператору, он ответит.\n\n' +
        '📧 Также можно написать на почту: voin_alex04@mail.ru'
      );
    } catch (err) {
      console.error('[telegram] /help error:', err.message);
    }
  });

  // /unsubscribe — отключить автопродление клуба
  bot.command('unsubscribe', async (ctx) => {
    try {
      const fromId = ctx.message.from.id;
      const chatId = String(ctx.chat.id);
      if (isAdmin(fromId) && !store.isInTestMode(chatId)) return;
      const userInfo = { username: ctx.from.username, firstName: ctx.from.first_name };
      await dispatch(chatId, 'UNSUBSCRIBE', null, userInfo);
    } catch (err) {
      console.error('[telegram] /unsubscribe error:', err.message);
    }
  });

  // /stop — отказ от рассылки (политика конфиденциальности)
  bot.command('stop', async (ctx) => {
    try {
      const fromId = ctx.message.from.id;
      const chatId = String(ctx.chat.id);
      if (isAdmin(fromId) && !store.isInTestMode(chatId)) return;
      store.setOptOut(chatId, true);
      await ctx.reply('🔕 Готово. Больше не буду присылать тебе рассылки и напоминания.\n\nЕсли передумаешь — напиши /start, и всё вернётся.');
    } catch (err) {
      console.error('[telegram] /stop error:', err.message);
    }
  });

  // /delete — удаление своих данных (политика конфиденциальности)
  bot.command('delete', async (ctx) => {
    try {
      const fromId = ctx.message.from.id;
      const chatId = String(ctx.chat.id);
      if (isAdmin(fromId) && !store.isInTestMode(chatId)) return;
      const u = store.getUser(chatId);
      // Если активный участник клуба — убираем из закрытого канала
      if (u && (u.state === 'COMPLETED_CLUB' || u.state === 'COMPLETED_BUNDLE')) {
        await kickFromClub(chatId);
      }
      store.deleteUser(chatId);
      await ctx.reply('🗑 Готово. Все твои данные удалены из бота.\n\nЕсли захочешь вернуться — просто напиши /start.');
    } catch (err) {
      console.error('[telegram] /delete error:', err.message);
    }
  });

  // Кнопки цепочки
  registerAction('consent', 'BTN_CONSENT');
  registerAction('about',   'BTN_ABOUT');
  registerAction('want',    'BTN_WANT');
  // Акция «бесплатный месяц»: отдельный обработчик — выдача инвайта асинхронная,
  // через registerAction/handleAction (sync) её не провести.
  bot.action('trial_join', async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const fromId = ctx.from.id;
    const chatId = String(ctx.chat.id);
    if (isAdmin(fromId) && !store.isInTestMode(chatId)) return;
    console.log(`[dispatch] chatId=${chatId} action=TRIAL_JOIN`);
    try {
      store.saveUserInfo(chatId, { username: ctx.from.username, firstName: ctx.from.first_name });
      const result = await flow.handleTrialJoin({ chatId, createInvite: createClubInvite });
      // sendWithPayment: в ветке «окно закрыто» результат может содержать createPayment
      await sendWithPayment(chatId, result);
    } catch (err) {
      console.error('[telegram] trial_join error:', err.message);
    }
  });
  // Единственная кнопка оплаты — клуб; ведёт сразу на YooKassa
  registerAction('pay_club',    'PAY_CLUB');
  registerAction('renew_club',  'BTN_RENEW_CLUB');
  // BTN_CLUB_CANCEL = «Отключить автопродление» (старое название callback сохранено)
  registerAction('club_cancel', 'BTN_CLUB_CANCEL');

  // Менеджер: кнопка «Ответить»
  bot.action(/^reply_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetChatId = ctx.match[1];
    const managerId = ctx.from.id;
    pendingReplies.set(managerId, targetChatId);
    await ctx.reply(`✍️ Напишите ответ для ID ${targetChatId}:`);
  });

  bot.on('text', async (ctx) => {
    try {
      const fromId = ctx.message.from.id;
      const text = ctx.message.text;
      const chatId = String(ctx.chat.id);

      // Менеджер: ожидает ввода ответа
      if (isAdmin(fromId) && pendingReplies.has(fromId)) {
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
      if (isAdmin(fromId) && ctx.message.reply_to_message) {
        const repliedText = ctx.message.reply_to_message.text || '';
        const match = repliedText.match(/\[Telegram\] ID: (\d+)/i);
        if (match) {
          const targetChatId = match[1];
          try {
            await sendText(targetChatId, text);
            await bot.telegram.sendMessage(chatId, `✅ Отправлено ${targetChatId}`);
          } catch (err) {
            await bot.telegram.sendMessage(chatId, `❌ Ошибка: ${err.message}`);
          }
          return;
        }
      }

      // Админ не в тест-режиме — только команды
      if (isAdmin(fromId)) {
        const testMode = store.isInTestMode(chatId);
        if (!testMode) {
          if (text.startsWith('/')) await handleAdminMsg(text, chatId);
          return;
        }
        if (text.startsWith('/')) {
          await handleAdminMsg(text, chatId);
          return;
        }
      }

      const userInfo = { username: ctx.from.username, firstName: ctx.from.first_name };
      await dispatch(chatId, 'TEXT', text, userInfo);
    } catch (err) {
      console.error('[telegram] text error:', err.message);
    }
  });

  // Ручной поллинг (обходит 409 конфликты)
  let offset = 0;
  async function poll() {
    console.log(`[poll] START offset=${offset}`);
    try {
      const updates = await bot.telegram.getUpdates(0, 100, offset, ['message','callback_query','my_chat_member']);
      console.log(`[poll] DONE got=${updates.length}`);
      for (const update of updates) {
        offset = update.update_id + 1;
        const type = update.message ? 'msg:'+update.message.text?.slice(0,20) : update.callback_query ? 'cb:'+update.callback_query.data : 'other';
        console.log(`[poll] processing ${update.update_id} ${type}`);
        // fire-and-forget: не блокируем poll пока обрабатывается обновление
        bot.handleUpdate(update).catch(err =>
          console.error('[telegram] handleUpdate error:', err.message)
        );
      }
    } catch (err) {
      console.error('[telegram] poll error:', err.message);
    }
    setTimeout(poll, 500);
  }

  bot.telegram.deleteWebhook({ drop_pending_updates: true })
    .then(() => poll())
    .catch(() => poll());

  console.log('[telegram] bot started (manual polling)');

  process.once('SIGINT', () => process.exit(0));
  process.once('SIGTERM', () => process.exit(0));

  return { send, sendWithPayment, sendText, notifyManager, createClubInvite, kickFromClub };
}

module.exports = { start, send, sendWithPayment, sendText };
