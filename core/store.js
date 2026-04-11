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

module.exports = {
  getUser,
  upsertUser,
  getPendingAutoProgress,
  getPendingReminders,
  incrementReminderCount,
  isInTestMode,
  setTestMode,
};
