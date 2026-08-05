const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, '../data/users.db'));

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

// Миграция: добавить колонки если их нет (старые тоже сохраняем — база нужна для рассылок)
for (const col of [
  'username TEXT', 'first_name TEXT',
  'started_at TEXT', 'completed_at TEXT',
  'source TEXT',
  'payment_id TEXT',
  'product_type TEXT',           // 'guide' | 'club' | 'bundle'
  'club_expires_at TEXT',        // ISO datetime, когда истекает доступ в клуб
  'club_reminder_count INTEGER', // сколько напоминаний о продлении уже отправлено
  'club_cancel INTEGER',         // 1 = пользователь отказался от продления
  // Автосписание (recurrent) — YooKassa saved payment method
  'payment_method_id TEXT',      // ID сохранённой карты в YooKassa (для off-session charges)
  'auto_renew INTEGER DEFAULT 1',// 1 = автопродление включено (по умолчанию)
  'autorenew_failed_at TEXT',    // ISO datetime последней неуспешной попытки списания
  // Политика конфиденциальности: команда /stop — отказ от рассылки
  'opt_out INTEGER DEFAULT 0',   // 1 = пользователь отписался от рассылок/напоминаний (/stop)
  // Акция «бесплатный месяц» 06.08.2026: 1 = зашёл бесплатно и ещё ни разу не платил.
  // Сбрасывается в 0 при первой успешной оплате — дальше обычные ремайндеры.
  'trial INTEGER DEFAULT 0',
  // legacy колонки (не используются в v2.1, но оставляем для совместимости)
  'q1 TEXT', 'q2 TEXT', 'q3 TEXT', 'q4 TEXT', 'archetype TEXT', 'ab_variant TEXT',
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

// Политика конфиденциальности: /delete — полное удаление данных пользователя
function deleteUser(chatId) {
  db.prepare('DELETE FROM users WHERE chat_id = ?').run(String(chatId));
}

// Политика конфиденциальности: /stop — отписка от рассылок. /start снова включает (opt_out=0).
function setOptOut(chatId, enabled) {
  db.prepare('UPDATE users SET opt_out = ? WHERE chat_id = ?').run(enabled ? 1 : 0, String(chatId));
}

function saveUserInfo(chatId, { username, firstName }) {
  db.prepare(`UPDATE users SET username = ?, first_name = ? WHERE chat_id = ?`)
    .run(username || null, firstName || null, String(chatId));
}

function setStartedAt(chatId, source) {
  db.prepare(`UPDATE users SET started_at = datetime('now') WHERE chat_id = ? AND started_at IS NULL`)
    .run(String(chatId));
  if (source) {
    db.prepare(`UPDATE users SET source = ? WHERE chat_id = ?`).run(source, String(chatId));
  }
}

function setCompletedAt(chatId) {
  db.prepare(`UPDATE users SET completed_at = datetime('now') WHERE chat_id = ?`).run(String(chatId));
}

function savePaymentId(chatId, paymentId) {
  db.prepare(`UPDATE users SET payment_id = ? WHERE chat_id = ?`).run(paymentId, String(chatId));
}

function saveProductType(chatId, productType) {
  db.prepare(`UPDATE users SET product_type = ? WHERE chat_id = ?`).run(productType, String(chatId));
}

function saveClubExpiry(chatId, isoDate) {
  db.prepare(`UPDATE users SET club_expires_at = ? WHERE chat_id = ?`).run(isoDate, String(chatId));
}

function setClubCancel(chatId) {
  db.prepare(`UPDATE users SET club_cancel = 1 WHERE chat_id = ?`).run(String(chatId));
}

// Автосписание: сохранить payment_method_id и пометить autorenew=1
function savePaymentMethodId(chatId, methodId) {
  db.prepare(`UPDATE users SET payment_method_id = ? WHERE chat_id = ?`).run(methodId, String(chatId));
}

// Включить/выключить автопродление. При выключении — также взводим club_cancel
// чтобы старая логика ремайндеров о продлении тоже его не трогала.
function setAutoRenew(chatId, enabled) {
  if (enabled) {
    db.prepare(`UPDATE users SET auto_renew = 1, club_cancel = 0 WHERE chat_id = ?`).run(String(chatId));
  } else {
    db.prepare(`UPDATE users SET auto_renew = 0, club_cancel = 1 WHERE chat_id = ?`).run(String(chatId));
  }
}

function markAutorenewFailed(chatId) {
  db.prepare(`UPDATE users SET autorenew_failed_at = datetime('now') WHERE chat_id = ?`).run(String(chatId));
}

// Акция «бесплатный месяц»: флаг триальщика (сбрасывается при первой оплате)
function setTrial(chatId, enabled) {
  db.prepare(`UPDATE users SET trial = ? WHERE chat_id = ?`).run(enabled ? 1 : 0, String(chatId));
}

// Перешли по trial-диплинку, но не нажали кнопку. reminder_count на этом стейте свободен
// (дожимы оплаты живут только на AWAIT_PAYMENT_*), используем его как флаг «последний созыв отправлен».
function getTrialLastCallPending() {
  return db.prepare(`
    SELECT * FROM users
    WHERE state = 'TRIAL_OFFER_SENT'
      AND COALESCE(opt_out, 0) = 0
      AND COALESCE(reminder_count, 0) = 0
  `).all();
}

// Все зависшие на trial-оффере (для перевода в обычную оплату после закрытия окна)
function getTrialOfferUsers() {
  return db.prepare(`
    SELECT * FROM users
    WHERE state = 'TRIAL_OFFER_SENT'
      AND COALESCE(opt_out, 0) = 0
  `).all();
}

// Продлить club_expires_at на N дней (от текущего значения, либо от сейчас если null)
function extendClubExpiry(chatId, days) {
  const row = db.prepare(`SELECT club_expires_at FROM users WHERE chat_id = ?`).get(String(chatId));
  const base = row && row.club_expires_at ? new Date(row.club_expires_at) : new Date();
  // Если истёкший — продлеваем от сейчас, чтобы не давать «дыру»
  const from = base < new Date() ? new Date() : base;
  const next = new Date(from.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`UPDATE users SET club_expires_at = ?, club_reminder_count = 0, autorenew_failed_at = NULL WHERE chat_id = ?`)
    .run(next, String(chatId));
  return next;
}

// Кандидаты на автосписание: auto_renew=1, есть payment_method_id, истекает в ближайшие N часов,
// ещё активный участник клуба, и не было неудачной попытки за последние 6 часов (чтобы не долбить YK).
function getUsersForAutoRenew(hoursAhead) {
  return db.prepare(`
    SELECT * FROM users
    WHERE COALESCE(auto_renew, 1) = 1
      AND payment_method_id IS NOT NULL
      AND club_expires_at IS NOT NULL
      AND club_expires_at < datetime('now', '+${Math.floor(hoursAhead)} hours')
      AND club_expires_at > datetime('now', '-3 days')
      AND state IN ('COMPLETED_CLUB', 'COMPLETED_BUNDLE')
      AND (autorenew_failed_at IS NULL OR autorenew_failed_at < datetime('now', '-6 hours'))
  `).all();
}

function incrementClubReminder(chatId) {
  db.prepare(`UPDATE users SET club_reminder_count = COALESCE(club_reminder_count, 0) + 1 WHERE chat_id = ?`).run(String(chatId));
}

// Напоминания о продлении. Окна заданы в ЧАСАХ до истечения и не пересекаются:
// 48–72ч («через 3 дня», count=0), 12–36ч («завтра», count=1), 0–12ч («сегодня», count=2).
// Все три — ДО club_expires_at: раньше последнее окно было (-24ч…0ч), то есть уходило
// уже после истечения, в том же часовом тике, что и кик из канала.
function getPendingClubReminders(hoursFrom, hoursTo, reminderIndex) {
  const moscowHour = new Date(Date.now() + 3 * 60 * 60 * 1000).getUTCHours();
  if (moscowHour >= 21 || moscowHour < 9) return [];
  return db.prepare(`
    SELECT * FROM users
    WHERE club_expires_at IS NOT NULL
      AND club_expires_at BETWEEN datetime('now', '+${Math.floor(hoursFrom)} hours') AND datetime('now', '+${Math.floor(hoursTo)} hours')
      AND COALESCE(club_reminder_count, 0) = ?
      AND COALESCE(club_cancel, 0) = 0
      AND COALESCE(opt_out, 0) = 0
      AND state IN ('COMPLETED_CLUB', 'COMPLETED_BUNDLE')
  `).all(reminderIndex);
}

// Пользователи у которых истёк клуб (для автоматического кика)
function getExpiredClubMembers() {
  return db.prepare(`
    SELECT * FROM users
    WHERE club_expires_at IS NOT NULL
      AND club_expires_at < datetime('now')
      AND state IN ('COMPLETED_CLUB', 'COMPLETED_BUNDLE')
  `).all();
}

// Все ожидающие оплаты (для ЮКасса поллинга).
// COMPLETED_CLUB/BUNDLE тоже: действующий участник, продлевающий по кнопке «Продлить»,
// остаётся в своём стейте (не роняем его в AWAIT — иначе кикер и дожимы ломаются),
// его платёж ловим здесь по payment_id.
function getPendingPayments() {
  return db.prepare(`
    SELECT chat_id, payment_id FROM users
    WHERE state IN ('AWAIT_PAYMENT_GUIDE', 'AWAIT_PAYMENT_CLUB', 'AWAIT_PAYMENT_BUNDLE',
                    'COMPLETED_CLUB', 'COMPLETED_BUNDLE')
      AND payment_id IS NOT NULL
  `).all();
}

// Дожимы ожидания оплаты (reminder_count = индекс в REMINDER_HOURS: день 1/3/6).
// Оффер (Шаг 5) переводит юзера в AWAIT_PAYMENT_CLUB — дожимы живут ТОЛЬКО на этом стейте.
// Кто застрял раньше (INTRO_SENT/ABOUT_SENT) — не дожимаем (цену не видел).
function getPendingPaymentReminders(reminderIndex, hours) {
  const moscowHour = new Date(Date.now() + 3 * 60 * 60 * 1000).getUTCHours();
  if (moscowHour >= 21 || moscowHour < 9) return [];
  return db.prepare(`
    SELECT * FROM users
    WHERE state IN ('AWAIT_PAYMENT_GUIDE', 'AWAIT_PAYMENT_CLUB', 'AWAIT_PAYMENT_BUNDLE')
      AND COALESCE(opt_out, 0) = 0
      AND COALESCE(source, '') != 'reactivate'
      AND reminder_count = ${reminderIndex}
      AND updated_at < datetime('now', '-${Math.floor(hours)} hours')
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
  const all = db.prepare('SELECT state, source, product_type FROM users').all();
  const completedStates = new Set(['COMPLETED_GUIDE', 'COMPLETED_CLUB', 'COMPLETED_BUNDLE']);
  const paymentStates = new Set(['AWAIT_PAYMENT_GUIDE', 'AWAIT_PAYMENT_CLUB', 'AWAIT_PAYMENT_BUNDLE',
    'COMPLETED_GUIDE', 'COMPLETED_CLUB', 'COMPLETED_BUNDLE']);

  let started = all.length;
  let reachedPayment = 0, paid = 0;
  const bySources = {};
  const byProduct = { guide: 0, club: 0, bundle: 0 };

  for (const { state, source, product_type } of all) {
    if (paymentStates.has(state)) reachedPayment++;
    if (completedStates.has(state)) paid++;
    if (source) bySources[source] = (bySources[source] || 0) + 1;
    if (product_type && completedStates.has(state)) {
      byProduct[product_type] = (byProduct[product_type] || 0) + 1;
    }
  }

  return { started, reachedPayment, paid, bySources, byProduct };
}

module.exports = {
  getUser,
  upsertUser,
  deleteUser,
  setOptOut,
  saveUserInfo,
  setStartedAt,
  setCompletedAt,
  savePaymentId,
  saveProductType,
  saveClubExpiry,
  setClubCancel,
  savePaymentMethodId,
  setAutoRenew,
  markAutorenewFailed,
  setTrial,
  getTrialLastCallPending,
  getTrialOfferUsers,
  extendClubExpiry,
  getUsersForAutoRenew,
  incrementClubReminder,
  getPendingClubReminders,
  getExpiredClubMembers,
  getPendingPayments,
  getPendingPaymentReminders,
  incrementReminderCount,
  isInTestMode,
  setTestMode,
  getAllUsers,
  getStats,
};
