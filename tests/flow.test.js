// Прогон пути покупателя без Telegram и ЮKassa: node tests/flow.test.js
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
// Своя временная база — рабочую data/users.db тест не трогает
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voin-'));
process.env.VOIN_DB = path.join(tmp, 'test.db');

const store = require('../core/store');
const flow = require('../core/flow');
const m = require('../core/messages');

const id = '111';
let r = flow.handleAction({ chatId: id, action: 'START', payload: 'reels' });
assert.match(r.messages[0].text, /офертой/);
assert.equal(r.messages[0].button.callback, 'consent');

r = flow.handleAction({ chatId: id, action: 'BTN_CONSENT' });
assert.equal(store.getUser(id).state, 'AWAIT_PAYMENT_GUIDE');
assert.ok(r.messages[0].banner, 'картинка над оффером');
assert.match(r.messages[0].text, /690 ₽/);
assert.equal(r.createPayment.label, 'Купить Код Воина 2.0 за 690 ₽');
assert.ok(store.getUser(id).offered_at);

// повторное «Начать» не плодит оффер
assert.equal(flow.handleAction({ chatId: id, action: 'BTN_CONSENT' }).messages.length, 0);

// текст до оплаты — подсказка + менеджеру
r = flow.handleAction({ chatId: id, action: 'TEXT', payload: 'оплатил, где файл?' });
assert.ok(r.notifyManager);

// повторная покупка из напоминания — свежая ссылка
r = flow.handleAction({ chatId: id, action: 'BUY' });
assert.ok(r.createPayment);

// отказ банка → кнопка «ещё раз»
r = flow.handlePaymentFailed();
assert.equal(r.messages[0].button.callback, 'buy_guide');
assert.match(r.messages[0].button.label, /690/);

// оплата → PDF
r = flow.handlePaymentSuccess({ chatId: id });
assert.deepEqual(r.files, ['guide']);
assert.match(r.messages[0].text, /Спасибо за поддержку/);
assert.equal(store.getUser(id).state, 'COMPLETED_GUIDE');

// купившему не продаём, а предлагаем файл ещё раз
r = flow.handleAction({ chatId: id, action: 'START' });
assert.equal(r.messages[0].button.callback, 'resend_guide');
assert.ok(!r.createPayment);
assert.deepEqual(flow.handleAction({ chatId: id, action: 'RESEND_GUIDE' }).files, ['guide']);
assert.ok(!flow.handleAction({ chatId: id, action: 'BUY' }).createPayment);

// цена везде 690 (разово), клуба и подписки нет, старой цены 490 нет
const all = JSON.stringify(m);
assert.ok(!/490|клуб|вступ|в месяц|автопродл|unsubscribe/i.test(all), "нет клуба, подписки и старой цены");
assert.equal(require('../config').YOOKASSA_AMOUNT_GUIDE, 690);

// журнал платежей и поллинг
store.logPayment('p1', id, 690);
assert.equal(store.getPendingPayments().length, 1);
store.setPaymentStatus('p1', 'succeeded');
assert.equal(store.getPendingPayments().length, 0);
assert.equal(store.getStats().revenue, 690);

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows: база ещё открыта */ }
console.log('OK: путь покупателя пройден');
