const { Telegraf, Markup } = require('telegraf');
const https = require('https');
const fs = require('fs');
const config = require('../config');

const ipv4Agent = new https.Agent({ family: 4 });
const flow = require('../core/flow');
const { handleAdminCommand } = require('../core/admin');
const store = require('../core/store');

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
        console.error(`[telegram] banner send failed (continuing): ${err.message}`);
      }
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
  console.log(`[telegram] sendText called: chatId=${chatId}, text="${text.substring(0, 50)}..."`);
  try {
    const result = await bot.telegram.sendMessage(chatId, text);
    console.log(`[telegram] ✅ sendText success: message_id=${result.message_id}`);
    return result;
  } catch (err) {
    console.error(`[telegram] ❌ sendText error:`, err.message);
    throw err;
  }
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

async function handleAdminMessage(text, platform, chatId) {
  console.log(`[telegram] handleAdminMessage called: text="${text}", platform=${platform}, chatId=${chatId}`);
  
  // Используем глобальный роутер для кросс-платформенной координации
  if (global.adminRouter) {
    const result = await global.adminRouter.handleAdminCommand(text, platform, chatId);
    
    console.log(`[telegram] admin-router result:`, { 
      hasBroadcast: !!result.broadcast, 
      broadcastCount: result.broadcast?.length || 0,
      text: result.text?.substring(0, 100)
    });

    // Отправляем ответ админу
    if (result.file) {
      try {
        // Создаём временный файл и отправляем как документ
        const fs = require('fs');
        const path = require('path');
        const tempDir = path.join(__dirname, '../data/temp');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        const filePath = path.join(tempDir, result.file.filename);
        fs.writeFileSync(filePath, result.file.content, 'utf-8');
        
        await bot.telegram.sendDocument(chatId, { source: filePath }, { caption: result.text });

        // Удаляем временный файл
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error('[telegram] send file error:', err.message);
        // Fallback: отправляем как текст
        await bot.telegram.sendMessage(chatId, result.text + '\n\n' + result.file.content);
      }
      return;
    }

    if (result.text) {
      try {
        await bot.telegram.sendMessage(chatId, result.text);
      } catch (err) {
        console.error('[telegram] send response error:', err.message);
      }
    }
  } else {
    // Fallback: используем локальный обработчик
    const result = handleAdminCommand(text, platform, chatId);

    if (result.broadcast && result.broadcast.length > 0) {
      for (const item of result.broadcast) {
        try {
          if (item.platform === 'telegram') {
            await sendText(item.chatId, item.text);
          } else if (item.platform === 'vk') {
            console.log(`[telegram] broadcast skipped for vk user ${item.chatId} (handled by vk adapter)`);
          }
        } catch (err) {
          console.error('[telegram] broadcast error:', err.message);
        }
      }
    }

    if (result.file) {
      try {
        const fs = require('fs');
        const path = require('path');
        const tempDir = path.join(__dirname, '../data/temp');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        const filePath = path.join(tempDir, result.file.filename);
        fs.writeFileSync(filePath, result.file.content, 'utf-8');

        await bot.telegram.sendDocument(chatId, { source: filePath }, { caption: result.text });

        fs.unlinkSync(filePath);
      } catch (err) {
        console.error('[telegram] send file error:', err.message);
        await bot.telegram.sendMessage(chatId, result.text + '\n\n' + result.file.content);
      }
      return;
    }

    if (result.text) {
      try {
        await bot.telegram.sendMessage(chatId, result.text);
      } catch (err) {
        console.error('[telegram] send response error:', err.message);
      }
    }
  }
}

