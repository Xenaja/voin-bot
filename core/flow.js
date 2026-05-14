const store = require('./store');
const m = require('./messages');
const config = require('../config');

// A = Меч, B = Щит, C = Лук
function calcArchetype(q1, q2, q3, q4) {
  const map = { A: 'SWORD', B: 'SHIELD', C: 'BOW' };
  const counts = { SWORD: 0, SHIELD: 0, BOW: 0 };
  for (const a of [q1, q2, q3, q4]) counts[map[a]]++;
  const max = Math.max(...Object.values(counts));
  const tied = Object.keys(counts).filter(k => counts[k] === max);
  if (tied.length === 1) return tied[0];
  for (const a of [q1, q2, q3, q4]) {
    const t = map[a];
    if (tied.includes(t)) return t;
  }
}

function resultMessage(archetype) {
  if (archetype === 'SWORD') return m.RESULT_SWORD;
  if (archetype === 'SHIELD') return m.RESULT_SHIELD;
  return m.RESULT_BOW;
}

function resultBanner(archetype) {
  const b = config.BANNERS_RESULT;
  if (archetype === 'SWORD') return b.sword;
  if (archetype === 'SHIELD') return b.shield;
  return b.bow;
}

function questionMessage(state) {
  if (state === 'Q1_SENT') return { text: m.Q1_TEXT, buttons: [[m.Q1_BTN_A, 'q1_a'],[m.Q1_BTN_B, 'q1_b'],[m.Q1_BTN_C, 'q1_c']] };
  if (state === 'Q2_SENT') return { text: m.Q2_TEXT, buttons: [[m.Q2_BTN_A, 'q2_a'],[m.Q2_BTN_B, 'q2_b'],[m.Q2_BTN_C, 'q2_c']] };
  if (state === 'Q3_SENT') return { text: m.Q3_TEXT, buttons: [[m.Q3_BTN_A, 'q3_a'],[m.Q3_BTN_B, 'q3_b'],[m.Q3_BTN_C, 'q3_c']] };
  if (state === 'Q4_SENT') return { text: m.Q4_TEXT, buttons: [[m.Q4_BTN_A, 'q4_a'],[m.Q4_BTN_B, 'q4_b'],[m.Q4_BTN_C, 'q4_c']] };
  return null;
}

