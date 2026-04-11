const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const config = require('../config');
const flow = require('../core/flow');

let bot;

const FILE_ID_CACHE_PATH = './data/tg_file_ids.json';

function loadFileIds() {
  try { return JSON.parse(fs.readFileSync(FILE_ID_CACHE_PATH, 'utf-8')); } catch { return {}; }
}

function saveFileIds(cache) {
  fs.writeFileSync(FILE_ID_CACHE_PATH, JSON.stringify(cache, null, 2));
}

let fileIdCache = loadFileIds();

async function send(chatId, result) {
  for (const msg of result.messages) {
    if (msg.banner) {
      await bot.telegram.sendPhoto(chatId, { source: msg.banner });
    }
    if (msg.button) {
      const keyboard = Markup.inlineKeyboard([
        Markup.button.callback(msg.button.label, msg.button.callback),
      ]);
      await bot.telegram.sendMessage(chatId, msg.text, { ...keyboard, link_preview_options: { is_disabled: true } });
    } else {
      await bot.telegram.sendMessage(chatId, msg.text, { link_preview_options: { is_disabled: true } });
    }
  }
  for (const fileKey of result.files) {
    if (fileKey === 'wallpapers') {
      if (fileIdCache.wallpapers) {
        await bot.telegram.sendMediaGroup(chatId, fileIdCache.wallpapers.map(id => ({
          type: 'photo', media: id,
        })));
      } else {
        const sent = await bot.telegram.sendMediaGroup(chatId, config.FILES.wallpapers.map(p => ({
          type: 'photo', media: { source: p },
        })));
        fileIdCache.wallpapers = sent.map(m => m.photo[m.photo.length - 1].file_id);
        saveFileIds(fileIdCache);
      }
    } else {
      if (fileIdCache[fileKey]) {
        await bot.telegram.sendDocument(chatId, fileIdCache[fileKey]);
      } else {
        const sent = await bot.telegram.sendDocument(chatId, { source: config.FILES[fileKey] });
        fileIdCache[fileKey] = sent.document.file_id;
        saveFileIds(fileIdCache);
      }
    }
  }
  for (const msg of result.trailingMessages || []) {
    await bot.telegram.sendMessage(chatId, msg.text, { link_preview_options: { is_disabled: true } });
  }
}

async function sendText(chatId, text) {
  await bot.telegram.sendMessage(chatId, text);
}

async function notifyManager(chatId, platform, text) {
  const platformLabel = platform === 'telegram' ? 'Telegram' : 'VK';
  const msg = `💬 Сообщение вне сценария\n[${platformLabel}] ID: ${chatId}\n\n"${text}"`;
  try {
    await bot.telegram.sendMessage(config.MANAGER_TG_ID, msg);
  } catch (err) {
    console.error('[telegram] notifyManager error:', err.message);
  }
}

function start() {
  bot = new Telegraf(config.TELEGRAM_TOKEN);

  bot.start(async (ctx) => {
    try {
      const result = flow.handleAction({
        platform: 'telegram',
        chatId: String(ctx.chat.id),
        action: 'START',
      });
      await send(String(ctx.chat.id), result);
    } catch (err) {
      console.error('[telegram] start error:', err.message);
    }
  });

  bot.action('next_1', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      const result = flow.handleAction({
        platform: 'telegram',
        chatId: String(ctx.chat.id),
        action: 'BTN_NEXT_1',
      });
      await send(String(ctx.chat.id), result);
    } catch (err) {
      console.error('[telegram] next_1 error:', err.message);
    }
  });

  bot.action('next_2', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      const result = flow.handleAction({
        platform: 'telegram',
        chatId: String(ctx.chat.id),
        action: 'BTN_NEXT_2',
      });
      await send(String(ctx.chat.id), result);
    } catch (err) {
      console.error('[telegram] next_2 error:', err.message);
    }
  });

  bot.on('text', async (ctx) => {
    try {
      const result = flow.handleAction({
        platform: 'telegram',
        chatId: String(ctx.chat.id),
        action: 'TEXT',
        text: ctx.message.text,
      });
      await send(String(ctx.chat.id), result);

      if (result.notifyManager && result.originalText) {
        await notifyManager(String(ctx.chat.id), 'telegram', result.originalText);
      }
    } catch (err) {
      console.error('[telegram] text error:', err.message);
    }
  });

  async function launchWithRetry() {
    while (true) {
      try {
        await bot.telegram.deleteWebhook();
        await bot.launch();
        break;
      } catch (err) {
        console.error('[telegram] launch error:', err.message, '— retrying in 15s');
        await new Promise(r => setTimeout(r, 15000));
      }
    }
  }
  launchWithRetry();
  console.log('[telegram] bot started');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return { send, sendText, notifyManager };
}

module.exports = { start, send, sendText };
