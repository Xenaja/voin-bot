const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

const BASE_URL = 'https://api.yookassa.ru/v3';

function auth() {
  return {
    username: config.YOOKASSA_SHOP_ID,
    password: config.YOOKASSA_SECRET_KEY,
  };
}

// Первый платёж пользователя. Для club/bundle передаём savePaymentMethod=true,
// чтобы YooKassa сохранила метод оплаты для последующих off-session списаний.
// Флаг save_payment_method работает только если в кабинете YooKassa подключены «Автоплатежи».
async function createPayment(chatId, amount = 990, options = {}) {
  const { savePaymentMethod = false, description } = options;
  const idempotenceKey = uuidv4();
  const body = {
    amount: { value: amount.toFixed(2), currency: 'RUB' },
    confirmation: { type: 'redirect', return_url: 'https://t.me/VoinKodBot' },
    capture: true,
    description: description || `Код Воина — пользователь ${chatId}`,
    metadata: { chat_id: String(chatId) },
  };
  if (savePaymentMethod) body.save_payment_method = true;

  const response = await axios.post(`${BASE_URL}/payments`, body, {
    auth: auth(),
    headers: { 'Idempotence-Key': idempotenceKey },
  });
  return response.data;
}

// Off-session списание по сохранённому методу (recurrent). Требует подключённых
// «Автоплатежей» в кабинете YooKassa. Возвращает payment object — обычно сразу
// status='succeeded' либо 'canceled'.
async function chargeSaved(paymentMethodId, amount, chatId, description) {
  const idempotenceKey = uuidv4();
  const response = await axios.post(
    `${BASE_URL}/payments`,
    {
      amount: { value: amount.toFixed(2), currency: 'RUB' },
      capture: true,
      payment_method_id: paymentMethodId,
      description: description || `Продление клуба «Первый шаг» — ${chatId}`,
      metadata: { chat_id: String(chatId), renewal: 'true' },
    },
    {
      auth: auth(),
      headers: { 'Idempotence-Key': idempotenceKey },
    }
  );
  return response.data;
}

async function getPayment(paymentId) {
  const response = await axios.get(`${BASE_URL}/payments/${paymentId}`, { auth: auth() });
  return response.data;
}

module.exports = { createPayment, chargeSaved, getPayment };
