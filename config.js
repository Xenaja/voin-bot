require('dotenv').config();

module.exports = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,
  // Прокси до api.telegram.org (сервер в РФ): http://127.0.0.1:8124 — туннель к fi-proxy.
  // Пусто — напрямую. ЮKassa всегда ходит напрямую.
  TELEGRAM_PROXY: process.env.TELEGRAM_PROXY || '',

  // ЮKassa. Единственный продукт — гайд «Код Воина», разовый платёж.
  YOOKASSA_SHOP_ID: process.env.YOOKASSA_SHOP_ID || '',
  YOOKASSA_SECRET_KEY: process.env.YOOKASSA_SECRET_KEY || '',
  YOOKASSA_AMOUNT_GUIDE: 490,
  // Тест без ЮKassa: кнопка «Купить» у админов сразу выдаёт PDF. Работает, только пока
  // YOOKASSA_SHOP_ID пуст; с ключами отключается сама. Обычным людям — никогда.
  PAYMENT_STUB: process.env.PAYMENT_STUB === 'true',
  // Куда вернуть человека со страницы оплаты
  YOOKASSA_RETURN_URL: process.env.YOOKASSA_RETURN_URL || 'https://t.me/VoinKodBot',

  // Менеджер (получает сообщения вне сценария) и админы
  MANAGER_TG_ID: process.env.MANAGER_TG_ID ? Number(process.env.MANAGER_TG_ID) : 718850812,
  ADMIN_TELEGRAM_IDS: process.env.ADMIN_TELEGRAM_IDS
    ? process.env.ADMIN_TELEGRAM_IDS.split(',').map(Number)
    : [718850812],

  // Файл гайда, который бот выдаёт после оплаты. Новый PDF — положить по этому пути
  // (или задать GUIDE_PDF в .env) и очистить кэш: удалить ключ guide из data/tg_file_ids.json.
  FILES: {
    guide: process.env.GUIDE_PDF || './Gaid+tracker/Gaid-kodvoina-2026.pdf', // новый от Алины, 14.11.2026
  },
  // Имя файла, которое увидит покупатель в Telegram
  GUIDE_FILENAME: 'Код Воина.pdf',

  // Картинка над оффером. Новая — положить по этому пути (или GUIDE_BANNER в .env)
  // и удалить её ключ banner_* из data/tg_file_ids.json.
  GUIDE_BANNER: process.env.GUIDE_BANNER || './visual/kod-voina-cover.png', // обложка от Алины, 14.11.2026

  // Мотивационные напоминания: часы после оффера (день 1/3/6), только 9:00–21:00 МСК
  MOTIVATION_HOURS: [24, 72, 144],
};
