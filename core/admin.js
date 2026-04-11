const store = require('./store');

const STATES_ORDER = ['MSG1_SENT', 'MSG2_SENT', 'AWAIT_PAYMENT', 'COMPLETED'];

function handleAdminCommand(text, platform = null, chatId = null) {
  const [cmd, ...args] = text.trim().split(/\s+/);

  switch (cmd.toLowerCase()) {

    case '/stats': {
      const all = getAllUsers();
      const byState = {};
      const tg = {}, vk = {};
      for (const u of all) {
        byState[u.state] = (byState[u.state] || 0) + 1;
        if (u.platform === 'telegram') tg[u.state] = (tg[u.state] || 0) + 1;
        if (u.platform === 'vk') vk[u.state] = (vk[u.state] || 0) + 1;
      }
      const tgTotal = Object.values(tg).reduce((a, b) => a + b, 0);
      const vkTotal = Object.values(vk).reduce((a, b) => a + b, 0);
      const pct = (n, total) => total ? Math.round(n / total * 100) + '%' : '—';

      let text = `📊 Статистика:\n\nВсего: ${all.length}\n\n`;
      text += `Telegram (${tgTotal}):\n`;
      for (const s of STATES_ORDER) text += `  ${s}: ${tg[s] || 0}\n`;
      text += `  Конверсия: ${pct(tg['COMPLETED'] || 0, tgTotal)}\n\n`;
      text += `VK (${vkTotal}):\n`;
      for (const s of STATES_ORDER) text += `  ${s}: ${vk[s] || 0}\n`;
      text += `  Конверсия: ${pct(vk['COMPLETED'] || 0, vkTotal)}\n`;
      return { text };
    }

    case '/completed': {
      const users = getAllUsers().filter(u => u.state === 'COMPLETED');
      if (!users.length) return { text: 'Оплативших пока нет.' };
      const list = users.map(u => `[${u.platform}] ${u.chat_id}`).join('\n');
      return { text: `✅ Оплатили (${users.length}):\n\n${list}` };
    }

    case '/user': {
      const [platform, chatId] = args;
      if (!platform || !chatId) return { text: 'Использование: /user telegram|vk <chat_id>' };
      const u = store.getUser(platform, chatId);
      if (!u) return { text: 'Пользователь не найден.' };
      return { text: `👤 [${u.platform}] ${u.chat_id}\nСтатус: ${u.state}\nОбновлён: ${u.updated_at}\nНапоминаний: ${u.reminder_count}` };
    }

    case '/reset': {
      const [platform, chatId] = args;
      if (!platform || !chatId) return { text: 'Использование: /reset telegram|vk <chat_id>' };
      const u = store.getUser(platform, chatId);
      if (!u) return { text: 'Пользователь не найден.' };
      store.upsertUser(platform, chatId, 'MSG1_SENT');
      return { text: `🔄 Пользователь [${platform}] ${chatId} сброшен в MSG1_SENT.` };
    }

    case '/broadcast': {
      const broadcastText = args.join(' ');
      if (!broadcastText) return { text: 'Использование: /broadcast <текст>' };
      const targets = getAllUsers().filter(u => u.state === 'AWAIT_PAYMENT');
      if (!targets.length) return { text: 'Нет пользователей в AWAIT_PAYMENT.', broadcast: [] };
      return {
        text: `📨 Рассылка для ${targets.length} пользователей запущена.`,
        broadcast: targets.map(u => ({ platform: u.platform, chatId: u.chat_id, text: broadcastText })),
      };
    }

    case '/export': {
      const users = getAllUsers();
      const rows = users.map(u =>
        `${u.id},${u.platform},${u.chat_id},${u.state},${u.updated_at},${u.reminder_count}`
      );
      const csv = 'id,platform,chat_id,state,updated_at,reminder_count\n' + rows.join('\n');
      const filename = `users_export_${Date.now()}.csv`;
      return { text: `📋 База (${users.length} записей). Отправляю файл:`, file: { content: csv, filename } };
    }

    case '/test': {
      if (platform && chatId) {
        store.setTestMode(platform, chatId, true);
      }
      return { 
        text: `🧪 Режим тестирования переключен. Теперь вы обычный пользователь. Напишите /admin чтобы вернуться в режим админа.`,
        testMode: true 
      };
    }

    case '/admin': {
      if (platform && chatId) {
        store.setTestMode(platform, chatId, false);
      }
      return { 
        text: `👑 Режим админа восстановлен. Доступные команды: /stats, /completed, /user, /reset, /broadcast, /export, /test`,
        adminMode: true 
      };
    }

    default:
      return { text: `Команды:\n/stats — статистика\n/completed — список оплативших\n/user platform id — инфо о пользователе\n/reset platform id — сброс состояния\n/broadcast текст — рассылка в AWAIT_PAYMENT\n/export — выгрузка базы` };
  }
}

function getAllUsers() {
  const { DatabaseSync } = require('node:sqlite');
  const path = require('path');
  const db = new DatabaseSync(path.join(__dirname, '../data/users.db'));
  return db.prepare('SELECT * FROM users ORDER BY updated_at DESC').all();
}

module.exports = { handleAdminCommand };
