const store = require('./store');
const messages = require('./messages');
const config = require('../config');

function handleAction({ platform, chatId, action, text }) {
  const user = store.getUser(platform, chatId);
  const state = user ? user.state : null;
  const b = config.BANNERS;
  const tg = platform === 'telegram';

  // COMPLETED — ничего нового не происходит, включая /start
  if (state === 'COMPLETED') {
    return { messages: [{ text: messages.FALLBACK_COMPLETED }], files: [], newState: null, notifyManager: true, originalText: text };
  }

  // START — всегда перезапускает воронку (кроме COMPLETED выше)
  if (action === 'START') {
    store.upsertUser(platform, chatId, 'MSG1_SENT');
    return {
      messages: [{ text: messages.MSG_1, banner: b.msg1, ...(tg && { button: { label: messages.BTN_MSG1, callback: 'next_1' } }) }],
      files: [],
      newState: 'MSG1_SENT',
    };
  }

  if (action === 'BTN_NEXT_1') {
    if (state !== 'MSG1_SENT') return { messages: [], files: [], newState: null };
    store.upsertUser(platform, chatId, 'MSG2_SENT');
    return {
      messages: [{ text: messages.MSG_2, banner: b.msg2, ...(tg && { button: { label: messages.BTN_MSG2, callback: 'next_2' } }) }],
      files: [],
      newState: 'MSG2_SENT',
    };
  }

  if (action === 'BTN_NEXT_2') {
    if (state !== 'MSG2_SENT') return { messages: [], files: [], newState: null };
    store.upsertUser(platform, chatId, 'AWAIT_PAYMENT');
    return {
      messages: [{ text: messages.MSG_3, banner: b.msg3 }],
      files: [],
      newState: 'AWAIT_PAYMENT',
    };
  }

  if (action === 'AUTO_PROGRESS') {
    if (state === 'MSG1_SENT') {
      store.upsertUser(platform, chatId, 'MSG2_SENT');
      return {
        messages: [{ text: messages.MSG_2, banner: b.msg2, ...(tg && { button: { label: messages.BTN_MSG2, callback: 'next_2' } }) }],
        files: [],
        newState: 'MSG2_SENT',
      };
    }
    if (state === 'MSG2_SENT') {
      store.upsertUser(platform, chatId, 'AWAIT_PAYMENT');
      return {
        messages: [{ text: messages.MSG_3, banner: b.msg3 }],
        files: [],
        newState: 'AWAIT_PAYMENT',
      };
    }
    return { messages: [], files: [], newState: null };
  }

  if (action === 'TEXT') {
    if (state === 'AWAIT_PAYMENT') {
      const normalized = text.trim().toUpperCase();
      if (normalized === 'ГОТОВО') {
        store.upsertUser(platform, chatId, 'COMPLETED');
        return {
          messages: [{ text: messages.MSG_4, banner: b.msg4 }],
          files: ['combined', 'guide', 'tracker', 'wallpapers'],
          trailingMessages: [{ text: messages.MSG_FINAL }],
          newState: 'COMPLETED',
        };
      }
      return {
        messages: [{ text: messages.FALLBACK_PAYMENT[platform] }],
        files: [],
        newState: null,
        notifyManager: true,
        originalText: text,
      };
    }

    if (state === 'MSG1_SENT') {
      return {
        messages: [{ text: tg ? messages.FALLBACK_MID_FUNNEL : messages.FALLBACK_WAIT, ...(tg && { button: { label: messages.BTN_MSG1, callback: 'next_1' } }) }],
        files: [],
        newState: null,
        notifyManager: true,
        originalText: text,
      };
    }

    if (state === 'MSG2_SENT') {
      return {
        messages: [{ text: tg ? messages.FALLBACK_MID_FUNNEL : messages.FALLBACK_WAIT, ...(tg && { button: { label: messages.BTN_MSG2, callback: 'next_2' } }) }],
        files: [],
        newState: null,
        notifyManager: true,
        originalText: text,
      };
    }

    return {
      messages: [{ text: messages.FALLBACK_IDLE[platform] }],
      files: [],
      newState: null,
      notifyManager: true,
      originalText: text,
    };
  }

  return { messages: [], files: [], newState: null };
}

module.exports = { handleAction };
