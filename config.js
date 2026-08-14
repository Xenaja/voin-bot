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

  // 14.08.2026: клуб стал бесплатным, канал открыли — подписочная механика выключена.
  // При false планировщик не шлёт напоминания о продлении, не кикает из канала
  // и не списывает деньги. Данные (club_expires_at, payment_method_id) остаются
  // в базе нетронутыми: если подписку вернут, достаточно поставить =true.
  // Дефолт false намеренно — забытая переменная окружения не должна включить списания.
  CLUB_SUBSCRIPTION_ENABLED: process.env.CLUB_SUBSCRIPTION_ENABLED === 'true',

  // Заглушка вместо воронки продаж: обычный пользователь на любое действие получает
  // один экран «клуб теперь бесплатный» со ссылкой на канал. Команды /stop, /delete,
  // /help и админские работают как раньше — они идут мимо dispatch.
  // Выключается CLUB_FREE_STUB=false во .env, если воронку решат вернуть.
  CLUB_FREE_STUB: process.env.CLUB_FREE_STUB !== 'false',

  // Ссылка на открытый канал для заглушки. Пока не задана во .env — используется
  // прежняя ссылка-приглашение, она продолжает работать и на открытом канале.
  CLUB_PUBLIC_LINK: process.env.CLUB_PUBLIC_LINK || 'https://t.me/+7TOIRKAUYzg5MjNi',

  // Акция «бесплатный месяц» 06.08.2026 (вход из сторис по диплинку ?start=trial0608).
  // Продлить окно: TRIAL_END в .env (ISO с +03:00) + pm2 restart.
  // 06.08: продлено до 13:00 07.08 по просьбе Ксении (было 23:59 06.08).
  // 07.08: продлено до 23:59 08.08 для ретро-волны (сторис вели на лендинг мимо акции,
  // ~31 человеку дослан оффер отдельной рассылкой broadcast-trial-retro.js).
  TRIAL_SOURCE: 'trial0608',
  TRIAL_END: process.env.TRIAL_END || '2026-08-08T23:59:00+03:00',
  // Последний созыв (сообщение тем, кто перешёл, но не нажал кнопку) — окно отправки МСК
  TRIAL_REMIND_FROM:  '2026-08-07T10:00:00+03:00',
  TRIAL_REMIND_UNTIL: '2026-08-07T13:00:00+03:00',

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
