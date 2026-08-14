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

  // Авто-цепочка знакомства (Шаг 1→2→3) идёт прямо в момент клика «Начать» с точными
  // задержками (delayBefore в адаптере) — планировщик для неё не нужен.
  // Дожимов до оффера нет: кто застрял на Шаге 3/4, напоминаний не получает.

  // Дожимы ожидания оплаты (день 1/3/6 из REMINDER_HOURS) — ТОЛЬКО для AWAIT_PAYMENT_CLUB
  // (кто дошёл до оффера, но не оплатил). У каждого — кнопка оплаты (PAY_CLUB создаёт
  // свежую ссылку, если первая устарела).
  // Пока клуб бесплатный — не догоняем людей просьбой оплатить то, что стало даром.
  if (!config.CLUB_FREE_STUB) setInterval(async () => {
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

  // Напоминания о продлении клуба + кик при истечении (каждый час, не ночью).
  // Не запускается вовсе, пока клуб бесплатный: продлевать нечего, кикать некого.
  if (config.CLUB_SUBSCRIPTION_ENABLED) setInterval(async () => {
    const moscowHour = new Date(Date.now() + 3 * 60 * 60 * 1000).getUTCHours();
    if (moscowHour >= 21 || moscowHour < 9) return;

    // Спишется ли у пользователя автоматически? Только если ЮКасса сохранила метод оплаты
    // (карта — СБП/T-Bank/SberPay/ЮMoney не сохраняются), автопродление не отключено
    // и сам механизм автосписания включён. От этого зависит ТЕКСТ напоминания.
    const willAutoCharge = (user) => Boolean(
      config.AUTORENEW_ENABLED
      && user.payment_method_id
      && (user.auto_renew === null || user.auto_renew === undefined || user.auto_renew === 1)
      && !user.club_cancel
    );

    // Три варианта текста: trial (зашёл бесплатно по акции, не платил ни разу) /
    // auto (карта сохранена, спишется само) / manual (продлевает руками).
    const sendClubReminder = async (user, autoText, manualText, trialText, reminderIdx) => {
      const trial = Number(user.trial) === 1;
      const auto = !trial && willAutoCharge(user);
      try {
        await adapter.send(user.chat_id, {
          messages: [{
            text: trial ? trialText : (auto ? autoText : manualText),
            // Кнопку «Отключить автопродление» показываем только тем, у кого автосписание
            // реально произойдёт — остальным отключать нечего.
            ...(auto
              ? { buttons3: [
                  { label: m.BTN_RENEW_CLUB,  callback: 'renew_club' },
                  { label: m.BTN_CLUB_CANCEL, callback: 'club_cancel' },
                ] }
              : { button: { label: trial ? m.BTN_TRIAL_SUBSCRIBE : m.BTN_RENEW_CLUB, callback: 'renew_club' } }),
          }],
        });
        store.incrementClubReminder(user.chat_id);
        console.log(`[club] reminder ${reminderIdx} sent to ${user.chat_id} (${trial ? 'trial' : auto ? 'auto' : 'manual'})`);
      } catch (err) {
        console.error(`[club] reminder error for ${user.chat_id}:`, err.message);
      }
    };

    // За 3 дня — истечение через 48–72ч (reminderCount = 0)
    for (const u of store.getPendingClubReminders(48, 72, 0)) {
      await sendClubReminder(u, m.MSG_CLUB_REMINDER_3, m.MSG_CLUB_MANUAL_REMINDER_3, m.MSG_CLUB_TRIAL_REMINDER_3, 3);
    }
    // За сутки — истечение через 12–36ч (reminderCount = 1)
    for (const u of store.getPendingClubReminders(12, 36, 1)) {
      await sendClubReminder(u, m.MSG_CLUB_REMINDER_1, m.MSG_CLUB_MANUAL_REMINDER_1, m.MSG_CLUB_TRIAL_REMINDER_1, 1);
    }
    // В последний день — истечение в ближайшие 12ч, ещё ДО кика (reminderCount = 2)
    for (const u of store.getPendingClubReminders(0, 12, 2)) {
      await sendClubReminder(u, m.MSG_CLUB_REMINDER_0, m.MSG_CLUB_MANUAL_REMINDER_0, m.MSG_CLUB_TRIAL_REMINDER_0, 0);
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

  // Акция «бесплатный месяц» 06.08: работа с теми, кто перешёл по диплинку, но НЕ нажал кнопку.
  // До закрытия окна — «последний созыв» в интервале TRIAL_REMIND_FROM..UNTIL (18:00–22:00 МСК,
  // reminder_count как флаг отправки). После закрытия — сообщение «вход закрыт» с кнопкой
  // обычной оплаты и перевод в AWAIT_PAYMENT_CLUB (дальше штатные дожимы день 1/3/6).
  // Тоже выключено при бесплатном клубе: эта ветка после закрытия акции переводила
  // зависших в «оплати 690 ₽».
  if (!config.CLUB_FREE_STUB) setInterval(async () => {
    const now = new Date();
    if (now < new Date(config.TRIAL_END)) {
      if (now >= new Date(config.TRIAL_REMIND_FROM) && now < new Date(config.TRIAL_REMIND_UNTIL)) {
        for (const u of store.getTrialLastCallPending()) {
          try {
            await adapter.send(u.chat_id, {
              messages: [{
                text: m.MSG_TRIAL_LASTCALL,
                button: { label: m.BTN_TRIAL_LASTCALL, callback: 'trial_join' },
              }],
            });
            store.incrementReminderCount(u.chat_id);
            console.log(`[trial] last call sent to ${u.chat_id}`);
          } catch (err) {
            console.error(`[trial] last call error for ${u.chat_id}:`, err.message);
          }
        }
      }
      return;
    }

    // Окно закрыто — не будим ночью (9:00–21:00 МСК)
    const moscowHour = new Date(Date.now() + 3 * 60 * 60 * 1000).getUTCHours();
    if (moscowHour >= 21 || moscowHour < 9) return;

    for (const u of store.getTrialOfferUsers()) {
      // Стейт меняем ДО отправки: если юзер заблокировал бота, не долбим его каждый час
      store.upsertUser(u.chat_id, 'AWAIT_PAYMENT_CLUB');
      store.saveProductType(u.chat_id, 'club');
      try {
        await adapter.send(u.chat_id, {
          messages: [{
            text: m.MSG_TRIAL_CLOSED,
            parseMode: 'HTML',
            button: { label: m.BTN_TRIAL_CLOSED_PAY, callback: 'pay_club' },
          }],
        });
        console.log(`[trial] closed notice sent to ${u.chat_id}`);
      } catch (err) {
        console.error(`[trial] closed notice error for ${u.chat_id}:`, err.message);
      }
    }
  }, 60 * 60 * 1000);

  // Автопродление клуба (off-session списание сохранённой картой).
  // Активно только при AUTORENEW_ENABLED=true (включается во .env после того, как
  // YooKassa активирует «Автоплатежи» в кабинете). До этого тексты UX про автопродление
  // показываются, но списание не идёт — работает старый ручной ремайндер.
  // Запускается раз в час; берёт пользователей с истечением в ближайшие 12 часов.
  if (config.CLUB_SUBSCRIPTION_ENABLED && config.AUTORENEW_ENABLED && config.YOOKASSA_SHOP_ID) {
    setInterval(async () => {
      const moscowHour = new Date(Date.now() + 3 * 60 * 60 * 1000).getUTCHours();
      if (moscowHour >= 21 || moscowHour < 9) return;

      const users = store.getUsersForAutoRenew(12);
      for (const user of users) {
        const chatId = user.chat_id;
        // Повторная попытка (cooldown 6ч) идёт с ТЕМ ЖЕ ключом идемпотентности — привязан
        // к периоду подписки. ЮКасса на повтор вернёт уже созданный платёж, а не спишет второй раз.
        const idempotenceKey = `renew-${chatId}-${user.club_expires_at}`;
        const isRetry = Boolean(user.autorenew_failed_at);
        try {
          const payment = await yookassa.chargeSaved(
            user.payment_method_id,
            config.YOOKASSA_AMOUNT_CLUB,
            chatId,
            `Продление клуба «Первый шаг» — ${chatId}`,
            idempotenceKey
          );
          if (payment.status === 'succeeded') {
            const newExpiry = store.extendClubExpiry(chatId, config.CLUB_ACCESS_DAYS);
            await adapter.send(chatId, {
              messages: [{ text: m.MSG_AUTORENEW_SUCCESS(newExpiry) }],
            });
            console.log(`[autorenew] ✅ charged ${chatId} ${config.YOOKASSA_AMOUNT_CLUB}₽, next ${newExpiry}`);
          } else {
            // canceled — окончательный отказ (карта, лимит, 3DS): пишем сразу.
            // pending / waiting_for_capture — платёж ещё в процессе: на ПЕРВОЙ попытке молчим,
            // через 6ч тот же ключ вернёт финальный статус. Пугаем только если и тогда не успех.
            const terminal = payment.status === 'canceled';
            store.markAutorenewFailed(chatId);
            if (terminal || isRetry) {
              await adapter.send(chatId, {
                messages: [{
                  text: m.MSG_AUTORENEW_FAILED,
                  button: { label: m.BTN_RENEW_CLUB, callback: 'renew_club' },
                }],
              });
            }
            const cd = payment.cancellation_details;
            console.warn(`[autorenew] ⚠️ ${chatId} status=${payment.status}`
              + (cd ? ` reason=${cd.party}/${cd.reason}` : '')
              + (terminal || isRetry ? ' [user notified]' : ' [silent, will retry]'));
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
    console.log('[scheduler] autorenew DISABLED'
      + (config.CLUB_SUBSCRIPTION_ENABLED ? '' : ' (клуб бесплатный: CLUB_SUBSCRIPTION_ENABLED=false)'));
  }

  if (!config.CLUB_SUBSCRIPTION_ENABLED) {
    console.log('[scheduler] клуб бесплатный: напоминания о продлении, кик из канала и списания выключены');
  }
  if (config.CLUB_FREE_STUB) {
    console.log('[scheduler] заглушка включена: дожимы оплаты и trial-рассылка выключены');
  }

  console.log('[scheduler] started');
}

module.exports = { startScheduler };
