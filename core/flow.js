const store = require('./store');
const m = require('./messages');
const config = require('../config');
const yookassa = require('./yookassa');

// Единственный продукт — клуб «Первый шаг», подписка с автопродлением.
// AWAIT_STATES/COMPLETED_STATES оставлены как маппинг, чтобы legacy-пользователи
// в COMPLETED_GUIDE/COMPLETED_BUNDLE (из старых заказов) корректно обрабатывались
// поисковыми запросами в store.js — туда они зашиты текстом.
const AMOUNTS = { club: config.YOOKASSA_AMOUNT_CLUB };
const AWAIT_STATES = { club: 'AWAIT_PAYMENT_CLUB' };
const COMPLETED_STATES = { club: 'COMPLETED_CLUB' };

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
    store.setOptOut(chatId, false); // вернулся по /start — снова подписан на рассылки

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

  // Авто VIDEO→OFFER. Единственный продукт — клуб, поэтому кнопка ведёт сразу к оплате.
  if (action === 'AUTO_VIDEO') {
    if (state !== 'VIDEO_SENT') return { messages: [] };
    store.upsertUser(chatId, 'OFFER_SENT');
    return {
      messages: [{
        text: m.MSG3,
        button: { label: m.BTN_ENTER_CLUB, callback: 'pay_club' },
      }],
    };
  }

  // Подтверждение оплаты клуба — доступно из OFFER_SENT и AWAIT_PAYMENT_CLUB (если передумал)
  if (action === 'PAY_CLUB') {
    const canPay = state === 'OFFER_SENT' || state === 'AWAIT_PAYMENT_CLUB';
    if (!canPay) return { messages: [] };
    store.upsertUser(chatId, AWAIT_STATES.club);
    store.saveProductType(chatId, 'club');
    return {
      messages: [],
      createPayment: 'club',
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
        button: { label: m.BTN_ENTER_CLUB, callback: 'pay_club' },
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

  // Ручное продление клуба (BTN_RENEW_CLUB или BTN_RESUME_CLUB)
  if (action === 'BTN_RENEW_CLUB') {
    store.upsertUser(chatId, 'AWAIT_PAYMENT_CLUB');
    store.saveProductType(chatId, 'club');
    return {
      messages: [],
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
          button: { label: m.BTN_ENTER_CLUB, callback: 'pay_club' },
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
  store.upsertUser(chatId, 'COMPLETED_CLUB');
  store.setCompletedAt(chatId);

  const expires = new Date(Date.now() + config.CLUB_ACCESS_DAYS * 24 * 60 * 60 * 1000).toISOString();
  store.saveClubExpiry(chatId, expires);
  store.setAutoRenew(chatId, true);
  if (paymentMethodId) store.savePaymentMethodId(chatId, paymentMethodId);

  const inviteUrl = await createInvite(chatId);
  return {
    messages: [{ text: m.MSG_COMPLETED_CLUB(inviteUrl, expires) }],
  };
}

module.exports = { handleAction, handlePaymentSuccess, AWAIT_STATES, COMPLETED_STATES };
