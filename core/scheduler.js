const store = require('./store');
const flow = require('./flow');
const config = require('../config');
const yookassa = require('./yookassa');
const m = require('./messages');

async function runAction(adapter, chatId, action, payload) {
  try {
    const result = flow.handleAction({ chatId, action, payload });
    if (result.messages && result.messages.length > 0) {
      if (result.createPayment && adapter.sendWithPayment) {
        await adapter.sendWithPayment(chatId, result);
      } else {
        await adapter.send(chatId, result);
      }
    }
  } catch (err) {
    console.error(`[scheduler] ${action} error for ${chatId}:`, err.message);
  }
}

function startScheduler(adapter) {

  // Фолбэк Экран 2 → Экран 3: если на экране ценности не нажали кнопку за
  // WELCOME_AUTO_SECONDS — авто-показ оффера (чтобы дойти до цены и попасть в дожимы)
  setInterval(async () => {
    const users = store.getPendingWelcome(config.WELCOME_AUTO_SECONDS);
    for (const user of users) {
      await runAction(adapter, user.chat_id, 'AUTO_WELCOME', null);
    }
  }, 15 * 1000);

  // Дожимы ожидания оплаты (тёплые «я жду» — 6ч/24ч/72ч из REMINDER_HOURS).
  // Оффер сразу переводит в AWAIT_PAYMENT_CLUB, так что дожимы живут тут. У каждого —
  // кнопка оплаты (по клику PAY_CLUB создаёт свежую ссылку, если первая устарела).
  setInterval(async () => {
    const reminders = config.REMINDER_HOURS;
    for (let i = 0; i < reminders.length; i++) {
      const users = store.getPendingPaymentReminders(i, reminders[i]);
      for (const user of users) {
        try {
          const result = flow.handleAction({ chatId: user.chat_id, action: 'REMINDER_PAYMENT', payload: i });
          if (result.messages && result.messages.length > 0) {
            await adapter.send(user.chat_id, result);
            store.incrementReminderCount(user.chat_id);
          }
        } catch (err) {
          console.error(`[scheduler] payment reminder error for ${user.chat_id}:`, err.message);
        }
      }
    }
  }, 60 * 60 * 1000);

  // ЮКасса поллинг — каждые 30 сек
  if (config.YOOKASSA_SHOP_ID) {
    setInterval(async () => {
      const pending = store.getPendingPayments();
      for (const { chat_id, payment_id } of pending) {
        try {
          const payment = await yookassa.getPayment(payment_id);
          if (payment.status === 'succeeded') {
            const user = store.getUser(chat_id);
            const product = user && user.product_type ? user.product_type : 'club';
            // Сразу сбрасываем payment_id чтобы следующий цикл не обработал повторно
            store.savePaymentId(chat_id, null);
            // Сохранённый метод оплаты (есть только если save_payment_method=true сработал —
            // т.е. в кабинете YooKassa подключены «Автоплатежи»). Если нет — paymentMethodId
            // будет undefined, handlePaymentSuccess просто не сохранит метод, но автопродление
            // всё равно встанет в auto_renew=1 (cron его пропустит из-за отсутствия метода).
            const paymentMethodId = payment.payment_method && payment.payment_method.saved
              ? payment.payment_method.id
              : undefined;
            const result = await flow.handlePaymentSuccess({
              chatId: chat_id,
              product,
              paymentMethodId,
              createInvite: (cid) => adapter.createClubInvite(cid),
            });
            if (result.messages && result.messages.length > 0) {
              await adapter.send(chat_id, result);
              for (const msg of result.trailingMessages || []) {
                await adapter.sendText(chat_id, msg.text);
              }
            }
            console.log(`[yookassa] ✅ payment confirmed for ${chat_id} (${product})${paymentMethodId ? ` [pm=${paymentMethodId}]` : ''}`);
          } else if (payment.status === 'canceled') {
            store.savePaymentId(chat_id, null);
          }
        } catch (err) {
          console.error(`[yookassa] poll error for ${chat_id}:`, err.message);
        }
      }
    }, 10 * 1000);
  }

  // Напоминания о продлении клуба + кик при истечении (каждый час, не ночью)
  setInterval(async () => {
    const moscowHour = new Date(Date.now() + 3 * 60 * 60 * 1000).getUTCHours();
    if (moscowHour >= 21 || moscowHour < 9) return;

    const sendClubReminder = async (user, text, reminderIdx) => {
      try {
        await adapter.send(user.chat_id, {
          messages: [{
            text,
            buttons3: [
              { label: m.BTN_RENEW_CLUB,  callback: 'renew_club' },
              { label: m.BTN_CLUB_CANCEL, callback: 'club_cancel' },
            ],
          }],
        });
        store.incrementClubReminder(user.chat_id);
        console.log(`[club] reminder ${reminderIdx} sent to ${user.chat_id}`);
      } catch (err) {
        console.error(`[club] reminder error for ${user.chat_id}:`, err.message);
      }
    };

    // За 3 дня (reminderCount = 0)
    for (const u of store.getPendingClubReminders(3, 0)) {
      await sendClubReminder(u, m.MSG_CLUB_REMINDER_3, 3);
    }
    // За 1 день (reminderCount = 1)
    for (const u of store.getPendingClubReminders(1, 1)) {
      await sendClubReminder(u, m.MSG_CLUB_REMINDER_1, 1);
    }
    // В день окончания (reminderCount = 2)
    for (const u of store.getPendingClubReminders(0, 2)) {
      await sendClubReminder(u, m.MSG_CLUB_REMINDER_0, 0);
    }

    // Кик тех, у кого истёк доступ (reminderCount >= 3 или club_cancel = 1)
    for (const user of store.getExpiredClubMembers()) {
      try {
        await adapter.kickFromClub(user.chat_id);
        store.saveClubExpiry(user.chat_id, null);
        // Прощальное сообщение + кнопка возобновить — только если не отписан (/stop)
        if (!user.opt_out) {
          await adapter.send(user.chat_id, {
            messages: [{
              text: m.MSG_CLUB_KICKED,
              button: { label: m.BTN_RESUME_CLUB, callback: 'renew_club' },
            }],
          });
        }
        console.log(`[club] kicked ${user.chat_id}${user.opt_out ? ' (opt_out, no farewell)' : ''}`);
      } catch (err) {
        console.error(`[club] kick error for ${user.chat_id}:`, err.message);
      }
    }
  }, 60 * 60 * 1000);

  // Автопродление клуба (off-session списание сохранённой картой).
  // Активно только при AUTORENEW_ENABLED=true (включается во .env после того, как
  // YooKassa активирует «Автоплатежи» в кабинете). До этого тексты UX про автопродление
  // показываются, но списание не идёт — работает старый ручной ремайндер.
  // Запускается раз в час; берёт пользователей с истечением в ближайшие 12 часов.
  if (config.AUTORENEW_ENABLED && config.YOOKASSA_SHOP_ID) {
    setInterval(async () => {
      const moscowHour = new Date(Date.now() + 3 * 60 * 60 * 1000).getUTCHours();
      if (moscowHour >= 21 || moscowHour < 9) return;

      const users = store.getUsersForAutoRenew(12);
      for (const user of users) {
        const chatId = user.chat_id;
        try {
          const payment = await yookassa.chargeSaved(
            user.payment_method_id,
            config.YOOKASSA_AMOUNT_CLUB,
            chatId,
            `Продление клуба «Первый шаг» — ${chatId}`
          );
          if (payment.status === 'succeeded') {
            const newExpiry = store.extendClubExpiry(chatId, config.CLUB_ACCESS_DAYS);
            await adapter.send(chatId, {
              messages: [{ text: m.MSG_AUTORENEW_SUCCESS(newExpiry) }],
            });
            console.log(`[autorenew] ✅ charged ${chatId} ${config.YOOKASSA_AMOUNT_CLUB}₽, next ${newExpiry}`);
          } else {
            // canceled / pending / waiting_for_capture — считаем неудачей, повторим через 6ч
            store.markAutorenewFailed(chatId);
            await adapter.send(chatId, {
              messages: [{
                text: m.MSG_AUTORENEW_FAILED,
                button: { label: m.BTN_RENEW_CLUB, callback: 'renew_club' },
              }],
            });
            console.warn(`[autorenew] ⚠️ ${chatId} status=${payment.status}`);
          }
        } catch (err) {
          // HTTP-ошибка YooKassa (карта истекла, отклонена, лимит) — фолбэк на ручное продление
          store.markAutorenewFailed(chatId);
          try {
            await adapter.send(chatId, {
              messages: [{
                text: m.MSG_AUTORENEW_FAILED,
                button: { label: m.BTN_RENEW_CLUB, callback: 'renew_club' },
              }],
            });
          } catch { /* notify failure не критично */ }
          console.error(`[autorenew] ❌ ${chatId}:`, err.response && err.response.data
            ? JSON.stringify(err.response.data)
            : err.message);
        }
      }
    }, 60 * 60 * 1000);
    console.log('[scheduler] autorenew job enabled');
  } else {
    console.log('[scheduler] autorenew DISABLED (AUTORENEW_ENABLED=false or no YOOKASSA_SHOP_ID)');
  }

  console.log('[scheduler] started');
}

module.exports = { startScheduler };
