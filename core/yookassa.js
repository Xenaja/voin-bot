const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

const BASE_URL = 'https://api.yookassa.ru/v3';

const auth = () => ({ username: config.YOOKASSA_SHOP_ID, password: config.YOOKASSA_SECRET_KEY });

// Разовый платёж за гайд. Ответ — объект платежа, ссылка в confirmation.confirmation_url.
async function createPayment(chatId, amount) {
  const response = await axios.post(`${BASE_URL}/payments`, {
    amount: { value: amount.toFixed(2), currency: 'RUB' },
    confirmation: { type: 'redirect', return_url: config.YOOKASSA_RETURN_URL },
    capture: true,
    description: `Гайд «Код Воина» — пользователь ${chatId}`,
    metadata: { chat_id: String(chatId), product: 'guide' },
  }, {
    auth: auth(),
    headers: { 'Idempotence-Key': uuidv4() },
    timeout: 15000,
  });
  return response.data;
}

async function getPayment(paymentId) {
  const response = await axios.get(`${BASE_URL}/payments/${paymentId}`, { auth: auth(), timeout: 15000 });
  return response.data;
}

module.exports = { createPayment, getPayment };
