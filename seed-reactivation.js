// Разовый сид ре-активационной рассылки: берём всех покупателей «Кода Воина»
// (state='COMPLETED', platform='telegram') и кладём в таблицу reactivation, ИСКЛЮЧАЯ
// тех, кто уже вступил в клуб в боте v2 (COMPLETED_CLUB).
// Первое сообщение уйдёт на ближайшем часовом тике планировщика (updated_at помечен прошлым).
// Запуск: node seed-reactivation.js   (v1 должен быть на Node 22 — node:sqlite)
require('dotenv').config();
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'data/users.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS reactivation (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id    TEXT NOT NULL UNIQUE,
    step       INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    paid       INTEGER DEFAULT 0
  )
`);

// Уже вступившие в клуб в v2 — исключаем
const v2ids = new Set();
try {
  const v2 = new DatabaseSync(path.join(__dirname, '../voin-bot-v2/data/users.db'), { readOnly: true });
  for (const r of v2.prepare("SELECT chat_id FROM users WHERE state='COMPLETED_CLUB'").all()) {
    v2ids.add(String(r.chat_id));
  }
  console.log(`В клубе v2 уже: ${v2ids.size} — их пропустим.`);
} catch (e) {
  console.warn(`Не смог прочитать БД v2 (${e.message}) — сидируем без исключения клубных.`);
}

const buyers = db.prepare(
  "SELECT chat_id FROM users WHERE state = 'COMPLETED' AND platform = 'telegram'"
).all();

const ins = db.prepare(
  "INSERT OR IGNORE INTO reactivation (chat_id, step, updated_at, paid) VALUES (?, 0, datetime('now','-1 hours'), 0)"
);

let added = 0, skippedClub = 0, existed = 0;
for (const { chat_id } of buyers) {
  if (v2ids.has(String(chat_id))) { skippedClub++; continue; }
  const r = ins.run(String(chat_id));
  if (r.changes) added++; else existed++;
}

const total = db.prepare("SELECT count(*) c FROM reactivation WHERE paid=0").get().c;
console.log(`Покупателей COMPLETED (TG): ${buyers.length}`);
console.log(`Пропущено (уже в клубе): ${skippedClub}, уже были в рассылке: ${existed}, добавлено: ${added}`);
console.log(`Всего активных в рассылке сейчас: ${total}`);
process.exit(0);
