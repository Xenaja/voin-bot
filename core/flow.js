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

    // Deep-link из старого бота: покупатель «Кода Воина» → сразу оффер клуба С кнопкой оплаты
    // в одном сообщении (createPayment вешает urlButton на MSG_REACTIVATE). Не общая воронка.
    // source='reactivate' сохранён setStartedAt → исключит из клубных дожимов v2 (их шлёт v1).
    if (payload === 'reactivate') {
      store.upsertUser(chatId, 'AWAIT_PAYMENT_CLUB');
      store.saveProductType(chatId, 'club');
      return {
        messages: [{
          text: m.MSG_REACTIVATE,
          parseMode: 'HTML',
        }],
        createPayment: 'club',
      };
    }

    return {
      messages: [{
        text: m.MSG_CONSENT,
        parseMode: 'HTML',
        button: { label: m.BTN_CONSENT, callback: 'consent' },
      }],
    };
  }

  // Согласие → авто-цепочка знакомства: [Начать] →(3с)→ Шаг 2 →(5с)→ Шаг 3.
  // Приветствие (бывший Шаг 1) показано уже на экране согласия. Два сообщения уходят
  // пачкой; delayBefore заставляет адаптер выждать паузу перед каждым (точные задержки,
  // не через планировщик). Шаг 3 — с кнопкой «Расскажи про клуб». Состояние INTRO_SENT.
  if (action === 'BTN_CONSENT') {
    if (state !== 'CONSENT_SENT') return { messages: [] };
    store.upsertUser(chatId, 'INTRO_SENT');
    return {
      messages: [
        { text: m.MSG_STEP2, delayBefore: config.INTRO_DELAYS[0] },
        { text: m.MSG_STEP3, delayBefore: config.INTRO_DELAYS[1], button: { label: m.BTN_ABOUT, callback: 'about' } },
      ],
    };
  }

  // Шаг 3 → Шаг 4: кнопка «Расскажи про клуб» показывает, что внутри клуба.
  if (action === 'BTN_ABOUT') {
    if (state !== 'INTRO_SENT') return { messages: [] };
    store.upsertUser(chatId, 'ABOUT_SENT');
    return {
      messages: [{
        text: m.MSG_STEP4,
        button: { label: m.BTN_WANT, callback: 'want' },
      }],
    };
  }

  // Шаг 4 → Шаг 5: оффер СРАЗУ со ссылкой на оплату — одно сообщение.
  // Платёж YooKassa создаётся здесь же (createPayment), кнопка «Оплатить» встаёт прямо
  // под текстом оффера. Пользователь сразу в AWAIT_PAYMENT_CLUB — дожимы про оплату
  // работают ТОЛЬКО на этом стейте. upsertUser сбрасывает reminder_count в 0 (дожимы с нуля).
  if (action === 'BTN_WANT') {
    if (state !== 'ABOUT_SENT') return { messages: [] };
    store.upsertUser(chatId, 'AWAIT_PAYMENT_CLUB');
    store.saveProductType(chatId, 'club');
    return {
      messages: [{
        text: m.MSG_OFFER,
        parseMode: 'HTML',
      }],
      createPayment: 'club',
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

  // Дожимы ожидания оплаты (scheduler): день 1/3/6, только на AWAIT_PAYMENT_CLUB.
  // Каждый с кнопкой оплаты — по клику PAY_CLUB создаёт СВЕЖУЮ ссылку.
  if (action === 'REMINDER_PAYMENT') {
    if (!state || !state.startsWith('AWAIT_PAYMENT_')) return { messages: [] };
    const idx = typeof payload === 'number' ? payload : 0;
    const text = m.OFFER_REMINDERS[idx] || m.OFFER_REMINDERS[m.OFFER_REMINDERS.length - 1];
    return {
      messages: [{
        text,
        button: { label: m.BTN_ENTER_CLUB, callback: 'pay_club' },
      }],
    };
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
    if (state === 'INTRO_SENT') {
      return { messages: [{ text: m.FALLBACK_PRESS_BUTTON, button: { label: m.BTN_ABOUT, callback: 'about' } }] };
    }
    if (state === 'ABOUT_SENT') {
      return { messages: [{ text: m.FALLBACK_PRESS_BUTTON, button: { label: m.BTN_WANT, callback: 'want' } }] };
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
