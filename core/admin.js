const store = require('./store');
const m = require('./messages');

function handleAdminCommand(text, platform = 'telegram', chatId = null) {
  const [cmd, ...args] = text.trim().split(/\s+/);

  switch (cmd.toLowerCase()) {
    case '/stats': {
      const s = store.getStats();
      const pct = (n, total) => (total ? Math.round(n / total * 100) + '%' : '—');
      let out = '📊 Статистика:\n\n';
      out += `Всего зашли: ${s.started}\n`;
      out += `Увидели оффер: ${s.offered} (${pct(s.offered, s.started)})\n`;
      out += `Купили гайд: ${s.paid} (${pct(s.paid, s.started)})\n`;
      out += `Успешных платежей: ${s.paymentsCount} на ${s.revenue} ₽\n`;
      if (Object.keys(s.bySources).length) {
        out += '\n📍 По источникам:\n';
        for (const [src, cnt] of Object.entries(s.bySources)) out += `  ${src}: ${cnt}\n`;
      }
      return { text: out };
    }

    case '/completed': {
      const users = store.getAllUsers().filter(u => u.state === 'COMPLETED_GUIDE');
      if (!users.length) return { text: 'Купивших пока нет.' };
      const list = users.map(u => `${u.chat_id}${u.username ? ' @' + u.username : ''} — ${u.completed_at || ''}`).join('\n');
      return { text: `✅ Купили гайд (${users.length}):\n\n${list}` };
    }

    case '/user': {
      const targetId = args[0];
      if (!targetId) return { text: 'Использование: /user <chat_id>' };
      const u = store.getUser(targetId);
      if (!u) return { text: 'Пользователь не найден.' };
      return {
        text: `👤 ${u.chat_id}${u.username ? ' @' + u.username : ''}\nСтатус: ${u.state}\n` +
          `Оффер: ${u.offered_at || '—'}\nКупил: ${u.completed_at || '—'}\n` +
          `Напоминаний: ${u.motiv_count || 0}/${m.MOTIVATION.length}\n` +
          `Рассылка: ${u.opt_out ? '🔕 отписан (/stop)' : '✅ активна'}\nОбновлён: ${u.updated_at}`,
      };
    }

    case '/reset': {
      const targetId = args[0];
      if (!targetId) return { text: 'Использование: /reset <chat_id>' };
      if (!store.getUser(targetId)) return { text: 'Пользователь не найден.' };
      store.resetUser(targetId);
      return { text: `🔄 Пользователь ${targetId} сброшен в начало.` };
    }

    case '/broadcast': {
      // Рассылка тем, кто видел оффер, но не купил
      const broadcastText = args.join(' ');
      if (!broadcastText) return { text: 'Использование: /broadcast <текст> — тем, кто видел оффер и не купил' };
      const targets = store.getAllUsers().filter(u => u.state === 'AWAIT_PAYMENT_GUIDE' && !u.opt_out);
      if (!targets.length) return { text: 'Нет подходящих пользователей.', broadcast: [] };
      return {
        text: `📨 Рассылка для ${targets.length} пользователей запущена.`,
        broadcast: targets.map(u => ({ platform: 'telegram', chatId: u.chat_id, text: broadcastText })),
      };
    }

    case '/export': {
      const users = store.getAllUsers();
      const rows = users.map(u =>
        [u.id, u.chat_id, u.username || '', u.first_name || '', u.source || '', u.state,
          u.offered_at || '', u.completed_at || '', u.started_at || '', u.updated_at].join(',')
      );
      const csv = 'id,chat_id,username,first_name,source,state,offered_at,completed_at,started_at,updated_at\n' + rows.join('\n');
      return { text: `📋 База (${users.length} записей). Отправляю файл:`, file: { content: csv, filename: `users_export_${Date.now()}.csv` } };
    }

    case '/test': {
      if (chatId) {
        store.setTestMode(chatId, true);
        store.resetUser(chatId);
      }
      return { text: '🧪 Режим тестирования включён. Твои данные сброшены — напиши /start, чтобы пройти путь покупателя.' };
    }

    case '/admin': {
      if (chatId) store.setTestMode(chatId, false);
      return {
        text: '👑 Режим админа.\n\nКоманды:\n/stats — статистика\n/completed — купившие\n/user <id> — инфо\n' +
          '/reset <id> — сброс\n/broadcast <текст> — тем, кто не купил\n/export — CSV\n/test — пройти путь покупателя',
      };
    }

    default:
      return { text: 'Команды:\n/stats /completed /user <id> /reset <id> /broadcast <текст> /export /test /admin' };
  }
}

module.exports = { handleAdminCommand };
