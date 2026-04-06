require('dotenv').config();

module.exports = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,
  VK_TOKEN:       process.env.VK_TOKEN,
  VK_GROUP_ID:    process.env.VK_GROUP_ID,

  SBER_LINK: 'https://messenger.online.sberbank.ru/sl/8T3iVSXMkI7jBI1oI',

  FILES: {
    guide:     './assets/guide.pdf',
    tracker:   './assets/tracker.pdf',
    wallpaper: './assets/wallpaper.jpg',
  },

  AUTO_PROGRESS_MINUTES: 30,
  REMINDER_HOURS:        24,

  BANNERS: {
    msg1: null, // './assets/banners/banner_1.jpg' — добавить по готовности
    msg2: null,
    msg3: null,
  },
};
