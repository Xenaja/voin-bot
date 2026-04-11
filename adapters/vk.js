const { VK, Keyboard } = require('vk-io');
const fs = require('fs');
const config = require('../config');
const flow = require('../core/flow');
const { handleAdminCommand } = require('../core/admin');
const store = require('../core/store');

const TRIGGER_WORDS = ['старт', 'start', 'начать', 'привет', 'хочу'];

const VK_FILE_ID_CACHE_PATH = './data/vk_file_ids.json';

function loadVkFileIds() {
  try { return JSON.parse(fs.readFileSync(VK_FILE_ID_CACHE_PATH, 'utf-8')); } catch { return {}; }
}

function saveVkFileIds(cache) {
  fs.writeFileSync(VK_FILE_ID_CACHE_PATH, JSON.stringify(cache, null, 2));
}

let vkFileIdCache = loadVkFileIds();

let vk;

async function send(chatId, result) {
  for (const msg of result.messages) {
    const params = {
      peer_id:   Number(chatId),
      message:   msg.text,
      random_id: Math.random() * 1e9 | 0,
    };

    if (msg.banner) {
      const photo = await vk.upload.messagePhoto({
        peer_id: Number(chatId),
        source:  { value: fs.createReadStream(msg.banner) },
      });
      const ownerId = photo.owner_id ?? photo.ownerId;
      params.attachment = `photo${ownerId}_${photo.id}`;
    }

    if (msg.button) {
      params.keyboard = JSON.stringify({
        one_time: true,
        buttons: [[{
          action: {
            type: 'text',
            label: msg.button.label,
            payload: JSON.stringify({ action: msg.button.callback }),
          },
          color: 'primary',
        }]],
      });
    }

    await vk.api.messages.send(params);
  }

  const filenames = { combined: 'Гайд+Трекер.pdf', guide: 'Гайд.pdf', tracker: 'Трекер.pdf' };

  for (const fileKey of result.files) {
    if (fileKey === 'wallpapers') {
      if (!vkFileIdCache.wallpapers) vkFileIdCache.wallpapers = [];
      for (let i = 0; i < config.FILES.wallpapers.length; i++) {
        let attachment = vkFileIdCache.wallpapers[i];
        if (!attachment) {
          const photo = await vk.upload.messagePhoto({
            peer_id: Number(chatId),
            source:  { value: fs.createReadStream(config.FILES.wallpapers[i]) },
          });
          const ownerId = photo.owner_id ?? photo.ownerId;
          attachment = `photo${ownerId}_${photo.id}`;
          vkFileIdCache.wallpapers[i] = attachment;
          saveVkFileIds(vkFileIdCache);
        }
        await vk.api.messages.send({
          peer_id:    Number(chatId),
          message:    ' ',
          attachment,
          random_id:  Math.random() * 1e9 | 0,
        });
      }
    } else {
      let attachment = vkFileIdCache[fileKey];
      if (!attachment) {
        const doc = await vk.upload.messageDocument({
          peer_id: Number(chatId),
          source:  { value: fs.createReadStream(config.FILES[fileKey]), filename: filenames[fileKey] },
        });
        const ownerId = doc.owner_id ?? doc.ownerId;
        attachment = `doc${ownerId}_${doc.id}`;
        vkFileIdCache[fileKey] = attachment;
        saveVkFileIds(vkFileIdCache);
      }
      await vk.api.messages.send({
        peer_id:    Number(chatId),
        message:    ' ',
        attachment,
        random_id:  Math.random() * 1e9 | 0,
      });
    }
  }
  for (const msg of result.trailingMessages || []) {
    await vk.api.messages.send({
      peer_id:   Number(chatId),
      message:   msg.text,
      random_id: Math.random() * 1e9 | 0,
    });
  }
}

async function sendText(chatId, text) {
  console.log(`[vk] sendText called: chatId=${chatId}, text="${text.substring(0, 50)}..."`);
  try {
    const result = await vk.api.messages.send({
      peer_id:   Number(chatId),
      message:   text,
      random_id: Math.random() * 1e9 | 0,
    });
    console.log(`[vk] ✅ sendText success: message_id=${result}`);
    return result;
  } catch (err) {
    console.error(`[vk] ❌ sendText error:`, err.message);
    throw err;
  }
}

async function notifyManager(chatId, platform, text) {
  const platformLabel = platform === 'vk' ? 'VK' : 'Telegram';
  const msg = `💬 Сообщение вне сценария\n[${platformLabel}] ID: ${chatId}\n\n"${text}"`;
  try {
    await vk.api.messages.send({
      user_id:   config.MANAGER_VK_ID,
      message:   msg,
      random_id: Math.random() * 1e9 | 0,
    });
  } catch (err) {
    console.error('[vk] notifyManager error:', err.message);
  }
}

