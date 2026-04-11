require('dotenv').config();

module.exports = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,
  VK_TOKEN:       process.env.VK_TOKEN,
  VK_GROUP_ID:    process.env.VK_GROUP_ID,

  SBER_LINK:  'https://messenger.online.sberbank.ru/sl/8T3iVSXMkI7jBI1oI',
  VTB_LINK:   'https://vtb.paymo.ru/collect-money/?transaction=d67d2291-eb56-4477-9e8a-7c5dac7dcd92',

  // Менеджер получает уведомления о сообщениях вне сценария
  MANAGER_VK_ID: 1104677909,
  MANAGER_TG_ID: 718850812,
  // Админы — команды /stats, /export, /broadcast и др.
  ADMIN_VK_IDS: [103652699, 1104677909],
  ADMIN_TELEGRAM_IDS: [718850812],

  FILES: {
    combined:  './Gaid+tracker/Gaid-tracker-KodVoina.pdf',
    guide:     './Gaid+tracker/Gaid-kodvoina.pdf',
    tracker:   './Gaid+tracker/Tracker-30dnei.pdf',
    wallpapers: [
      './Gaid+tracker/phone-zastavki/IMG_1172.jpg',
      './Gaid+tracker/phone-zastavki/IMG_1173.jpg',
      './Gaid+tracker/phone-zastavki/IMG_1174.jpg',
      './Gaid+tracker/phone-zastavki/IMG_1175.jpg',
    ],
  },

  AUTO_PROGRESS_MINUTES: 30,
  REMINDER_HOURS:        24,

  BANNERS: {
    msg1: './visual/1.jpg',
    msg2: './visual/2.jpg',
    msg3: './visual/3.jpg',
    msg4: './visual/4.jpg',
  },
};
