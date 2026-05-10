const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, '../data/users.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    platform       TEXT NOT NULL DEFAULT 'telegram',
    chat_id        TEXT NOT NULL,
    state          TEXT NOT NULL,
    q1             TEXT,
    q2             TEXT,
    q3             TEXT,
    q4             TEXT,
    archetype      TEXT,
    updated_at     TEXT DEFAULT (datetime('now')),
    reminder_count INTEGER DEFAULT 0,
    UNIQUE(platform, chat_id)
  )
`);

// Миграция: добавить колонки если их нет
for (const col of [
  'q1 TEXT', 'q2 TEXT', 'q3 TEXT', 'q4 TEXT', 'archetype TEXT',
  'username TEXT', 'first_name TEXT',
  'started_at TEXT', 'completed_at TEXT',
  'source TEXT',
  'ab_variant TEXT',
]) {
  try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch { /* уже есть */ }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_settings (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    platform       TEXT NOT NULL DEFAULT 'telegram',
    chat_id        TEXT NOT NULL,
    test_mode      INTEGER DEFAULT 0,
    updated_at     TEXT DEFAULT (datetime('now')),
    UNIQUE(platform, chat_id)
  )
`);

function getUser(chatId) {
  return db.prepare('SELECT * FROM users WHERE chat_id = ?').get(String(chatId)) || null;
}

function upsertUser(chatId, state) {
  db.prepare(`
    INSERT INTO users (platform, chat_id, state, updated_at, reminder_count)
    VALUES ('telegram', ?, ?, datetime('now'), 0)
    ON CONFLICT(platform, chat_id) DO UPDATE SET
      state          = excluded.state,
      updated_at     = datetime('now'),
      reminder_count = 0
  `).run(String(chatId), state);
}

function saveUserInfo(chatId, { username, firstName }) {
  db.prepare(`UPDATE users SET username = ?, first_name = ? WHERE chat_id = ?`)
    .run(username || null, firstName || null, String(chatId));
}

function setStartedAt(chatId, source) {
  db.prepare(`UPDATE users SET started_at = datetime('now') WHERE chat_id = ? AND started_at IS NULL`)
    .run(String(chatId));
  if (source) {
    db.prepare(`UPDATE users SET source = ? WHERE chat_id = ?`)
      .run(source, String(chatId));
  }
}

function setCompletedAt(chatId) {
  db.prepare(`UPDATE users SET completed_at = datetime('now') WHERE chat_id = ?`)
    .run(String(chatId));
}

function saveAbVariant(chatId, variant) {
  db.prepare(`UPDATE users SET ab_variant = ? WHERE chat_id = ?`).run(variant, String(chatId));
}

function saveAnswer(chatId, qNum, answer) {
  const col = `q${qNum}`;
  db.prepare(`UPDATE users SET ${col} = ? WHERE chat_id = ?`).run(answer ?? null, String(chatId));
}

function saveArchetype(chatId, archetype) {
  db.prepare(`UPDATE users SET archetype = ? WHERE chat_id = ?`).run(archetype, String(chatId));
}

// Авто-прогрессия: приветствие → Q1 через N секунд
function getPendingWelcome(seconds) {
  return db.prepare(`
    SELECT * FROM users
    WHERE state = 'WELCOME_SENT'
      AND updated_at < datetime('now', '-${Math.floor(seconds)} seconds')
  `).all();
}

// Авто-прогрессия: этапы прогрева через N минут
function getPendingWarmup(minutes) {
  const warmupStates = ['RESULT_SENT','VIDEO_SENT','WALLS_SENT','WARMUP1_SENT','WARMUP2_SENT','WARMUP_B_SENT'];
  const placeholders = warmupStates.map(() => '?').join(',');
  return db.prepare(`
    SELECT * FROM users
    WHERE state IN (${placeholders})
      AND updated_at < datetime('now', '-${Math.floor(minutes)} minutes')
  `).all(...warmupStates);
}

