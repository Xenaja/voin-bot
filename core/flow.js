const store = require('./store');
const m = require('./messages');
const config = require('../config');
const yookassa = require('./yookassa');

// Суммы по типу продукта
const AMOUNTS = {
  guide:  config.YOOKASSA_AMOUNT_GUIDE,
  club:   config.YOOKASSA_AMOUNT_CLUB,
  bundle: config.YOOKASSA_AMOUNT_BUNDLE,
};

// Состояния ожидания оплаты по продукту
const AWAIT_STATES = {
  guide:  'AWAIT_PAYMENT_GUIDE',
  club:   'AWAIT_PAYMENT_CLUB',
  bundle: 'AWAIT_PAYMENT_BUNDLE',
};

// Завершённые состояния по продукту
const COMPLETED_STATES = {
  guide:  'COMPLETED_GUIDE',
  club:   'COMPLETED_CLUB',
  bundle: 'COMPLETED_BUNDLE',
};

function handleAction({ chatId, action, payload }) {
  const user = store.getUser(chatId);
  const state = user ? user.state : null;

  // Уже завершили — отвечаем стандартно
  if (state && state.startsWith('COMPLETED_')) {
    return { messages: [{ text: m.FALLBACK_COMPLETED }] };
  }

  // /start — показываем согласие
  if (action === 'START') {
    store.upsertUser(chatId, 'CONSENT_SENT');
    store.setStartedAt(chatId, payload);
    return {
      messages: [{
        text: m.MSG_CONSENT,
        parseMode: 'HTML',
        button: { label: m.BTN_CONSENT, callback: 'consent' },
      }],
    };
  }

  // Кнопка «Начать» (согласие)
  if (action === 'BTN_CONSENT') {
    if (state !== 'CONSENT_SENT') return { messages: [] };
    store.upsertUser(chatId, 'WELCOME_SENT');
    return {
      messages: [{
        text: m.MSG1,
        banner: config.BANNERS.msg0,
        button: { label: m.BTN_WATCH_VIDEO, callback: 'watch_video' },
      }],
    };
  }

  // Кнопка «Смотреть видео» / авто WELCOME→VIDEO
  if (action === 'BTN_WATCH_VIDEO' || action === 'AUTO_WELCOME') {
    if (state !== 'WELCOME_SENT') return { messages: [] };
    store.upsertUser(chatId, 'VIDEO_SENT');
    const hasVideo = !!config.VIDEO_FILE;
    return {
      messages: [{
        text: hasVideo ? m.MSG2 : m.MSG2_NO_VIDEO,
        parseMode: hasVideo ? null : 'HTML',
        video: hasVideo ? config.VIDEO_FILE : null,
        button: null, // кнопки нет — авто через 30 сек
      }],
    };
  }

  // Авто VIDEO→OFFER
  if (action === 'AUTO_VIDEO') {
    if (state !== 'VIDEO_SENT') return { messages: [] };
    store.upsertUser(chatId, 'OFFER_SENT');
    return {
      messages: [{
        text: m.MSG3,
        buttons3: [
          { label: m.BTN_BUY_GUIDE,  callback: 'buy_guide' },
          { label: m.BTN_BUY_BUNDLE, callback: 'buy_bundle' },
          { label: m.BTN_BUY_CLUB,   callback: 'buy_club' },
        ],
      }],
    };
  }

  // Просмотр тарифа — доступно из OFFER_SENT и AWAIT_PAYMENT_* (если передумал)
  if (action === 'BTN_BUY_GUIDE' || action === 'BTN_BUY_CLUB' || action === 'BTN_BUY_BUNDLE') {
    const canView = state === 'OFFER_SENT' || (state && state.startsWith('AWAIT_PAYMENT_'));
    if (!canView) return { messages: [] };
    const productMap = {
      BTN_BUY_GUIDE:  { product: 'guide',  text: m.MSG_GUIDE,  payBtn: m.BTN_PAY_GUIDE,  payCallback: 'pay_guide' },
      BTN_BUY_CLUB:   { product: 'club',   text: m.MSG_CLUB,   payBtn: m.BTN_PAY_CLUB,   payCallback: 'pay_club' },
      BTN_BUY_BUNDLE: { product: 'bundle', text: m.MSG_BUNDLE, payBtn: m.BTN_PAY_BUNDLE, payCallback: 'pay_bundle' },
    };
    const { text, payBtn, payCallback } = productMap[action];
    // Состояние НЕ меняем — пользователь может вернуться и выбрать другой тариф
    return {
      messages: [{ text, button: { label: payBtn, callback: payCallback } }],
    };
  }

  // Подтверждение оплаты — доступно из OFFER_SENT и AWAIT_PAYMENT_* (если передумал)
  if (action === 'PAY_GUIDE' || action === 'PAY_CLUB' || action === 'PAY_BUNDLE') {
    const canPay = state === 'OFFER_SENT' || (state && state.startsWith('AWAIT_PAYMENT_'));
    if (!canPay) return { messages: [] };
    const productMap = { PAY_GUIDE: 'guide', PAY_CLUB: 'club', PAY_BUNDLE: 'bundle' };
    const product = productMap[action];
    store.upsertUser(chatId, AWAIT_STATES[product]);
    store.saveProductType(chatId, product);
    return {
      messages: [],
      createPayment: product,
    };
  }

  // Дожим оффера (scheduler)
  if (action === 'OFFER_REMINDER') {
    if (state !== 'OFFER_SENT') return { messages: [] };
    const idx = typeof payload === 'number' ? payload : 0;
    const text = m.OFFER_REMINDERS[idx] || m.OFFER_REMINDERS[m.OFFER_REMINDERS.length - 1];
    return {
      messages: [{
        text,
        buttons3: [
          { label: m.BTN_BUY_GUIDE,  callback: 'buy_guide' },
          { label: m.BTN_BUY_BUNDLE, callback: 'buy_bundle' },
          { label: m.BTN_BUY_CLUB,   callback: 'buy_club' },
        ],
      }],
    };
  }

  // Ремайндеры ожидания оплаты (scheduler)
  if (action === 'REMINDER_PAYMENT') {
    if (!state || !state.startsWith('AWAIT_PAYMENT_')) return { messages: [] };
    const fresh = store.getUser(chatId);
    const text = fresh.reminder_count === 0 ? m.REMINDER_PAYMENT_1 : m.REMINDER_PAYMENT_2;
    return { messages: [{ text }] };
  }

  // Отказ от автопродления клуба (кнопка в ремайндере или команда /unsubscribe).
  // setAutoRenew(false) сбрасывает и auto_renew=0, и club_cancel=1 — старый ремайндер
  // тоже не побеспокоит. Доступ сохраняется до club_expires_at, кикер уберёт по истечении.
  if (action === 'BTN_CLUB_CANCEL' || action === 'UNSUBSCRIBE') {
    const fresh = store.getUser(chatId);
    // /unsubscribe без активной подписки — мягкий ответ
    if (!fresh || !fresh.club_expires_at || (fresh.state !== 'COMPLETED_CLUB' && fresh.state !== 'COMPLETED_BUNDLE')) {
      return { messages: [{ text: m.MSG_UNSUBSCRIBE_NOOP }] };
    }
    store.setAutoRenew(chatId, false);
    return {
      messages: [{ text: m.MSG_CLUB_CANCEL_CONFIRM(fresh.club_expires_at) }],
    };
  }

  // Продление клуба
  if (action === 'BTN_RENEW_CLUB') {
    store.upsertUser(chatId, 'AWAIT_PAYMENT_CLUB');
    store.saveProductType(chatId, 'club');
    return {
      messages: [{ text: m.MSG_CLUB }],
      createPayment: 'club',
    };
  }

  // Текстовые сообщения от пользователя
  if (action === 'TEXT') {
    // Уведомить менеджера о сообщениях вне сценария
    if (state && state.startsWith('COMPLETED_')) {
      return { messages: [{ text: m.FALLBACK_COMPLETED }], notifyManager: true, originalText: payload };
    }
    if (state && state.startsWith('AWAIT_PAYMENT_')) {
      return { messages: [{ text: m.FALLBACK_AWAIT_PAYMENT }], notifyManager: true, originalText: payload };
    }
    if (state === 'OFFER_SENT') {
      return {
        messages: [{
          text: m.FALLBACK_PRESS_BUTTON,
          buttons3: [
            { label: m.BTN_BUY_GUIDE,  callback: 'buy_guide' },
            { label: m.BTN_BUY_BUNDLE, callback: 'buy_bundle' },
            { label: m.BTN_BUY_CLUB,   callback: 'buy_club' },
          ],
        }],
      };
    }
    if (state === 'WELCOME_SENT') {
      return { messages: [{ text: m.FALLBACK_PRESS_BUTTON, button: { label: m.BTN_WATCH_VIDEO, callback: 'watch_video' } }] };
    }
    return { messages: [{ text: m.FALLBACK_IDLE }], notifyManager: true, originalText: payload };
  }

  return { messages: [] };
}

