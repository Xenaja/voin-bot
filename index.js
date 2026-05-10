require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const config = require('./config');
const { startScheduler } = require('./core/scheduler');
const { handleGlobalAdminCommand } = require('./core/admin-router');

if (!config.TELEGRAM_TOKEN) {
  console.error('[index] TELEGRAM_TOKEN не задан — выход');
  process.exit(1);
}

const adapter = require('./adapters/telegram').start();

global.adminRouter = {
  handleAdminCommand: async (text, platform, senderId) => {
    return await handleGlobalAdminCommand(text, platform, senderId, adapter);
  },
};

startScheduler(adapter);
