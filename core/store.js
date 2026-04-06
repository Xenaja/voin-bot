const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../data/users.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    platform       TEXT NOT NULL,
    chat_id        TEXT NOT NULL,
    state          TEXT NOT NULL,
    updated_at     DATETIME DEFAULT (datetime('now')),
    reminder_count INTEGER DEFAULT 0,
    UNIQUE(platform, chat_id)
  )
`);

function getUser(platform, chatId) {
  return db
    .prepare('SELECT * FROM users WHERE platform = ? AND chat_id = ?')
    .get(platform, String(chatId)) || null;
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
  return db.prepare(`
    SELECT * FROM users
    WHERE state = 'AWAIT_PAYMENT'
      AND platform = ?
      AND (
        (reminder_count = 0 AND updated_at < datetime('now', '-24 hours'))
        OR
        (reminder_count = 1 AND updated_at < datetime('now', '-48 hours'))
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

module.exports = {
  getUser,
  upsertUser,
  getPendingAutoProgress,
  getPendingReminders,
  incrementReminderCount,
};
