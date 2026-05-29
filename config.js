require('dotenv').config();

module.exports = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,

  // ЮКасса
  YOOKASSA_SHOP_ID: process.env.YOOKASSA_SHOP_ID || '',
  YOOKASSA_SECRET_KEY: process.env.YOOKASSA_SECRET_KEY || '',
  // Суммы по тарифам
  YOOKASSA_AMOUNT_GUIDE:  990,
  YOOKASSA_AMOUNT_CLUB:   490,
  YOOKASSA_AMOUNT_BUNDLE: 1390,

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

  VIDEO_FILE: './video.mp4',
  VIDEO_FALLBACK_URL: 'https://drive.google.com/file/d/1U1Hyc8B9242HjujoohvJN1XRKofJL5S3/view?usp=sharing',

  BANNERS: {
    msg0:  './visual/1.jpg',
    msg11: './visual/2.jpg',
  },

  // Авто-прогрессия (секунды → минуты)
  WELCOME_AUTO_SECONDS: 30,  // WELCOME → VIDEO
  VIDEO_AUTO_SECONDS:   30,  // VIDEO → OFFER

  // Дожимы после OFFER_SENT
  OFFER_REMINDERS_HOURS: [6, 24, 72, 120], // 6ч, 1д, 3д, 5д
};
