const { handleAdminCommand } = require('./admin');

// Защита от дублирования рассылки
let broadcastInProgress = false;

/**
 * Глобальный обработчик команд админа, который может запускать кросс-платформенные действия
 * @param {string} text - текст команды
 * @param {string} senderPlatform - платформа отправителя ('vk' или 'telegram')
 * @param {string} senderId - ID отправителя
 * @param {object} adapters - объект с адаптерами { telegram: {...}, vk: {...} }
 */
async function handleGlobalAdminCommand(text, senderPlatform, senderId, adapters) {
  const result = handleAdminCommand(text, senderPlatform, senderId);

  // Обработка рассылки
  if (result.broadcast && result.broadcast.length > 0) {
    // Защита от дублирования
    if (broadcastInProgress) {
      console.warn('[admin-router] ⚠️ Broadcast already in progress, skipping duplicate!');
      return { text: '⚠️ Рассылка уже выполняется, подождите...' };
    }
    
    broadcastInProgress = true;
    
    try {
      const telegramAdapter = adapters.telegram;
      const vkAdapter = adapters.vk;

      console.log(`\n========== [admin-router] BROADCAST START ==========`);
      console.log(`[admin-router] Sender: ${senderPlatform}, Command: "${text}"`);
      console.log(`[admin-router] Recipients: ${result.broadcast.length}`);
      console.log(`[admin-router] Available adapters:`, {
        telegram: !!telegramAdapter && !!telegramAdapter.sendText,
        vk: !!vkAdapter && !!vkAdapter.sendText
      });
      
      // Логирование всех получателей
      console.log('[admin-router] Recipients list:');
      result.broadcast.forEach((item, idx) => {
        console.log(`  ${idx + 1}. ${item.platform} - ${item.chatId}`);
      });
      
      console.log(`================================================\n`);

      for (const item of result.broadcast) {
        console.log(`\n--- Sending to ${item.platform} user ${item.chatId} ---`);
        
        try {
          if (item.platform === 'telegram') {
            if (!telegramAdapter) {
              console.error('[admin-router] ❌ Telegram adapter not available!');
              continue;
            }
            if (!telegramAdapter.sendText) {
              console.error('[admin-router] ❌ telegramAdapter.sendText not available!');
              console.error('[admin-router] Available methods:', Object.keys(telegramAdapter));
              continue;
            }
            
            console.log('[admin-router] Calling telegramAdapter.sendText...');
            await telegramAdapter.sendText(item.chatId, item.text);
            console.log(`[admin-router] ✅ SUCCESS: sent to telegram ${item.chatId}`);
            
          } else if (item.platform === 'vk') {
            if (!vkAdapter) {
              console.error('[admin-router] ❌ VK adapter not available!');
              continue;
            }
            if (!vkAdapter.sendText) {
              console.error('[admin-router] ❌ vkAdapter.sendText not available!');
              console.error('[admin-router] Available methods:', Object.keys(vkAdapter));
              continue;
            }
            
            console.log('[admin-router] Calling vkAdapter.sendText...');
            await vkAdapter.sendText(item.chatId, item.text);
            console.log(`[admin-router] ✅ SUCCESS: sent to vk ${item.chatId}`);
            
          } else {
            console.warn(`[admin-router] ⚠️ Unknown platform: ${item.platform}`);
          }
        } catch (err) {
          console.error(`\n[admin-router] ❌ ERROR sending to ${item.platform} ${item.chatId}:`);
          console.error('[admin-router] Error message:', err.message);
          console.error('[admin-router] Error stack:', err.stack);
          console.error('[admin-router] Full error:', err);
        }
      }
      
      console.log(`\n========== [admin-router] BROADCAST END ==========\n`);
    } finally {
      broadcastInProgress = false;
    }
  }

  // Возвращаем результат для отправки ответа админу
  return result;
}

module.exports = { handleGlobalAdminCommand };
