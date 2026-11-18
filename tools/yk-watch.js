// Сторож магазина ЮKassa: старый ключ мог утечь при взломе Beget.
// Раз в 5 минут (yk-watch.timer) смотрит новые платежи и возвраты и пишет в Telegram:
//   • любой возврат (бот возвратов не делает);
//   • любой платёж, которого нет в журнале бота (data/users.db → payments): чужой или автосписание.
// Первый запуск с --history=2026-01-01 — сводка по истории магазина с этой даты.
// Срок: YK_WATCH_UNTIL (ISO) в .env; после него один раз сообщает «мониторинг окончен» и молчит.
// Кому: YK_WATCH_TO (через запятую), по умолчанию ADMIN_TELEGRAM_IDS.
const path = require('path');
const fs = require('fs');
process.chdir(path.join(__dirname, '..'));
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

const API = 'https://api.yookassa.ru/v3';
const STATE = path.join(__dirname, '../data/yk-watch.json');
const DB = process.env.VOIN_DB || path.join(__dirname, '../data/users.db');
const TO = (process.env.YK_WATCH_TO || config.ADMIN_TELEGRAM_IDS.join(',')).split(',').map(s => s.trim()).filter(Boolean);
const UNTIL = process.env.YK_WATCH_UNTIL ? new Date(process.env.YK_WATCH_UNTIL) : null;
const auth = { username: config.YOOKASSA_SHOP_ID, password: config.YOOKASSA_SECRET_KEY };

const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return null; } };
const saveState = s => fs.writeFileSync(STATE, JSON.stringify(s, null, 1));

async function tg(text) {
  const agent = config.TELEGRAM_PROXY ? new HttpsProxyAgent(config.TELEGRAM_PROXY) : undefined;
  for (const chat_id of TO) {
    try {
      await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_TOKEN}/sendMessage`,
        { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true },
        { httpsAgent: agent, proxy: false, timeout: 20000 });
    } catch (e) { console.error(`[yk-watch] TG ${chat_id}:`, e.response ? JSON.stringify(e.response.data) : e.message); }
  }
  console.log('[yk-watch] →', text.replace(/<[^>]+>/g, ''));
}

async function list(kind, sinceIso) {
  const items = [];
  let cursor;
  do {
    const params = { 'created_at.gte': sinceIso, limit: 100, ...(cursor ? { cursor } : {}) };
    const { data } = await axios.get(`${API}/${kind}`, { auth, params, timeout: 20000 });
    items.push(...data.items);
    cursor = data.next_cursor;
  } while (cursor);
  return items;
}

function knownPaymentIds() {
  try {
    const db = new DatabaseSync(DB, { readOnly: true });
    const ids = new Set(db.prepare('SELECT payment_id FROM payments').all().map(r => r.payment_id));
    db.close();
    return ids;
  } catch (e) { console.error('[yk-watch] база:', e.message); return new Set(); }
}

const rub = a => `${a.value} ${a.currency === 'RUB' ? '₽' : a.currency}`;
const msk = iso => new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
const esc = s => String(s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const payLine = p => `${msk(p.created_at)} · ${rub(p.amount)} · ${p.status}` +
  `${p.payment_method && p.payment_method.saved ? ' · сохранённая карта' : ''} · «${esc(p.description)}» · <code>${p.id}</code>`;
const refLine = r => `${msk(r.created_at)} · ${rub(r.amount)} · ${r.status} · платёж <code>${r.payment_id}</code>`;

async function history(fromIso) {
  const [pays, refs] = await Promise.all([list('payments', fromIso), list('refunds', fromIso)]);
  const ok = pays.filter(p => p.status === 'succeeded');
  const saved = pays.filter(p => p.payment_method && p.payment_method.saved);
  let t = `🔎 <b>ЮKassa, история с ${msk(fromIso)}</b>\nПлатежей: ${pays.length}, успешных: ${ok.length}` +
    ` (${ok.reduce((s, p) => s + Number(p.amount.value), 0)} ₽)\nВозвратов: ${refs.length}\nПлатежей с сохранённой картой: ${saved.length}`;
  if (refs.length) t += `\n\n<b>Возвраты:</b>\n` + refs.slice(0, 20).map(refLine).join('\n');
  if (pays.length) t += `\n\n<b>Последние платежи:</b>\n` + pays.slice(0, 15).map(payLine).join('\n');
  await tg(t);
}

async function main() {
  if (!auth.username || !auth.password) { console.error('[yk-watch] нет YOOKASSA_SHOP_ID/SECRET_KEY'); return; }
  const h = process.argv.find(a => a.startsWith('--history='));
  if (h) return history(new Date(h.split('=')[1]).toISOString());

  let st = loadState();
  if (!st) {
    st = { since: new Date().toISOString(), seen: [], apiDown: false, over: false };
    saveState(st);
    await tg(`👁 Мониторинг ЮKassa включён${UNTIL ? ` до ${msk(UNTIL.toISOString())}` : ''}: проверка раз в 5 минут, сообщу о любом возврате и о платеже не от бота.`);
  }
  if (UNTIL && Date.now() > UNTIL.getTime()) {
    if (!st.over) { st.over = true; saveState(st); await tg('✅ Мониторинг ЮKassa окончен, подозрительных операций за это время — см. выше (если сообщений не было, всё чисто).'); }
    return;
  }

  let pays, refs;
  try {
    [pays, refs] = await Promise.all([list('payments', st.since), list('refunds', st.since)]);
    if (st.apiDown) { st.apiDown = false; await tg('ЮKassa снова отвечает, мониторинг продолжается.'); }
  } catch (e) {
    const code = e.response ? e.response.status : 'сеть';
    console.error('[yk-watch] API:', code, e.response ? JSON.stringify(e.response.data) : e.message);
    if (!st.apiDown) {
      st.apiDown = true; saveState(st);
      await tg(code === 401
        ? '⚠️ ЮKassa отклоняет ключ (401). Ключ перевыпущен или неверен — оплата в боте тоже не работает.'
        : `⚠️ Мониторинг ЮKassa не может достучаться до API (${code}). Повторю через 5 минут.`);
    }
    return;
  }

  const seen = new Set(st.seen);
  const ours = knownPaymentIds();
  for (const r of refs) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    await tg(`🚨 <b>Возврат в магазине ЮKassa</b>\n${refLine(r)}\nБот возвратов не делает. Если это не вы — срочно перевыпустить ключ.`);
  }
  for (const p of pays) {
    if (seen.has(p.id)) continue;
    if (ours.has(p.id)) { seen.add(p.id); continue; }
    // свежий платёж бот мог ещё не записать — даём минуту
    if (Date.now() - new Date(p.created_at).getTime() < 60000) continue;
    seen.add(p.id);
    await tg(`🚨 <b>Платёж не от бота</b>\n${payLine(p)}\nЕго создал кто-то другой с нашим ключом${p.payment_method && p.payment_method.saved ? ' (похоже на списание с сохранённой карты)' : ''}.`);
  }
  st.seen = [...seen].slice(-2000);
  saveState(st);
}

main().catch(e => { console.error('[yk-watch] сбой:', e); process.exitCode = 1; });
