const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, '../data/users.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    platform       TEXT NOT NULL,
    chat_id        TEXT NOT NULL,
    state          TEXT NOT NULL,
    updated_at     TEXT DEFAULT (datetime('now')),
    reminder_count INTEGER DEFAULT 0,
    UNIQUE(platform, chat_id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_settings (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    platform       TEXT NOT NULL,
    chat_id        TEXT NOT NULL,
    test_mode      INTEGER DEFAULT 0,
    updated_at     TEXT DEFAULT (datetime('now')),
    UNIQUE(platform, chat_id)
  )
`);

// Ре-активационная рассылка покупателям «Кода Воина» (только Telegram).
// step = сколько сообщений уже отправлено (0..5). paid=1 — оплатил клуб в v2, дожимы стоп.
db.exec(`
  CREATE TABLE IF NOT EXISTS reactivation (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id    TEXT NOT NULL UNIQUE,
    step       INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    paid       INTEGER DEFAULT 0
  )
`);

function getUser(platform, chatId) {
  const stmt = db.prepare('SELECT * FROM users WHERE platform = ? AND chat_id = ?');
  return stmt.get(platform, String(chatId)) || null;
}

function upsertUser(platform, chatId, state) {
  db.prepare(`
    INSERT INTO users (platform, chat_id, state, updated_at, reminder_count)
    VALUES (?, ?, ?, datetime('now'), 0)
    ON CONFLICT(platform, chat_id) DO UPDATE SET
      state          = excluded.state,
      updated_at     = datetime('now'),
      reminder_count = 0
  `).run(platform, String(chatId), state);
}

function getPendingAutoProgress(platform) {
  return db.prepare(`
    SELECT * FROM users
    WHERE state IN ('MSG1_SENT', 'MSG2_SENT')
      AND updated_at < datetime('now', '-30 minutes')
      AND platform = ?
  `).all(platform);
}

function getPendingReminders(platform) {
  // Не отправляем ночью: 22:00–09:00 по Москве (UTC+3)
  const moscowHour = new Date(Date.now() + 3 * 60 * 60 * 1000).getUTCHours();
  if (moscowHour >= 22 || moscowHour < 9) return [];

  return db.prepare(`
    SELECT * FROM users
    WHERE state = 'AWAIT_PAYMENT'
      AND platform = ?
      AND (
        (reminder_count = 0 AND updated_at < datetime('now', '-1 hours'))
        OR
        (reminder_count = 1 AND updated_at < datetime('now', '-4 hours'))
      )
  `).all(platform);
}

function incrementReminderCount(platform, chatId) {
  db.prepare(`
    UPDATE users
    SET reminder_count = reminder_count + 1
    WHERE platform = ? AND chat_id = ?
  `).run(platform, String(chatId));
}

function isInTestMode(platform, chatId) {
  const stmt = db.prepare('SELECT test_mode FROM admin_settings WHERE platform = ? AND chat_id = ?');
  const row = stmt.get(platform, String(chatId));
  return row ? row.test_mode === 1 : false;
}

function setTestMode(platform, chatId, enabled) {
  db.prepare(`
    INSERT INTO admin_settings (platform, chat_id, test_mode, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(platform, chat_id) DO UPDATE SET
      test_mode  = excluded.test_mode,
      updated_at = datetime('now')
  `).run(platform, String(chatId), enabled ? 1 : 0);
}

function getAllAdminSettings() {
  return db.prepare('SELECT * FROM admin_settings').all();
}

// ── Ре-активационная рассылка ─────────────────────────────────────────────

// Шаги для рассылки, у которых прошло достаточно времени с прошлого сообщения.
// Ночью (21:00–09:00 МСК) не шлём. hours=0 → готово сразу (для первого сообщения).
function getDueReactivation(step, hours) {
  const moscowHour = new Date(Date.now() + 3 * 60 * 60 * 1000).getUTCHours();
  if (moscowHour >= 21 || moscowHour < 9) return [];
  return db.prepare(`
    SELECT * FROM reactivation
    WHERE paid = 0 AND step = ?
      AND updated_at < datetime('now', '-${Math.floor(hours)} hours')
  `).all(step);
}

function advanceReactivation(chatId) {
  db.prepare(`UPDATE reactivation SET step = step + 1, updated_at = datetime('now') WHERE chat_id = ?`)
    .run(String(chatId));
}

function markReactivationPaid(chatId) {
  db.prepare(`UPDATE reactivation SET paid = 1 WHERE chat_id = ?`).run(String(chatId));
}

// Read-only проверка: оплатил ли этот TG-id клуб в боте v2 (у TG id общий для обоих ботов).
// Если БД v2 недоступна — возвращаем false (рассылку не блокируем).
const V2_DB_PATH = process.env.V2_DB_PATH || path.join(__dirname, '../../voin-bot-v2/data/users.db');
let v2db = null;
function isClubMemberInV2(chatId) {
  try {
    if (!v2db) v2db = new DatabaseSync(V2_DB_PATH, { readOnly: true });
    const row = v2db.prepare("SELECT 1 FROM users WHERE chat_id = ? AND state = 'COMPLETED_CLUB'")
      .get(String(chatId));
    return !!row;
  } catch (err) {
    return false;
  }
}

module.exports = {
  getUser,
  upsertUser,
  getPendingAutoProgress,
  getPendingReminders,
  incrementReminderCount,
  isInTestMode,
  setTestMode,
  getDueReactivation,
  advanceReactivation,
  markReactivationPaid,
  isClubMemberInV2,
};
