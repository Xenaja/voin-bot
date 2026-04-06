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
        .oneTime()
        .build();
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

function start() {
  vk = new VK({ token: config.VK_TOKEN });

  vk.updates.on('message_new', async (context) => {
    const chatId = String(context.peerId);
    const text = context.text || '';
    const payload = context.messagePayload;

    try {
      // Нажатие кнопки — определяем по payload
      if (payload && payload.action === 'next_1') {
        const result = flow.handleAction({ platform: 'vk', chatId, action: 'BTN_NEXT_1' });
        await send(chatId, result);
        return;
      }
      if (payload && payload.action === 'next_2') {
        const result = flow.handleAction({ platform: 'vk', chatId, action: 'BTN_NEXT_2' });
        await send(chatId, result);
        return;
      }

      // Триггерные слова — запуск воронки (проверка «содержит»)
      const lower = text.toLowerCase();
      if (TRIGGER_WORDS.some(word => lower.includes(word))) {
        const result = flow.handleAction({ platform: 'vk', chatId, action: 'START' });
        await send(chatId, result);
        return;
      }

      // Обычный текст
      const result = flow.handleAction({ platform: 'vk', chatId, action: 'TEXT', text });
      await send(chatId, result);
    } catch (err) {
      console.error('[vk] message_new error:', err.message);
    }
  });

  vk.updates.start({ pollingGroupId: Number(config.VK_GROUP_ID) });
  console.log('[vk] bot started');

  return { send, sendText };
}

module.exports = { start, send, sendText };
