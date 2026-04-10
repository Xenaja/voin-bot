const { VK, Keyboard } = require('vk-io');
const fs = require('fs');
const config = require('../config');
const flow = require('../core/flow');
const { handleAdminCommand } = require('../core/admin');

const TRIGGER_WORDS = ['старт', 'start', 'начать', 'привет', 'хочу'];

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
      for (const photoPath of config.FILES.wallpapers) {
        const photo = await vk.upload.messagePhoto({
          peer_id: Number(chatId),
          source:  { value: fs.createReadStream(photoPath) },
        });
        const ownerId = photo.owner_id ?? photo.ownerId;
        await vk.api.messages.send({
          peer_id:    Number(chatId),
          message:    ' ',
          attachment: `photo${ownerId}_${photo.id}`,
          random_id:  Math.random() * 1e9 | 0,
        });
      }
    } else {
      const doc = await vk.upload.messageDocument({
        peer_id: Number(chatId),
        source:  { value: fs.createReadStream(config.FILES[fileKey]), filename: filenames[fileKey] },
      });
      const ownerId = doc.owner_id ?? doc.ownerId;
      await vk.api.messages.send({
        peer_id:    Number(chatId),
        message:    ' ',
        attachment: `doc${ownerId}_${doc.id}`,
        random_id:  Math.random() * 1e9 | 0,
      });
    }
  }
}

async function sendText(chatId, text) {
  await vk.api.messages.send({
    peer_id:   Number(chatId),
    message:   text,
    random_id: Math.random() * 1e9 | 0,
  });
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

async function handleAdminMessage(text) {
  const result = handleAdminCommand(text);

  if (result.broadcast && result.broadcast.length > 0) {
    for (const item of result.broadcast) {
      try {
        if (item.platform === 'vk') {
          await sendText(item.chatId, item.text);
        }
        // Telegram broadcast — через telegram adapter (пока только VK)
      } catch (err) {
        console.error('[vk] broadcast error:', err.message);
      }
    }
  }

  if (result.file) {
    // Отправляем CSV как документ
    const buf = Buffer.from(result.file.content, 'utf-8');
    const doc = await vk.upload.messageDocument({
      peer_id: config.ADMIN_VK_ID,
      source:  { value: buf, filename: result.file.filename, contentType: 'text/csv' },
    });
    await vk.api.messages.send({
      user_id:    config.ADMIN_VK_ID,
      message:    result.text,
      attachment: `doc${doc.owner_id ?? doc.ownerId}_${doc.id}`,
      random_id:  Math.random() * 1e9 | 0,
    });
    return;
  }

  await vk.api.messages.send({
    user_id:   config.ADMIN_VK_ID,
    message:   result.text,
    random_id: Math.random() * 1e9 | 0,
  });
}

async function handleMessage(msg) {
  const chatId = String(msg.peer_id);
  const fromId = msg.from_id;
  const text = msg.text || '';
  let payload = null;
  try { payload = msg.payload ? JSON.parse(msg.payload) : null; } catch {}

  console.log('[vk] message:', { chatId, fromId, text, payload });

  // Сообщение от админа — обрабатываем команды
  if (fromId === config.ADMIN_VK_ID && text.startsWith('/')) {
    try { await handleAdminMessage(text); } catch (err) { console.error('[vk] admin error:', err.message); }
    return;
  }

  try {
    if (payload?.action === 'next_1') {
      return await send(chatId, flow.handleAction({ platform: 'vk', chatId, action: 'BTN_NEXT_1' }));
    }
    if (payload?.action === 'next_2') {
      return await send(chatId, flow.handleAction({ platform: 'vk', chatId, action: 'BTN_NEXT_2' }));
    }

    const lower = text.toLowerCase();
    if (TRIGGER_WORDS.some(w => lower.includes(w))) {
      return await send(chatId, flow.handleAction({ platform: 'vk', chatId, action: 'START' }));
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

function start() {
  vk = new VK({ token: config.VK_TOKEN });
  startLongPoll().catch(err => console.error('[vk] fatal:', err.message));
  console.log('[vk] bot started');
  return { send, sendText };
}

module.exports = { start, send, sendText };