function start() {
  bot = new Telegraf(config.TELEGRAM_TOKEN, { telegram: { agent: ipv4Agent } });

  bot.start(async (ctx) => {
    try {
      const fromId = ctx.message.from.id;
      const chatId = String(ctx.chat.id);
      
      // Если это админ, проверяем режим тестирования
      if (config.ADMIN_TELEGRAM_IDS && config.ADMIN_TELEGRAM_IDS.includes(fromId)) {
        const testMode = store.isInTestMode('telegram', chatId);
        if (!testMode) {
          console.log(`[telegram] admin ${fromId} sent /start - ignoring (not in test mode)`);
          return;
        }
      }
      
      const result = flow.handleAction({
        platform: 'telegram',
        chatId: chatId,
        action: 'START',
      });
      await send(chatId, result);
    } catch (err) {
      console.error('[telegram] start error:', err.message);
    }
  });

  bot.action('next_1', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      const fromId = ctx.from.id;
      const chatId = String(ctx.chat.id);
      
      // Если это админ, проверяем режим тестирования
      if (config.ADMIN_TELEGRAM_IDS && config.ADMIN_TELEGRAM_IDS.includes(fromId)) {
        const testMode = store.isInTestMode('telegram', chatId);
        if (!testMode) {
          console.log(`[telegram] admin ${fromId} clicked next_1 - ignoring (not in test mode)`);
          return;
        }
      }
      
      const result = flow.handleAction({
        platform: 'telegram',
        chatId: chatId,
        action: 'BTN_NEXT_1',
      });
      await send(chatId, result);
    } catch (err) {
      console.error('[telegram] next_1 error:', err.message);
    }
  });

  bot.action('next_2', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      const fromId = ctx.from.id;
      const chatId = String(ctx.chat.id);
      
      // Если это админ, проверяем режим тестирования
      if (config.ADMIN_TELEGRAM_IDS && config.ADMIN_TELEGRAM_IDS.includes(fromId)) {
        const testMode = store.isInTestMode('telegram', chatId);
        if (!testMode) {
          console.log(`[telegram] admin ${fromId} clicked next_2 - ignoring (not in test mode)`);
          return;
        }
      }
      
      const result = flow.handleAction({
        platform: 'telegram',
        chatId: chatId,
        action: 'BTN_NEXT_2',
      });
      await send(chatId, result);
    } catch (err) {
      console.error('[telegram] next_2 error:', err.message);
    }
  });

  bot.on('text', async (ctx) => {
    try {
      const fromId = ctx.message.from.id;
      const text = ctx.message.text;
      const chatId = String(ctx.chat.id);

      // Менеджер отвечает на уведомление → пересылаем юзеру
      if (
        config.ADMIN_TELEGRAM_IDS && config.ADMIN_TELEGRAM_IDS.includes(fromId) &&
        ctx.message.reply_to_message
      ) {
        const repliedText = ctx.message.reply_to_message.text || '';
        const match = repliedText.match(/\[(Telegram|VK)\] ID: (\d+)/i);
        if (match) {
          const targetPlatform = match[1].toLowerCase();
          const targetChatId = match[2];
          try {
            if (targetPlatform === 'telegram') {
              await sendText(targetChatId, text);
            } else if (targetPlatform === 'vk') {
              const vkAdapter = global.adapters && global.adapters.vk;
              if (vkAdapter && vkAdapter.sendText) {
                await vkAdapter.sendText(targetChatId, text);
              } else {
                await bot.telegram.sendMessage(chatId, '❌ VK адаптер недоступен');
                return;
              }
            }
            await bot.telegram.sendMessage(chatId, `✅ Отправлено [${match[1]}] ${targetChatId}`);
          } catch (err) {
            await bot.telegram.sendMessage(chatId, `❌ Ошибка отправки: ${err.message}`);
          }
          return;
        }
      }

      // Проверяем, является ли отправитель админом
      if (config.ADMIN_TELEGRAM_IDS && config.ADMIN_TELEGRAM_IDS.includes(fromId)) {
        // Проверяем режим тестирования
        const testMode = store.isInTestMode('telegram', chatId);
        
        // Если НЕ в режиме тестирования - обрабатываем только команды
        if (!testMode) {
          if (text.startsWith('/')) {
            await handleAdminMessage(text, 'telegram', chatId);
          } else {
            console.log(`[telegram] non-command from admin ${fromId} (not in test mode), ignoring`);
          }
          return;
        }
        
        // В режиме тестирования: команды /admin и /test всё ещё работают
        if (text.startsWith('/')) {
          await handleAdminMessage(text, 'telegram', chatId);
          return;
        }
        // Иначе продолжаем обработку как обычный пользователь
      }

      const result = flow.handleAction({
        platform: 'telegram',
        chatId: chatId,
        action: 'TEXT',
        text: ctx.message.text,
      });
      await send(chatId, result);

      if (result.notifyManager && result.originalText) {
        await notifyManager(chatId, 'telegram', result.originalText);
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