async function uploadDocument(peerId, filePath, filename) {
  const doc = await vk.upload.messageDocument({
    peer_id: Number(peerId),
    source:  { value: fs.createReadStream(filePath) },
    filename: filename,
  });
  const ownerId = doc.owner_id ?? doc.ownerId;
  return `doc${ownerId}_${doc.id}`;
}

async function handleAdminMessage(text, platform, chatId) {
  console.log(`[vk] handleAdminMessage called: text="${text}", platform=${platform}, chatId=${chatId}`);
  
  // Используем глобальный роутер для кросс-платформенной координации
  if (global.adminRouter) {
    const result = await global.adminRouter.handleAdminCommand(text, platform, chatId);
    
    console.log(`[vk] admin-router result:`, { 
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
        
        await vk.api.messages.send({
          user_id:   chatId,
          message:   result.text,
          random_id: Math.random() * 1e9 | 0,
          attachment: await uploadDocument(chatId, filePath, result.file.filename),
        });
        
        // Удаляем временный файл
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error('[vk] send file error:', err.message);
        // Fallback: отправляем как текст
        await vk.api.messages.send({
          user_id:   chatId,
          message:   result.text + '\n\n' + result.file.content,
          random_id: Math.random() * 1e9 | 0,
        });
      }
      return;
    }

    if (result.text) {
      try {
        await vk.api.messages.send({
          user_id:   chatId,
          message:   result.text,
          random_id: Math.random() * 1e9 | 0,
        });
      } catch (err) {
        console.error('[vk] send response error:', err.message);
      }
    }
  } else {
    // Fallback: используем локальный обработчик
    const result = handleAdminCommand(text, platform, chatId);

    if (result.broadcast && result.broadcast.length > 0) {
      for (const item of result.broadcast) {
        try {
          if (item.platform === 'vk') {
            await sendText(item.chatId, item.text);
          } else if (item.platform === 'telegram') {
            console.log(`[vk] broadcast skipped for telegram user ${item.chatId} (handled by telegram adapter)`);
          }
        } catch (err) {
          console.error('[vk] broadcast error:', err.message);
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

        await vk.api.messages.send({
          user_id:   chatId,
          message:   result.text,
          random_id: Math.random() * 1e9 | 0,
          attachment: await uploadDocument(chatId, filePath, result.file.filename),
        });

        fs.unlinkSync(filePath);
      } catch (err) {
        console.error('[vk] send file error:', err.message);
        await vk.api.messages.send({
          user_id:   chatId,
          message:   result.text + '\n\n' + result.file.content,
          random_id: Math.random() * 1e9 | 0,
        });
      }
      return;
    }

    if (result.text) {
      try {
        await vk.api.messages.send({
          user_id:   chatId,
          message:   result.text,
          random_id: Math.random() * 1e9 | 0,
        });
      } catch (err) {
        console.error('[vk] send response error:', err.message);
      }
    }
  }
}

function scheduleAutoProgress(chatId, newState) {
  if (newState !== 'MSG1_SENT' && newState !== 'MSG2_SENT') return;
  setTimeout(async () => {
    try {
      const result = flow.handleAction({ platform: 'vk', chatId, action: 'AUTO_PROGRESS' });
      if (result.messages.length > 0) {
        await send(chatId, result);
        scheduleAutoProgress(chatId, result.newState);
      }
    } catch (err) {
      console.error('[vk] auto-progress error:', err.message);
    }
  }, 30 * 1000);
}

async function handleMessage(msg) {
  const chatId = String(msg.peer_id);
  const fromId = msg.from_id;
  const text = msg.text || '';
  let payload = null;
  try { payload = msg.payload ? JSON.parse(msg.payload) : null; } catch {}

  console.log('[vk] message:', { chatId, fromId, text, payload });

  // Проверяем, является ли отправитель админом
  if (config.ADMIN_VK_IDS.includes(fromId)) {
    // Проверяем режим тестирования
    const testMode = store.isInTestMode('vk', chatId);
    
    // Если НЕ в режиме тестирования - обрабатываем только команды
    if (!testMode) {
      if (text.startsWith('/')) {
        try { await handleAdminMessage(text, 'vk', chatId); } 
        catch (err) { console.error('[vk] admin error:', err.message); }
      } else {
        console.log(`[vk] non-command from admin ${fromId} (not in test mode), ignoring`);
      }
      return;
    }
    
    // В режиме тестирования: команды всё ещё работают
    if (text.startsWith('/')) {
      try { await handleAdminMessage(text, 'vk', chatId); } 
      catch (err) { console.error('[vk] admin error:', err.message); }
      return;
    }
    // Иначе продолжаем обработку как обычный пользователь
  }

  try {
    // Проверяем payload нажатых кнопок
    if (payload?.action === 'next_1') {
      return await send(chatId, flow.handleAction({ platform: 'vk', chatId, action: 'BTN_NEXT_1' }));
    }
    if (payload?.action === 'next_2') {
      return await send(chatId, flow.handleAction({ platform: 'vk', chatId, action: 'BTN_NEXT_2' }));
    }

    const lower = text.toLowerCase();
    if (TRIGGER_WORDS.some(w => lower.includes(w))) {
      const result = flow.handleAction({ platform: 'vk', chatId, action: 'START' });
      await send(chatId, result);
      scheduleAutoProgress(chatId, result.newState);
      return;
    }

    const result = flow.handleAction({ platform: 'vk', chatId, action: 'TEXT', text });
    await send(chatId, result);

    // Уведомить менеджера если сообщение вне сценария
    if (result.notifyManager && result.originalText) {
      await notifyManager(chatId, 'vk', result.originalText);
    }
  } catch (err) {
    console.error('[vk] handle error:', err.message);
  }
}

async function startLongPoll() {
  await vk.api.groups.setLongPollSettings({
    group_id:    Number(config.VK_GROUP_ID),
    enabled:     1,
    api_version: '5.131',
    message_new: 1,
  });

  let lp = await vk.api.groups.getLongPollServer({ group_id: Number(config.VK_GROUP_ID) });
  let { server, key } = lp;
  let ts = lp.ts;

  console.log('[vk] long poll started, server:', server);

  while (true) {
    try {
      const url = `${server}?act=a_check&key=${key}&ts=${ts}&wait=25`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.failed) {
        console.log('[vk] long poll failed:', data.failed, '— reconnecting');
        lp = await vk.api.groups.getLongPollServer({ group_id: Number(config.VK_GROUP_ID) });
        server = lp.server;
        key = lp.key;
        ts = lp.ts;
        continue;
      }

      ts = data.ts;

      for (const update of data.updates || []) {
        if (update.type === 'message_new') {
          const msg = update.object?.message;
          if (msg) await handleMessage(msg);
        }
      }
    } catch (err) {
      console.error('[vk] long poll error:', err.message, '— retry in 3s');
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

async function preloadFiles() {
  const filenames = { combined: 'Гайд+Трекер.pdf', guide: 'Гайд.pdf', tracker: 'Трекер.pdf' };
  const PRELOAD_PEER = config.ADMIN_VK_IDS[0];

  for (const fileKey of ['combined', 'guide', 'tracker']) {
    if (vkFileIdCache[fileKey]) { console.log(`[vk] cache hit: ${fileKey}`); continue; }
    try {
      console.log(`[vk] preloading ${fileKey}...`);
      const doc = await vk.upload.messageDocument({
        peer_id: PRELOAD_PEER,
        source:  { value: fs.createReadStream(config.FILES[fileKey]), filename: filenames[fileKey] },
      });
      const ownerId = doc.owner_id ?? doc.ownerId;
      vkFileIdCache[fileKey] = `doc${ownerId}_${doc.id}`;
      saveVkFileIds(vkFileIdCache);
      console.log(`[vk] preloaded ${fileKey}`);
    } catch (err) {
      console.error(`[vk] preload error ${fileKey}:`, err.message);
    }
  }

  if (!vkFileIdCache.wallpapers) vkFileIdCache.wallpapers = [];
  for (let i = 0; i < config.FILES.wallpapers.length; i++) {
    if (vkFileIdCache.wallpapers[i]) { console.log(`[vk] cache hit: wallpaper ${i}`); continue; }
    try {
      console.log(`[vk] preloading wallpaper ${i}...`);
      const photo = await vk.upload.messagePhoto({
        peer_id: PRELOAD_PEER,
        source:  { value: fs.createReadStream(config.FILES.wallpapers[i]) },
      });
      const ownerId = photo.owner_id ?? photo.ownerId;
      vkFileIdCache.wallpapers[i] = `photo${ownerId}_${photo.id}`;
      saveVkFileIds(vkFileIdCache);
      console.log(`[vk] preloaded wallpaper ${i}`);
    } catch (err) {
      console.error(`[vk] preload error wallpaper ${i}:`, err.message);
    }
  }
}

async function preloadWithRetry() {
  while (true) {
    await preloadFiles();
    const allCached = ['combined', 'guide', 'tracker'].every(k => vkFileIdCache[k]) &&
      vkFileIdCache.wallpapers?.length === config.FILES.wallpapers.length;
    if (allCached) { console.log('[vk] all files preloaded'); break; }
    console.log('[vk] retrying preload in 30s...');
    await new Promise(r => setTimeout(r, 30000));
  }
}

function start() {
  vk = new VK({ token: config.VK_TOKEN, uploadTimeout: 120000 });
  startLongPoll().catch(err => console.error('[vk] fatal:', err.message));
  preloadWithRetry().catch(err => console.error('[vk] preload fatal:', err.message));
  console.log('[vk] bot started');
  return { send, sendText };
}

module.exports = { start, send, sendText };