// action — строка из enum: START, AUTO_WELCOME, BTN_TEST_START, BTN_QUIZ, BTN_GET_VIDEO,
//   AUTO_RESULT, BTN_WANT_ANCHORS, AUTO_VIDEO, BTN_THANK_YOU, AUTO_WALLS,
//   BTN_TELL_ME, AUTO_WARMUP1, BTN_WHATS_INSIDE, AUTO_WARMUP2, BTN_BUY,
//   OFFER_FOLLOWUP, TEXT, QUIZ_REMINDER, REMINDER_PAYMENT
// payload — для BTN_QUIZ: answerKey ('q1_a' …); для TEXT: текст пользователя
function handleAction({ chatId, action, payload }) {
  const user = store.getUser(chatId);
  const state = user ? user.state : null;

  if (state === 'COMPLETED') {
    return { messages: [{ text: m.FALLBACK_COMPLETED }], notifyManager: true, originalText: payload };
  }

  if (action === 'START') {
    store.upsertUser(chatId, 'WELCOME_SENT');
    store.setStartedAt(chatId, payload); // payload = источник (tiktok/instagram/null)
    return {
      messages: [{
        text: m.MSG0,
        banner: config.BANNERS.msg0,
        button: { label: m.BTN_TEST_START, callback: 'test_start' },
      }],
    };
  }

  if (action === 'BTN_TEST_START') {
    if (state !== 'WELCOME_SENT') return { messages: [] };
    store.upsertUser(chatId, 'Q1_SENT');
    return {
      messages: [
        { text: m.Q1_TEXT, quizButtons: [[m.Q1_BTN_A, 'q1_a'],[m.Q1_BTN_B, 'q1_b'],[m.Q1_BTN_C, 'q1_c']] },
      ],
    };
  }

  if (action === 'BTN_QUIZ') {
    const match = (payload || '').match(/^q(\d)_([abc])$/);
    if (!match) return { messages: [] };
    const qNum = parseInt(match[1]);
    const letter = match[2].toUpperCase();
    if (state !== `Q${qNum}_SENT`) return { messages: [] };

    store.saveAnswer(chatId, qNum, letter);

    if (qNum < 4) {
      const nextState = `Q${qNum + 1}_SENT`;
      store.upsertUser(chatId, nextState);
      const q = questionMessage(nextState);
      return { messages: [{ text: q.text, quizButtons: q.buttons }] };
    }

    // Вопрос 4 — считаем результат
    const fresh = store.getUser(chatId);
    const archetype = calcArchetype(fresh.q1, fresh.q2, fresh.q3, letter);
    store.saveArchetype(chatId, archetype);
    store.upsertUser(chatId, 'RESULT_SENT');
    return {
      messages: [{
        text: resultMessage(archetype),
        banner: resultBanner(archetype),
        button: { label: m.BTN_GET_VIDEO, callback: 'get_video' },
      }],
    };
  }

  if (action === 'BTN_GET_VIDEO' || action === 'AUTO_RESULT') {
    if (state !== 'RESULT_SENT') return { messages: [] };
    store.upsertUser(chatId, 'VIDEO_SENT');
    const hasVideo = !!config.VIDEO_FILE;
    return {
      messages: [{
        text: hasVideo ? m.MSG6 : m.MSG6_NO_VIDEO,
        video: hasVideo ? config.VIDEO_FILE : null,
        button: { label: m.BTN_WANT_ANCHORS, callback: 'want_anchors' },
      }],
    };
  }

  if (action === 'BTN_WANT_ANCHORS' || action === 'AUTO_VIDEO') {
    if (state !== 'VIDEO_SENT') return { messages: [] };
    store.upsertUser(chatId, 'WALLS_SENT');
    return {
      messages: [],
      files: ['wallpapers'],
      trailingMessages: [{ text: m.MSG7, button: { label: m.BTN_THANK_YOU, callback: 'thank_you' } }],
    };
  }

  if (action === 'BTN_THANK_YOU' || action === 'AUTO_WALLS') {
    if (state !== 'WALLS_SENT') return { messages: [] };
    store.saveAbVariant(chatId, 'B');
    store.upsertUser(chatId, 'WARMUP_B_SENT');
    return {
      messages: [{ text: m.MSG_B, button: { label: m.BTN_GET_B, callback: 'get_b' } }],
    };
  }

  if (action === 'BTN_GET_B' || action === 'AUTO_WARMUP_B') {
    if (state !== 'WARMUP_B_SENT') return { messages: [] };
    store.upsertUser(chatId, 'AWAIT_PAYMENT');
    return {
      messages: [{ text: m.MSG10B() }],
    };
  }

  if (action === 'BTN_TELL_ME' || action === 'AUTO_WARMUP1') {
    if (state !== 'WARMUP1_SENT') return { messages: [] };
    store.upsertUser(chatId, 'WARMUP2_SENT');
    return {
      messages: [{ text: m.MSG9, banner: config.BANNERS.msg9, button: { label: m.BTN_WHATS_INSIDE, callback: 'whats_inside' } }],
    };
  }

  if (action === 'BTN_WHATS_INSIDE' || action === 'AUTO_WARMUP2') {
    if (state !== 'WARMUP2_SENT') return { messages: [] };
    store.upsertUser(chatId, 'OFFER_SEEN');
    return {
      messages: [{ text: m.MSG10A, button: { label: m.BTN_YES, callback: 'yes' } }],
    };
  }

  if (action === 'BTN_YES' || action === 'AUTO_OFFER_SEEN') {
    if (state !== 'OFFER_SEEN') return { messages: [] };
    store.upsertUser(chatId, 'AWAIT_PAYMENT');
    return {
      messages: [{ text: m.MSG10B() }],
    };
  }

  if (action === 'OFFER_FOLLOWUP') {
    if (state !== 'AWAIT_PAYMENT') return { messages: [] };
    return {
      messages: [{ text: m.MSG12 }],
    };
  }

  if (action === 'TEXT') {
    if (state === 'AWAIT_PAYMENT') {
      const norm = (payload || '').trim().toUpperCase().replace(/[^А-ЯЁA-Z]/g, '');
      if (norm.includes('ГОТОВО') || norm.includes('ГОТОВ')) {
        store.upsertUser(chatId, 'COMPLETED');
        store.setCompletedAt(chatId);
        return {
          messages: [{ text: m.MSG11, banner: config.BANNERS.msg11 }],
          files: ['guide', 'tracker', 'print_tracker'],
          trailingMessages: [{ text: m.MSG11_TRAILING }],
        };
      }
      return { messages: [{ text: m.FALLBACK_AWAIT_PAYMENT }], notifyManager: true, originalText: payload };
    }

    if (['Q1_SENT','Q2_SENT','Q3_SENT','Q4_SENT'].includes(state)) {
      const q = questionMessage(state);
      return { messages: [{ text: m.FALLBACK_PRESS_BUTTON, quizButtons: q.buttons }] };
    }

    const warmupButtonMap = {
      RESULT_SENT:   { label: m.BTN_GET_VIDEO,     callback: 'get_video' },
      VIDEO_SENT:    { label: m.BTN_WANT_ANCHORS,   callback: 'want_anchors' },
      WALLS_SENT:    { label: m.BTN_THANK_YOU,      callback: 'thank_you' },
      WARMUP1_SENT:  { label: m.BTN_TELL_ME,        callback: 'tell_me' },
      WARMUP2_SENT:  { label: m.BTN_WHATS_INSIDE,   callback: 'whats_inside' },
      WARMUP_B_SENT: { label: m.BTN_GET_B,          callback: 'get_b' },
      OFFER_SEEN:    { label: m.BTN_YES,            callback: 'yes' },
    };
    if (warmupButtonMap[state]) {
      return { messages: [{ text: m.FALLBACK_PRESS_BUTTON, button: warmupButtonMap[state] }] };
    }

    return { messages: [{ text: m.FALLBACK_IDLE }], notifyManager: true, originalText: payload };
  }

  if (action === 'QUIZ_REMINDER') {
    if (!['Q1_SENT','Q2_SENT','Q3_SENT','Q4_SENT'].includes(state)) return { messages: [] };
    const q = questionMessage(state);
    return { messages: [{ text: m.QUIZ_REMINDER, quizButtons: q.buttons }] };
  }

  if (action === 'REMINDER_PAYMENT') {
    if (state !== 'AWAIT_PAYMENT') return { messages: [] };
    const fresh = store.getUser(chatId);
    const text = fresh.reminder_count === 0 ? m.REMINDER_PAYMENT_1 : m.REMINDER_PAYMENT_2;
    return { messages: [{ text }] };
  }

  return { messages: [] };
}

module.exports = { handleAction, calcArchetype };
