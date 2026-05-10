const store = require('./store');
const flow = require('./flow');
const config = require('../config');

async function runAction(adapter, chatId, action) {
  try {
    const result = flow.handleAction({ chatId, action, payload: null });
    if (result.messages && result.messages.length > 0) {
      await adapter.send(chatId, result);
    }
  } catch (err) {
    console.error(`[scheduler] ${action} error for ${chatId}:`, err.message);
  }
}

function startScheduler(adapter) {
  // Авто-прогрессия прогрева (RESULT → … → OFFER) через 30 сек (проверяем каждые 15 сек)
  setInterval(async () => {
    const users = store.getPendingWarmup(config.WARMUP_AUTO_MINUTES);
    for (const user of users) {
      const actionMap = {
        RESULT_SENT:   'AUTO_RESULT',
        VIDEO_SENT:    'AUTO_VIDEO',
        WALLS_SENT:    'AUTO_WALLS',
        WARMUP1_SENT:  'AUTO_WARMUP1',
        WARMUP2_SENT:  'AUTO_WARMUP2',
        WARMUP_B_SENT: 'AUTO_WARMUP_B',
      };
      const action = actionMap[user.state];
      if (action) await runAction(adapter, user.chat_id, action);
    }
  }, 15 * 1000);

  // Авто-прогрессия OFFER_SEEN → AWAIT_PAYMENT через 1 минуту
  setInterval(async () => {
    const users = store.getPendingOfferSeen(1);
    for (const user of users) {
      await runAction(adapter, user.chat_id, 'AUTO_OFFER_SEEN');
    }
  }, 30 * 1000);

  // Ремайндеры при зависании на вопросе теста (24ч, один раз)
  setInterval(async () => {
    const users = store.getPendingQuizReminders(config.QUIZ_REMINDER_HOURS);
    for (const user of users) {
      try {
        const result = flow.handleAction({ chatId: user.chat_id, action: 'QUIZ_REMINDER', payload: null });
        if (result.messages && result.messages.length > 0) {
          await adapter.send(user.chat_id, result);
          store.incrementReminderCount(user.chat_id);
        }
      } catch (err) {
        console.error(`[scheduler] quiz reminder error for ${user.chat_id}:`, err.message);
      }
    }
  }, 60 * 60 * 1000);

  // Дожим (MSG12) — на следующий день после ремайндеров, не ночью (reminder_count >= 2, 24ч+)
  setInterval(async () => {
    const moscowHour = new Date(Date.now() + 3 * 60 * 60 * 1000).getUTCHours();
    if (moscowHour >= 22 || moscowHour < 9) return;
    const users = store.getPendingOfferFollowup(config.OFFER_FOLLOWUP_HOURS);
    for (const user of users) {
      try {
        const result = flow.handleAction({ chatId: user.chat_id, action: 'OFFER_FOLLOWUP', payload: null });
        if (result.messages && result.messages.length > 0) {
          await adapter.send(user.chat_id, result);
          store.incrementReminderCount(user.chat_id);
        }
      } catch (err) {
        console.error(`[scheduler] offer followup error for ${user.chat_id}:`, err.message);
      }
    }
  }, 60 * 60 * 1000);

  // Ремайндеры ожидания оплаты (через 1ч и 4ч, не ночью)
  setInterval(async () => {
    const users = store.getPendingPaymentReminders();
    for (const user of users) {
      try {
        const result = flow.handleAction({ chatId: user.chat_id, action: 'REMINDER_PAYMENT', payload: null });
        if (result.messages && result.messages.length > 0) {
          await adapter.send(user.chat_id, result);
          store.incrementReminderCount(user.chat_id);
        }
      } catch (err) {
        console.error(`[scheduler] payment reminder error for ${user.chat_id}:`, err.message);
      }
    }
  }, 60 * 60 * 1000);

  console.log('[scheduler] started');
}

module.exports = { startScheduler };
