const store = require('./store');
const flow = require('./flow');
const config = require('../config');
const yookassa = require('./yookassa');
const m = require('./messages');

function startScheduler(adapter) {
  // ── Поллинг ЮKassa каждые 10 с: успех → PDF, отказ → «попробовать ещё раз»
  if (config.YOOKASSA_SHOP_ID) {
    let busy = false;
    setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        for (const { chat_id, payment_id } of store.getPendingPayments()) {
          try {
            const payment = await yookassa.getPayment(payment_id);
            if (payment.status === 'succeeded') {
              // Статус фиксируем ДО отправки — следующий цикл не выдаст файл второй раз
              store.setPaymentStatus(payment_id, 'succeeded');
              const before = store.getUser(chat_id);
              const repeat = before && before.state === 'COMPLETED_GUIDE';
              store.savePaymentId(chat_id, null);
              await adapter.send(chat_id, flow.handlePaymentSuccess({ chatId: chat_id }));
              console.log(`[yookassa] ✅ ${payment_id} paid by ${chat_id}${repeat ? ' (ПОВТОРНАЯ оплата)' : ''}`);
              if (repeat) {
                await adapter.notifyManagerText(
                  `⚠️ Повторная оплата гайда: [Telegram] ID: ${chat_id}, платёж ${payment_id}. ` +
                  'Человек уже покупал — возможно, нужен возврат в кабинете ЮKassa.'
                );
              }
            } else if (payment.status === 'canceled') {
              const reason = payment.cancellation_details ? payment.cancellation_details.reason : null;
              store.setPaymentStatus(payment_id, 'canceled', reason);
              const u = store.getUser(chat_id);
              if (u && u.payment_id === payment_id) store.savePaymentId(chat_id, null);
              // Просто не стал платить (ссылка истекла) — молчим, дальше работают напоминания.
              // Реальный отказ банка — сразу предлагаем повторить.
              if (reason !== 'expired_on_confirmation' && u && u.state === 'AWAIT_PAYMENT_GUIDE') {
                await adapter.send(chat_id, flow.handlePaymentFailed());
              }
              console.log(`[yookassa] ✖ ${payment_id} canceled for ${chat_id} (${reason || '?'})`);
            }
          } catch (err) {
            console.error(`[yookassa] poll error ${payment_id}:`, err.message);
          }
        }
      } finally {
        busy = false;
      }
    }, 10 * 1000);
  } else {
    console.warn('[scheduler] YOOKASSA_SHOP_ID не задан — оплата не проверяется, PDF не выдаётся автоматически');
  }

  // ── Мотивационные напоминания: день 1/3/6 после оффера, 9:00–21:00 МСК.
  // Не купил — с кнопкой покупки. Купил — те же слова без кнопки (ТЗ п.4).
  setInterval(async () => {
    const hours = config.MOTIVATION_HOURS;
    for (let i = 0; i < hours.length; i++) {
      for (const user of store.getMotivationDue(i, hours[i])) {
        // Счётчик — до отправки: если человек заблокировал бота, не будем долбить каждый час
        store.incrementMotivation(user.chat_id);
        const text = m.MOTIVATION[i];
        const paid = user.state === 'COMPLETED_GUIDE';
        try {
          await adapter.send(user.chat_id, {
            messages: [paid ? { text } : { text, button: { label: m.BTN_BUY, callback: 'buy_guide' } }],
          });
          console.log(`[motivation] #${i + 1} → ${user.chat_id}${paid ? ' (купил)' : ''}`);
        } catch (err) {
          console.error(`[motivation] ${user.chat_id}:`, err.message);
        }
      }
    }
  }, 60 * 60 * 1000);

  console.log('[scheduler] started');
}

module.exports = { startScheduler };
