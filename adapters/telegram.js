const { Telegraf, Markup } = require('telegraf');
const config = require('../config');
const flow = require('../core/flow');

let bot;

async function send(chatId, result) {
  for (const msg of result.messages) {
    if (msg.button) {
      const keyboard = Markup.inlineKeyboard([
        Markup.button.callback(msg.button.label, msg.button.callback),
      ]);
      await bot.telegram.sendMessage(chatId, msg.text, keyboard);
    } else {
      await bot.telegram.sendMessage(chatId, msg.text);
    }
  }
  for (const fileKey of result.files) {
    if (fileKey === 'wallpaper') {
      await bot.telegram.sendPhoto(chatId, { source: config.FILES.wallpaper });
    } else {
      await bot.telegram.sendDocument(chatId, { source: config.FILES[fileKey] });
    }
  }
}

async function sendText(chatId, text) {
  await bot.telegram.sendMessage(chatId, text);
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
    } catch (err) {
      console.error('[telegram] text error:', err.message);
    }
  });

  bot.launch();
  console.log('[telegram] bot started');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return { send, sendText };
}

module.exports = { start, send, sendText };
