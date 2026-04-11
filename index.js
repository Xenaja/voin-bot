require('dotenv').config();
const config = require('./config');
const { startScheduler } = require('./core/scheduler');
const { handleGlobalAdminCommand } = require('./core/admin-router');

const adapters = {};

if (config.TELEGRAM_TOKEN) {
  adapters.telegram = require('./adapters/telegram').start();
} else {
  console.warn('[index] TELEGRAM_TOKEN не задан — Telegram не запущен');
}

if (config.VK_TOKEN) {
  adapters.vk = require('./adapters/vk').start();
} else {
  console.warn('[index] VK_TOKEN не задан — VK не запущен');
}

// Делаем адаптеры доступными для админ-команд
global.adminRouter = {
  handleAdminCommand: async (text, platform, senderId) => {
    return await handleGlobalAdminCommand(text, platform, senderId, adapters);
  }
};

startScheduler(adapters);