// Ремайндеры для завязших на вопросах теста (один раз через N часов)
function getPendingQuizReminders(hours) {
  const quizStates = ['Q1_SENT','Q2_SENT','Q3_SENT','Q4_SENT'];
  const placeholders = quizStates.map(() => '?').join(',');
  return db.prepare(`
    SELECT * FROM users
    WHERE state IN (${placeholders})
      AND reminder_count = 0
      AND updated_at < datetime('now', '-${Math.floor(hours)} hours')
  `).all(...quizStates);
}

// Авто-прогрессия OFFER_SEEN → AWAIT_PAYMENT через N минут
function getPendingOfferSeen(minutes) {
  return db.prepare(`
    SELECT * FROM users
    WHERE state = 'OFFER_SEEN'
      AND updated_at < datetime('now', '-${Math.floor(minutes)} minutes')
  `).all();
}

// Дожим после оффера (один раз через N часов)
function getPendingOfferFollowup(hours) {
  return db.prepare(`
    SELECT * FROM users
    WHERE state = 'AWAIT_PAYMENT'
      AND reminder_count >= 2
      AND reminder_count < 3
      AND updated_at < datetime('now', '-${Math.floor(hours)} hours')
  `).all();
}

// Ремайндеры ожидания оплаты (через 1ч и 4ч, не ночью по МСК)
function getPendingPaymentReminders() {
  const moscowHour = new Date(Date.now() + 3 * 60 * 60 * 1000).getUTCHours();
  if (moscowHour >= 22 || moscowHour < 9) return [];
  return db.prepare(`
    SELECT * FROM users
    WHERE state = 'AWAIT_PAYMENT'
      AND (
        (reminder_count = 0 AND updated_at < datetime('now', '-1 hours'))
        OR
        (reminder_count = 1 AND updated_at < datetime('now', '-4 hours'))
      )
  `).all();
}

function incrementReminderCount(chatId) {
  db.prepare(`UPDATE users SET reminder_count = reminder_count + 1 WHERE chat_id = ?`).run(String(chatId));
}

function isInTestMode(chatId) {
  const row = db.prepare('SELECT test_mode FROM admin_settings WHERE chat_id = ?').get(String(chatId));
  return row ? row.test_mode === 1 : false;
}

function setTestMode(chatId, enabled) {
  db.prepare(`
    INSERT INTO admin_settings (platform, chat_id, test_mode, updated_at)
    VALUES ('telegram', ?, ?, datetime('now'))
    ON CONFLICT(platform, chat_id) DO UPDATE SET
      test_mode  = excluded.test_mode,
      updated_at = datetime('now')
  `).run(String(chatId), enabled ? 1 : 0);
}

function getAllUsers() {
  return db.prepare('SELECT * FROM users ORDER BY updated_at DESC').all();
}

function getStats() {
  const all = db.prepare('SELECT state, source, ab_variant FROM users').all();
  const testDoneStates = new Set(['RESULT_SENT','VIDEO_SENT','WALLS_SENT','WARMUP1_SENT','WARMUP2_SENT','WARMUP_B_SENT','OFFER_SEEN','AWAIT_PAYMENT','COMPLETED']);
  let started = all.length;
  let testDone = 0, reachedPayment = 0, paid = 0;
  const bySources = {};
  const abStats = { A: { total: 0, paid: 0 }, B: { total: 0, paid: 0 } };
  for (const { state, source, ab_variant } of all) {
    if (testDoneStates.has(state)) testDone++;
    if (state === 'AWAIT_PAYMENT' || state === 'COMPLETED') reachedPayment++;
    if (state === 'COMPLETED') paid++;
    if (source) bySources[source] = (bySources[source] || 0) + 1;
    if (ab_variant) {
      abStats[ab_variant].total++;
      if (state === 'COMPLETED') abStats[ab_variant].paid++;
    }
  }
  return { started, testDone, reachedPayment, paid, bySources, abStats };
}

module.exports = {
  getUser,
  upsertUser,
  saveUserInfo,
  setStartedAt,
  setCompletedAt,
  saveAbVariant,
  saveAnswer,
  saveArchetype,
  getPendingWelcome,
  getPendingWarmup,
  getPendingOfferSeen,
  getPendingQuizReminders,
  getPendingOfferFollowup,
  getPendingPaymentReminders,
  incrementReminderCount,
  isInTestMode,
  setTestMode,
  getAllUsers,
  getStats,
};