// Вызывается после успешного платежа ЮКассой.
// paymentMethodId — id сохранённой карты, передаётся scheduler'ом если save_payment_method=true.
async function handlePaymentSuccess({ chatId, product, createInvite, paymentMethodId }) {
  const completedState = COMPLETED_STATES[product] || 'COMPLETED_GUIDE';
  store.upsertUser(chatId, completedState);
  store.setCompletedAt(chatId);

  if (product === 'guide') {
    return {
      messages: [{ text: m.MSG_COMPLETED_GUIDE, banner: config.BANNERS.msg11 }],
      files: ['guide', 'tracker', 'print_tracker'],
      trailingMessages: [{ text: m.MSG_COMPLETED_GUIDE_TRAILING }],
    };
  }

  // Для club/bundle — сохраняем дату истечения, метод оплаты и включаем автопродление
  const expires = new Date(Date.now() + config.CLUB_ACCESS_DAYS * 24 * 60 * 60 * 1000).toISOString();
  store.saveClubExpiry(chatId, expires);
  store.setAutoRenew(chatId, true);
  if (paymentMethodId) store.savePaymentMethodId(chatId, paymentMethodId);

  if (product === 'club') {
    const inviteUrl = await createInvite(chatId);
    return {
      messages: [{ text: m.MSG_COMPLETED_CLUB(inviteUrl, expires) }],
    };
  }

  if (product === 'bundle') {
    const inviteUrl = await createInvite(chatId);
    return {
      messages: [{ text: m.MSG_COMPLETED_GUIDE, banner: config.BANNERS.msg11 }],
      files: ['guide', 'tracker', 'print_tracker'],
      trailingMessages: [{ text: m.MSG_COMPLETED_BUNDLE(inviteUrl, expires) }],
    };
  }

  return { messages: [] };
}

module.exports = { handleAction, handlePaymentSuccess, AWAIT_STATES, COMPLETED_STATES };
