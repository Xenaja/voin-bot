const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const config = require('../config');
const flow = require('../core/flow');
const { handleAdminCommand } = require('../core/admin');
const store = require('../core/store');

let bot;

// managerId → chatId (ожидание ответа менеджера)
const pendingReplies = new Map();

const FILE_ID_CACHE_PATH = './data/tg_file_ids.json';

function loadFileIds() {
  try { return JSON.parse(fs.readFileSync(FILE_ID_CACHE_PATH, 'utf-8')); } catch { return {}; }
}

function saveFileIds(cache) {
  fs.writeFileSync(FILE_ID_CACHE_PATH, JSON.stringify(cache, null, 2));
}

let fileIdCache = loadFileIds();

async function send(chatId, result) {
  for (const msg of (result.messages || [])) {
    // Баннер (фото)
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
        console.error(`[telegram] banner error (skipping): ${err.message}`);
      }
    }

    // Видео — отправляем, потом текст + кнопка + запасная ссылка
    if (msg.video) {
      try {
        const videoKey = 'video_' + msg.video.replace(/[^a-z0-9]/gi, '_');
        const thumbPath = msg.video.replace(/\.[^.]+$/, '_thumb.jpg');
        const thumb = fs.existsSync(thumbPath) ? { source: thumbPath } : undefined;
        const videoOpts = { width: 1080, height: 1920, supports_streaming: true, thumbnail: thumb };
        if (fileIdCache[videoKey]) {
          await bot.telegram.sendVideo(chatId, fileIdCache[videoKey], videoOpts);
        } else {
          const sent = await bot.telegram.sendVideo(chatId, { source: msg.video }, videoOpts);
          fileIdCache[videoKey] = sent.video.file_id;
          saveFileIds(fileIdCache);
        }
      } catch (err) {
        console.error(`[telegram] video error: ${err.message}`);
      }

      // Текст описания + кнопка
      const textWithFallback = config.VIDEO_FALLBACK_URL
        ? `${msg.text}\n\n🔗 <a href="${config.VIDEO_FALLBACK_URL}">Если не открылось — смотри здесь</a>`
        : msg.text;
      const opts = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
      if (msg.button) {
        const keyboard = Markup.inlineKeyboard([Markup.button.callback(msg.button.label, msg.button.callback)]);
        await bot.telegram.sendMessage(chatId, textWithFallback, { ...keyboard, ...opts });
      } else {
        await bot.telegram.sendMessage(chatId, textWithFallback, opts);
      }
      continue;
    }

    // Кнопки теста (каждый вариант на отдельной строке)
    if (msg.quizButtons && msg.quizButtons.length) {
      const keyboard = Markup.inlineKeyboard(
        msg.quizButtons.map(([label, cb]) => [Markup.button.callback(label, cb)])
      );
      await bot.telegram.sendMessage(chatId, msg.text, { ...keyboard, link_preview_options: { is_disabled: true } });
      continue;
    }

    // Одна кнопка
    if (msg.button) {
      const keyboard = Markup.inlineKeyboard([
        Markup.button.callback(msg.button.label, msg.button.callback),
      ]);
      await bot.telegram.sendMessage(chatId, msg.text, { ...keyboard, link_preview_options: { is_disabled: true } });
    } else {
      await bot.telegram.sendMessage(chatId, msg.text, { link_preview_options: { is_disabled: true } });
    }
  }

  // Файлы
  for (const fileKey of (result.files || [])) {
    if (fileKey === 'wallpapers') {
      try {
        if (fileIdCache.wallpapers) {
          await bot.telegram.sendMediaGroup(chatId, fileIdCache.wallpapers.map(id => ({
            type: 'photo', media: id,
          })));
        } else {
          const sent = await bot.telegram.sendMediaGroup(chatId, config.FILES.wallpapers.map(p => ({
            type: 'photo', media: { source: p },
          })));
          fileIdCache.wallpapers = sent.map(s => s.photo[s.photo.length - 1].file_id);
          saveFileIds(fileIdCache);
        }
      } catch (err) {
        console.error(`[telegram] wallpapers error: ${err.message}`);
      }
    } else {
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
  }

  for (const msg of (result.trailingMessages || [])) {
    if (msg.button) {
      const keyboard = Markup.inlineKeyboard([
        Markup.button.callback(msg.button.label, msg.button.callback),
      ]);
      await bot.telegram.sendMessage(chatId, msg.text, { ...keyboard, link_preview_options: { is_disabled: true } });
    } else {
      await bot.telegram.sendMessage(chatId, msg.text, { link_preview_options: { is_disabled: true } });
    }
  }
}

