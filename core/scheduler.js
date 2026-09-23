const store = require('./store');
const flow = require('./flow');
const messages = require('./messages');
const config = require('../config');
const reactivation = require('./reactivation');

function startScheduler(adapters) {
  // Авто-продвижение — только Telegram (VK делает это сам через setTimeout в адаптере)
  setInterval(async () => {
    for (const platform of ['telegram']) {
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

  // Ре-активационная рассылка покупателям «Кода Воина» (только Telegram) — каждый час.
  // По шагам 0..4 с задержками REACTIVATE_DELAYS_H. Перед отправкой — проверка: если уже
  // оплатил клуб в v2 (по TG-id), помечаем paid и дальше не дожимаем.
  setInterval(async () => {
    if (!adapters.telegram) return;
    const delays = config.REACTIVATE_DELAYS_H;
    for (let step = 0; step < delays.length; step++) {
      const rows = store.getDueReactivation(step, delays[step]);
      for (const row of rows) {
        try {
          if (store.isClubMemberInV2(row.chat_id)) {
            store.markReactivationPaid(row.chat_id);
            continue;
          }
          const result = reactivation.buildStepMessage(step);
          if (result) {
            await adapters.telegram.send(row.chat_id, result);
            store.advanceReactivation(row.chat_id);
          }
        } catch (err) {
          // Ошибка отправки (напр. пользователь заблокировал бота) — продвигаем шаг,
          // чтобы не залипать на нём и не долбить в цикле.
          console.error(`[reactivation] step ${step} error ${row.chat_id}:`, err.message);
          store.advanceReactivation(row.chat_id);
        }
      }
    }
  }, 60 * 60 * 1000);
}

module.exports = { startScheduler };
