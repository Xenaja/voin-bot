const store = require('./store');
const flow = require('./flow');
const messages = require('./messages');

function startScheduler(adapters) {
  // Авто-продвижение — каждые 5 минут
  setInterval(async () => {
    for (const platform of ['telegram', 'vk']) {
      if (!adapters[platform]) continue;
      const users = store.getPendingAutoProgress(platform);
      for (const user of users) {
        try {
          const result = flow.handleAction({
            platform,
            chatId: user.chat_id,
            action: 'AUTO_PROGRESS',
          });
          if (result.messages.length > 0) {
            await adapters[platform].send(user.chat_id, result);
          }
        } catch (err) {
          console.error(`[scheduler] auto-progress error [${platform}] ${user.chat_id}:`, err.message);
        }
      }
    }
  }, 5 * 60 * 1000);

  // Напоминания об оплате — каждые 60 минут
  setInterval(async () => {
    for (const platform of ['telegram', 'vk']) {
      if (!adapters[platform]) continue;
      const users = store.getPendingReminders(platform);
      for (const user of users) {
        try {
          const text = user.reminder_count === 0
            ? messages.REMINDER_1_AWAIT_PAYMENT
            : messages.REMINDER_2_AWAIT_PAYMENT;
          await adapters[platform].sendText(user.chat_id, text);
          store.incrementReminderCount(platform, user.chat_id);
        } catch (err) {
          console.error(`[scheduler] reminder error [${platform}] ${user.chat_id}:`, err.message);
        }
      }
    }
  }, 60 * 60 * 1000);
}

module.exports = { startScheduler };
