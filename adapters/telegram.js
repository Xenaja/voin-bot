const { Telegraf, Markup } = require('telegraf');
const config = require('../config');
const flow = require('../core/flow');

let bot;

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
      await bot.telegram.sendMediaGroup(chatId, config.FILES.wallpapers.map(p => ({
        type: 'photo',
        media: { source: p },
      })));
    } else {
      await bot.telegram.sendDocument(chatId, { source: config.FILES[fileKey] });
    }
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

  bot.launch().catch(err => {
    console.error('[telegram] launch error:', err.message, '— retrying in 10s');
    setTimeout(() => bot.launch().catch(e => console.error('[telegram] retry failed:', e.message)), 10000);
  });
  console.log('[telegram] bot started');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return { send, sendText, notifyManager };
}

module.exports = { start, send, sendText };
