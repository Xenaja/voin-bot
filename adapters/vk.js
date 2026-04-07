const { VK, Keyboard } = require('vk-io');
const fs = require('fs');
const config = require('../config');
const flow = require('../core/flow');

const TRIGGER_WORDS = ['старт', 'start', 'начать', 'привет', 'хочу'];

let vk;

async function send(chatId, result) {
  for (const msg of result.messages) {
    const params = {
      peer_id:   Number(chatId),
      message:   msg.text,
      random_id: Math.random() * 1e9 | 0,
    };
    if (msg.button) {
      params.keyboard = Keyboard.builder()
        .textButton({ label: msg.button.label, payload: { action: msg.button.callback } })
        .oneTime();
    }
    await vk.api.messages.send(params);
  }

  for (const fileKey of result.files) {
    if (fileKey === 'wallpaper') {
      const photo = await vk.upload.messagePhoto({
        peer_id: Number(chatId),
        source:  { value: fs.createReadStream(config.FILES.wallpaper) },
      });
      await vk.api.messages.send({
        peer_id:    Number(chatId),
        attachment: `photo${photo.owner_id}_${photo.id}`,
        random_id:  Math.random() * 1e9 | 0,
      });
    } else {
      const doc = await vk.upload.messageDocument({
        peer_id: Number(chatId),
        source:  { value: fs.createReadStream(config.FILES[fileKey]), filename: `${fileKey}.pdf` },
      });
      await vk.api.messages.send({
        peer_id:    Number(chatId),
        attachment: `doc${doc.owner_id}_${doc.id}`,
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

async function handleMessage(obj) {
  const chatId = String(obj.peer_id);
  const text = obj.text || '';
  let payload = null;
  try { payload = obj.payload ? JSON.parse(obj.payload) : null; } catch {}

  console.log('[vk] message:', { chatId, text, payload });

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
    await send(chatId, flow.handleAction({ platform: 'vk', chatId, action: 'TEXT', text }));
  } catch (err) {
    console.error('[vk] handle error:', err.message);
  }
}

async function startLongPoll() {
  // Включаем нужные события
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
        console.log('[vk] event:', update.type);
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