async function sendText(chatId, text) {
  return bot.telegram.sendMessage(chatId, text, { link_preview_options: { is_disabled: true } });
}

async function notifyManager(chatId, text) {
  const msg = `💬 Сообщение вне сценария\n[Telegram] ID: ${chatId}\n\n"${text}"`;
  const keyboard = Markup.inlineKeyboard([
    Markup.button.callback('✍️ Ответить', `reply_${chatId}`),
  ]);
  try {
    await bot.telegram.sendMessage(config.MANAGER_TG_ID, msg, keyboard);
  } catch (err) {
    console.error('[telegram] notifyManager error:', err.message);
  }
}

function isAdmin(fromId) {
  return config.ADMIN_TELEGRAM_IDS && config.ADMIN_TELEGRAM_IDS.includes(fromId);
}

async function dispatch(chatId, action, payload, userInfo) {
  try {
    const result = flow.handleAction({ chatId, action, payload });
    if (userInfo) store.saveUserInfo(chatId, userInfo);
    await send(chatId, result);
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
          try { await sendText(item.chatId, item.text); } catch (e) { /* skip */ }
        }
      }
    }
    if (result.text) await bot.telegram.sendMessage(chatId, result.text);
  }
}

// Общий обработчик callback-кнопок с проверкой прав
function registerAction(callbackName, action) {
  bot.action(callbackName, async (ctx) => {
    await ctx.answerCbQuery();
    const fromId = ctx.from.id;
    const chatId = String(ctx.chat.id);
    if (isAdmin(fromId) && !store.isInTestMode(chatId)) return;
    const userInfo = { username: ctx.from.username, firstName: ctx.from.first_name };
    await dispatch(chatId, action, null, userInfo);
  });
}

// Callback-кнопки вопросов теста
function registerQuizAction(callbackName) {
  bot.action(callbackName, async (ctx) => {
    await ctx.answerCbQuery();
    const fromId = ctx.from.id;
    const chatId = String(ctx.chat.id);
    if (isAdmin(fromId) && !store.isInTestMode(chatId)) return;
    const userInfo = { username: ctx.from.username, firstName: ctx.from.first_name };
    await dispatch(chatId, 'BTN_QUIZ', callbackName, userInfo);
  });
}

function start() {
  bot = new Telegraf(config.TELEGRAM_TOKEN);

  // /start
  bot.start(async (ctx) => {
    try {
      const fromId = ctx.message.from.id;
      const chatId = String(ctx.chat.id);
      if (isAdmin(fromId) && !store.isInTestMode(chatId)) return;
      const userInfo = { username: ctx.from.username, firstName: ctx.from.first_name };
      const source = ctx.startPayload || null; // tiktok / instagram / null
      await dispatch(chatId, 'START', source, userInfo);
    } catch (err) {
      console.error('[telegram] /start error:', err.message);
    }
  });

  // /myid — для любого пользователя, чтобы узнать свой Telegram ID
  bot.command('myid', async (ctx) => {
    await ctx.reply(`Твой Telegram ID: ${ctx.from.id}`);
  });

  // Кнопка «Начать тест»
  registerAction('test_start', 'BTN_TEST_START');

  // Вопросы теста
  for (const q of [1, 2, 3, 4]) {
    for (const a of ['a', 'b', 'c']) {
      registerQuizAction(`q${q}_${a}`);
    }
  }

  // Прогрев
  registerAction('get_video',    'BTN_GET_VIDEO');
  registerAction('want_anchors', 'BTN_WANT_ANCHORS');
  registerAction('thank_you',    'BTN_THANK_YOU');
  registerAction('tell_me',      'BTN_TELL_ME');
  registerAction('whats_inside', 'BTN_WHATS_INSIDE');
  registerAction('yes',          'BTN_YES');
  registerAction('get_b',        'BTN_GET_B');

  // Менеджер нажал «Ответить» под уведомлением
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

      // Менеджер ввёл ответ после нажатия кнопки «Ответить»
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

      // Менеджер ответил на уведомление через reply
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

      // Обычный admin (не test mode) — только команды
      if (isAdmin(fromId)) {
        const testMode = store.isInTestMode(chatId);
        if (!testMode) {
          if (text.startsWith('/')) await handleAdminMsg(text, chatId);
          return;
        }
        // Test mode: команды всё равно работают
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

  // Ручной поллинг с timeout=0 — не держит соединение, обходит 409
  let offset = 0;
  async function poll() {
    try {
      const updates = await bot.telegram.getUpdates(0, 100, offset, null);
      for (const update of updates) {
        offset = update.update_id + 1;
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

  return { send, sendText, notifyManager };
}

module.exports = { start, send, sendText };
