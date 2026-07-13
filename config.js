require('dotenv').config();

module.exports = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,

  // ЮКасса
  YOOKASSA_SHOP_ID: process.env.YOOKASSA_SHOP_ID || '',
  YOOKASSA_SECRET_KEY: process.env.YOOKASSA_SECRET_KEY || '',
  // Единственный продукт — клуб «Первый шаг», подписка с автопродлением
  YOOKASSA_AMOUNT_CLUB: 690,

  // Автосписание клуба. Включается во .env=true ПОСЛЕ того, как YooKassa подключит
  // опцию «Автоплатежи» в кабинете (по запросу со скринами UX). До этого UX-тексты
  // и /unsubscribe работают, но save_payment_method не отправляется и cron не списывает.
  AUTORENEW_ENABLED: process.env.AUTORENEW_ENABLED === 'true',

  // Резервная ссылка оплаты (fallback если ЮКасса недоступна)
  PAYMENT_LINK: process.env.PAYMENT_LINK || 'https://messenger.online.sberbank.ru/sl/iG5BSZHjgdNGIWbGo',

  // Закрытый клуб «Первый шаг»
  CLUB_CHANNEL_ID: process.env.CLUB_CHANNEL_ID ? Number(process.env.CLUB_CHANNEL_ID) : null,
  CLUB_ACCESS_DAYS: 30,

  // Менеджер и админы
  MANAGER_TG_ID: process.env.MANAGER_TG_ID ? Number(process.env.MANAGER_TG_ID) : 718850812,
  ADMIN_TELEGRAM_IDS: process.env.ADMIN_TELEGRAM_IDS
    ? process.env.ADMIN_TELEGRAM_IDS.split(',').map(Number)
    : [718850812],

  FILES: {
    guide:         './Gaid+tracker/Gaid-kodvoina.pdf',
    tracker:       './Gaid+tracker/Tracker-30dnei.pdf',
    print_tracker: './Gaid+tracker/Трекер для печати.pdf',
  },

  BANNERS: {
    msg0:  './visual/1.jpg',  // баннер на Экране 2 (ценность клуба)
    msg11: './visual/2.jpg',
  },

  // Задержки авто-цепочки знакомства (мс): Шаг 2 через 3с, Шаг 3 через 5с после Шага 1
  INTRO_DELAYS: [3000, 5000],

  // Дожимы ожидания оплаты (только AWAIT_PAYMENT_CLUB): день 1/3/6
  REMINDER_HOURS: [24, 72, 144],
};
