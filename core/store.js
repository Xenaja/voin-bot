const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// VOIN_DB — путь к базе (тесты ставят временный файл, чтобы не трогать рабочую)
const dbPath = process.env.VOIN_DB || path.join(__dirname, '../data/users.db');
if (!fs.existsSync(path.dirname(dbPath))) fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    platform       TEXT NOT NULL DEFAULT 'telegram',
    chat_id        TEXT NOT NULL,
    state          TEXT NOT NULL,
    updated_at     TEXT DEFAULT (datetime('now')),
    reminder_count INTEGER DEFAULT 0,
    UNIQUE(platform, chat_id)
  )
`);

for (const col of [
  'username TEXT', 'first_name TEXT',
  'started_at TEXT', 'completed_at TEXT',
  'source TEXT',
  'payment_id TEXT',
  'product_type TEXT',            // 'guide'
  'opt_out INTEGER DEFAULT 0',    // 1 = отписался от напоминаний (/stop)
  'offered_at TEXT',              // когда впервые увидел оффер гайда (отсчёт напоминаний)
  'motiv_count INTEGER DEFAULT 0',// сколько мотивационных напоминаний отправлено
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

// Журнал платежей: каждый созданный платёж и его итог (для разборов «оплатил, а файла нет»)
db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    payment_id  TEXT PRIMARY KEY,
    chat_id     TEXT NOT NULL,
    amount      INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    reason      TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  )
`);

const isNight = () => {
  const h = new Date(Date.now() + 3 * 60 * 60 * 1000).getUTCHours();
  return h >= 21 || h < 9;
};

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

function deleteUser(chatId) {
  db.prepare('DELETE FROM users WHERE chat_id = ?').run(String(chatId));
}

function setOptOut(chatId, enabled) {
  db.prepare('UPDATE users SET opt_out = ? WHERE chat_id = ?').run(enabled ? 1 : 0, String(chatId));
}

function saveUserInfo(chatId, { username, firstName }) {
  db.prepare('UPDATE users SET username = ?, first_name = ? WHERE chat_id = ?')
    .run(username || null, firstName || null, String(chatId));
}

function setStartedAt(chatId, source) {
  db.prepare(`UPDATE users SET started_at = datetime('now') WHERE chat_id = ? AND started_at IS NULL`)
    .run(String(chatId));
  if (source) db.prepare('UPDATE users SET source = ? WHERE chat_id = ?').run(source, String(chatId));
}

function setCompletedAt(chatId) {
  db.prepare(`UPDATE users SET completed_at = datetime('now') WHERE chat_id = ?`).run(String(chatId));
}

function savePaymentId(chatId, paymentId) {
  db.prepare('UPDATE users SET payment_id = ? WHERE chat_id = ?').run(paymentId, String(chatId));
}

function saveProductType(chatId, productType) {
  db.prepare('UPDATE users SET product_type = ? WHERE chat_id = ?').run(productType, String(chatId));
}

// Первый показ оффера — точка отсчёта мотивационных напоминаний (повторный /start её не сдвигает)
function markOffered(chatId) {
  db.prepare(`UPDATE users SET offered_at = datetime('now'), motiv_count = 0 WHERE chat_id = ? AND offered_at IS NULL`)
    .run(String(chatId));
}

// Кому пора отправить напоминание №idx: оффер был ≥ hours назад, отправлено ровно idx штук.
// И купившим (без кнопки), и нет. Ночью — никому.
function getMotivationDue(idx, hours) {
  if (isNight()) return [];
  return db.prepare(`
    SELECT * FROM users
    WHERE offered_at IS NOT NULL
      AND COALESCE(opt_out, 0) = 0
      AND COALESCE(motiv_count, 0) = ?
      AND offered_at < datetime('now', '-${Math.floor(hours)} hours')
  `).all(idx);
}

function incrementMotivation(chatId) {
  db.prepare('UPDATE users SET motiv_count = COALESCE(motiv_count, 0) + 1 WHERE chat_id = ?').run(String(chatId));
}

// Платежи, которые ждут результата (поллер ЮKassa). Берём из журнала, а не из users.payment_id:
// если человек дважды нажал «Купить» и оплатил по первой ссылке, этот платёж тоже поймаем.
// Старше 3 суток не опрашиваем — ЮKassa к этому времени их уже отменила.
function getPendingPayments() {
  return db.prepare(`
    SELECT chat_id, payment_id FROM payments
    WHERE status = 'pending' AND created_at > datetime('now', '-3 days')
  `).all();
}

function logPayment(paymentId, chatId, amount) {
  db.prepare(`INSERT OR IGNORE INTO payments (payment_id, chat_id, amount) VALUES (?, ?, ?)`)
    .run(paymentId, String(chatId), amount);
}

function setPaymentStatus(paymentId, status, reason = null) {
  db.prepare(`UPDATE payments SET status = ?, reason = ?, updated_at = datetime('now') WHERE payment_id = ?`)
    .run(status, reason, paymentId);
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

// Полный сброс пользователя для тестового прохождения
function resetUser(chatId) {
  upsertUser(chatId, 'CONSENT_SENT');
  db.prepare(`UPDATE users SET payment_id = NULL, product_type = NULL, completed_at = NULL,
              offered_at = NULL, motiv_count = 0 WHERE chat_id = ?`).run(String(chatId));
}

function getAllUsers() {
  return db.prepare('SELECT * FROM users ORDER BY updated_at DESC').all();
}

function getStats() {
  const all = db.prepare('SELECT state, source FROM users').all();
  let started = all.length, offered = 0, paid = 0;
  const bySources = {};
  for (const { state, source } of all) {
    if (state === 'AWAIT_PAYMENT_GUIDE' || state === 'COMPLETED_GUIDE') offered++;
    if (state === 'COMPLETED_GUIDE') paid++;
    if (source) bySources[source] = (bySources[source] || 0) + 1;
  }
  const money = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount), 0) s FROM payments WHERE status = 'succeeded'`).get();
  return { started, offered, paid, bySources, paymentsCount: money.n, revenue: money.s };
}

module.exports = {
  getUser, upsertUser, deleteUser, setOptOut, saveUserInfo,
  setStartedAt, setCompletedAt, savePaymentId, saveProductType,
  markOffered, getMotivationDue, incrementMotivation,
  getPendingPayments, logPayment, setPaymentStatus,
  isInTestMode, setTestMode, resetUser,
  getAllUsers, getStats,
};
