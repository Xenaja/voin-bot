const store = require('./store');
const m = require('./messages');
const config = require('../config');

// Путь (ТЗ 10.11.2026): /start → приветствие + согласие → «Начать» → картинка + оффер гайда
// с кнопкой оплаты → ЮKassa → автоматическая выдача PDF.
//
// Состояния: CONSENT_SENT → AWAIT_PAYMENT_GUIDE → COMPLETED_GUIDE.
// Результат handleAction — { messages, createPayment?, files?, notifyManager?, originalText? }.
// createPayment: адаптер создаёт платёж ЮKassa и вешает кнопку оплаты на последнее сообщение.

function buyButton(label = m.BTN_BUY) {
  return { label, callback: 'buy_guide' };
}

function handleAction({ chatId, action, payload }) {
  const user = store.getUser(chatId);
  const state = user ? user.state : null;
  const paid = state && state.startsWith('COMPLETED_');

  // Купившему повторно не продаём: на /start, кнопки и текст — экран «гайд уже у тебя»
  if (paid) {
    if (action === 'RESEND_GUIDE') {
      return { messages: [], files: ['guide'] };
    }
    if (action === 'TEXT') {
      return {
        messages: [{ text: m.FALLBACK_COMPLETED, button: { label: m.BTN_RESEND, callback: 'resend_guide' } }],
        notifyManager: true, originalText: payload,
      };
    }
    if (action === 'START' || action === 'BTN_CONSENT' || action === 'BUY') {
      return { messages: [{ text: m.FALLBACK_COMPLETED, button: { label: m.BTN_RESEND, callback: 'resend_guide' } }] };
    }
    return { messages: [] };
  }

  // /start — приветствие и согласие
  if (action === 'START') {
    store.upsertUser(chatId, 'CONSENT_SENT');
    store.setStartedAt(chatId, payload);
    store.setOptOut(chatId, false); // вернулся по /start — снова получает напоминания
    return {
      messages: [{
        text: m.MSG_CONSENT,
        parseMode: 'HTML',
        button: { label: m.BTN_CONSENT, callback: 'consent' },
      }],
    };
  }

  // «Начать» → картинка «Код Воина» + оффер; кнопка оплаты — сразу под оффером
  if (action === 'BTN_CONSENT') {
    if (state !== 'CONSENT_SENT') return { messages: [] };
    store.upsertUser(chatId, 'AWAIT_PAYMENT_GUIDE');
    store.saveProductType(chatId, 'guide');
    store.markOffered(chatId);
    return {
      messages: [{ banner: config.GUIDE_BANNER, text: m.MSG_GUIDE_OFFER }],
      createPayment: { product: 'guide', label: m.BTN_BUY },
    };
  }

  // Кнопка покупки из напоминания / «попробовать ещё раз» — всегда свежая ссылка
  if (action === 'BUY') {
    if (state !== 'AWAIT_PAYMENT_GUIDE' && state !== 'CONSENT_SENT') return { messages: [] };
    if (state === 'CONSENT_SENT') {
      store.upsertUser(chatId, 'AWAIT_PAYMENT_GUIDE');
      store.saveProductType(chatId, 'guide');
      store.markOffered(chatId);
    }
    return {
      messages: [{ text: m.MSG_PAY_LINK }],
      createPayment: { product: 'guide', label: m.BTN_BUY },
    };
  }

  // Мотивационное напоминание (scheduler). payload = индекс в MOTIVATION.
  if (action === 'MOTIVATION') {
    const idx = typeof payload === 'number' ? payload : 0;
    const text = m.MOTIVATION[idx] || m.MOTIVATION[m.MOTIVATION.length - 1];
    return { messages: [{ text, button: buyButton() }] };
  }

  // Текст от пользователя
  if (action === 'TEXT') {
    if (state === 'AWAIT_PAYMENT_GUIDE') {
      return {
        messages: [{ text: m.FALLBACK_AWAIT_PAYMENT, button: buyButton() }],
        notifyManager: true, originalText: payload,
      };
    }
    if (state === 'CONSENT_SENT') {
      return {
        messages: [{ text: m.FALLBACK_PRESS_BUTTON, button: { label: m.BTN_CONSENT, callback: 'consent' } }],
        notifyManager: true, originalText: payload,
      };
    }
    return { messages: [{ text: m.FALLBACK_IDLE }], notifyManager: true, originalText: payload };
  }

  return { messages: [] };
}

// Успешная оплата (вызывает поллер ЮKassa): статус, текст благодарности и PDF
function handlePaymentSuccess({ chatId }) {
  store.upsertUser(chatId, 'COMPLETED_GUIDE');
  store.saveProductType(chatId, 'guide');
  store.setCompletedAt(chatId);
  return { messages: [{ text: m.MSG_PAID }], files: ['guide'] };
}

// Платёж отклонён — предложить повторить (свежая ссылка по кнопке)
function handlePaymentFailed() {
  return { messages: [{ text: m.MSG_PAYMENT_FAILED, button: buyButton(m.BTN_RETRY) }] };
}

module.exports = { handleAction, handlePaymentSuccess, handlePaymentFailed };
