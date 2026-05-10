const { handleAdminCommand } = require('./admin');

let broadcastInProgress = false;

async function handleGlobalAdminCommand(text, platform, senderId, adapter) {
  const result = handleAdminCommand(text, platform, senderId);

  if (result.broadcast && result.broadcast.length > 0) {
    if (broadcastInProgress) {
      return { text: '⚠️ Рассылка уже выполняется, подождите...' };
    }
    broadcastInProgress = true;
    try {
      for (const item of result.broadcast) {
        try {
          await adapter.sendText(item.chatId, item.text);
          await new Promise(r => setTimeout(r, 100));
        } catch (err) {
          console.error(`[admin-router] broadcast error for ${item.chatId}:`, err.message);
        }
      }
    } finally {
      broadcastInProgress = false;
    }
  }

  return result;
}

module.exports = { handleGlobalAdminCommand };
