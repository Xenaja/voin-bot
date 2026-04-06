const store = require('./store');
const messages = require('./messages');

function handleAction({ platform, chatId, action, text }) {
  const user = store.getUser(platform, chatId);
  const state = user ? user.state : null;

  // COMPLETED — ничего нового не происходит, включая /start
  if (state === 'COMPLETED') {
    return { messages: [{ text: messages.FALLBACK_COMPLETED }], files: [], newState: null };
  }

  // START — всегда перезапускает воронку (кроме COMPLETED выше)
  if (action === 'START') {
    store.upsertUser(platform, chatId, 'MSG1_SENT');
    return {
      messages: [{ text: messages.MSG_1, button: { label: messages.BTN_MSG1, callback: 'next_1' } }],
      files: [],
      newState: 'MSG1_SENT',
    };
  }

  if (action === 'BTN_NEXT_1') {
    if (state !== 'MSG1_SENT') return { messages: [], files: [], newState: null }; // устаревшая кнопка
    store.upsertUser(platform, chatId, 'MSG2_SENT');
    return {
      messages: [{ text: messages.MSG_2, button: { label: messages.BTN_MSG2, callback: 'next_2' } }],
      files: [],
      newState: 'MSG2_SENT',
    };
  }

  if (action === 'BTN_NEXT_2') {
    if (state !== 'MSG2_SENT') return { messages: [], files: [], newState: null }; // устаревшая кнопка
    store.upsertUser(platform, chatId, 'AWAIT_PAYMENT');
    return {
      messages: [{ text: messages.MSG_3 }],
      files: [],
      newState: 'AWAIT_PAYMENT',
    };
  }

  if (action === 'AUTO_PROGRESS') {
    if (state === 'MSG1_SENT') {
      store.upsertUser(platform, chatId, 'MSG2_SENT');
      return {
        messages: [{ text: messages.MSG_2, button: { label: messages.BTN_MSG2, callback: 'next_2' } }],
        files: [],
        newState: 'MSG2_SENT',
      };
    }
    if (state === 'MSG2_SENT') {
      store.upsertUser(platform, chatId, 'AWAIT_PAYMENT');
      return {
        messages: [{ text: messages.MSG_3 }],
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
          messages: [{ text: messages.MSG_4 }],
          files: ['guide', 'tracker', 'wallpaper'],
          newState: 'COMPLETED',
        };
      }
      return {
        messages: [{ text: messages.FALLBACK_PAYMENT[platform] }],
        files: [],
        newState: null,
      };
    }

    if (state === 'MSG1_SENT' || state === 'MSG2_SENT') {
      return {
        messages: [{ text: messages.FALLBACK_MID_FUNNEL }],
        files: [],
        newState: null,
      };
    }

    // state === null — пользователь пишет без /start
    return {
      messages: [{ text: messages.FALLBACK_IDLE[platform] }],
      files: [],
      newState: null,
    };
  }

  return { messages: [], files: [], newState: null };
}

module.exports = { handleAction };
