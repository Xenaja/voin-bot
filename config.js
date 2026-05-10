require('dotenv').config();

module.exports = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,

  // Ссылки на оплату
  PAYMENT_LINK: process.env.PAYMENT_LINK || 'https://example.com/pay',

  // Менеджер получает уведомления о сообщениях вне сценария
  MANAGER_TG_ID: process.env.MANAGER_TG_ID ? Number(process.env.MANAGER_TG_ID) : 718850812,
  // Админы — команды /stats, /export, /broadcast и др.
  ADMIN_TELEGRAM_IDS: process.env.ADMIN_TELEGRAM_IDS
    ? process.env.ADMIN_TELEGRAM_IDS.split(',').map(Number)
    : [718850812],

  FILES: {
    guide:          './Gaid+tracker/Gaid-kodvoina.pdf',
    tracker:        './Gaid+tracker/Tracker-30dnei.pdf',
    print_tracker:  './Gaid+tracker/Трекер для печати.pdf',
    wallpapers: [
      './Gaid+tracker/phone-zastavki/IMG_1172.jpg',
      './Gaid+tracker/phone-zastavki/IMG_1173.jpg',
      './Gaid+tracker/phone-zastavki/IMG_1174.jpg',
      './Gaid+tracker/phone-zastavki/IMG_1175.jpg',
    ],
  },

  // Видео для MSG6
  VIDEO_FILE: './video.mp4',
  VIDEO_FALLBACK_URL: 'https://drive.google.com/file/d/1U1Hyc8B9242HjujoohvJN1XRKofJL5S3/view?usp=sharing',

  // Баннеры для результатов теста — указать пути, когда файлы будут готовы
  BANNERS_RESULT: {
    sword:  './visual/result-sword.png',
    shield: './visual/result-shield.png',
    bow:    './visual/result-bow.png',
  },

  BANNERS: {
    msg0:  './visual/1.jpg',  // КОД ВОИНА — первое сообщение
    msg10: './visual/3.jpg',  // САШ, А ЧТО ПО ОПЛАТЕ? — детали оплаты
    msg11: './visual/2.jpg',  // ВРЕМЯ ИДТИ — после оплаты
  },

  // Таймаут 20 сек для авто-перехода WELCOME_SENT → Q1
  WELCOME_DELAY_SECONDS: 10,
  // Авто-прогрессия по кнопкам прогрева (RESULT → … → OFFER) — минуты
  WARMUP_AUTO_MINUTES: 0.5,  // 30 секунд
  // Ремайндер при зависании на вопросах теста — часы
  QUIZ_REMINDER_HOURS: 24,
  // Дожим после оффера — часы
  OFFER_FOLLOWUP_HOURS: 24,
};
