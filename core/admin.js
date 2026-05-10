const store = require('./store');

function handleAdminCommand(text, platform = 'telegram', chatId = null) {
  const [cmd, ...args] = text.trim().split(/\s+/);

  switch (cmd.toLowerCase()) {

    case '/stats': {
      const s = store.getStats();
      const pct = (n, total) => total ? Math.round(n / total * 100) + '%' : '—';
      let out = `📊 Статистика:\n\n`;
      out += `Всего: ${s.started}\n`;
      out += `Прошли тест: ${s.testDone} (${pct(s.testDone, s.started)})\n`;
      out += `Дошли до оплаты: ${s.reachedPayment} (${pct(s.reachedPayment, s.started)})\n`;
      out += `Оплатили: ${s.paid} (${pct(s.paid, s.started)})\n`;
      if (s.bySources && Object.keys(s.bySources).length > 0) {
        out += `\n📍 По источникам:\n`;
        for (const [src, cnt] of Object.entries(s.bySources)) {
          out += `  ${src}: ${cnt}\n`;
        }
      }
      const ab = s.abStats;
      if (ab.A.total > 0 || ab.B.total > 0) {
        const pct = (n, t) => t ? Math.round(n / t * 100) + '%' : '—';
        out += `\n🧪 A/B тест:\n`;
        out += `  А (прогрев): ${ab.A.total} чел, оплатили ${ab.A.paid} (${pct(ab.A.paid, ab.A.total)})\n`;
        out += `  Б (короткий): ${ab.B.total} чел, оплатили ${ab.B.paid} (${pct(ab.B.paid, ab.B.total)})\n`;
      }
      return { text: out };
    }

    case '/completed': {
      const users = store.getAllUsers().filter(u => u.state === 'COMPLETED');
      if (!users.length) return { text: 'Оплативших пока нет.' };
      const list = users.map(u => `${u.chat_id}`).join('\n');
      return { text: `✅ Оплатили (${users.length}):\n\n${list}` };
    }

    case '/user': {
      const targetId = args[0];
      if (!targetId) return { text: 'Использование: /user <chat_id>' };
      const u = store.getUser(targetId);
      if (!u) return { text: 'Пользователь не найден.' };
      return {
        text: `👤 ${u.chat_id}\nСтатус: ${u.state}\nАрхетип: ${u.archetype || '—'}\nОбновлён: ${u.updated_at}\nНапоминаний: ${u.reminder_count}`,
      };
    }

    case '/reset': {
      const targetId = args[0];
      if (!targetId) return { text: 'Использование: /reset <chat_id>' };
      const u = store.getUser(targetId);
      if (!u) return { text: 'Пользователь не найден.' };
      store.upsertUser(targetId, 'WELCOME_SENT');
      return { text: `🔄 Пользователь ${targetId} сброшен в начало.` };
    }

    case '/broadcast': {
      const broadcastText = args.join(' ');
      if (!broadcastText) return { text: 'Использование: /broadcast <текст>' };
      const targets = store.getAllUsers().filter(u => u.state === 'AWAIT_PAYMENT');
      if (!targets.length) return { text: 'Нет пользователей в AWAIT_PAYMENT.', broadcast: [] };
      return {
        text: `📨 Рассылка для ${targets.length} пользователей запущена.`,
        broadcast: targets.map(u => ({ platform: 'telegram', chatId: u.chat_id, text: broadcastText })),
      };
    }

    case '/export': {
      const users = store.getAllUsers();
      const rows = users.map(u =>
        `${u.id},${u.chat_id},${u.username || ''},${u.first_name || ''},${u.source || ''},${u.state},${u.archetype || ''},${u.started_at || ''},${u.completed_at || ''},${u.updated_at},${u.reminder_count}`
      );
      const csv = 'id,chat_id,username,first_name,source,state,archetype,started_at,completed_at,updated_at,reminder_count\n' + rows.join('\n');
      const filename = `users_export_${Date.now()}.csv`;
      return { text: `📋 База (${users.length} записей). Отправляю файл:`, file: { content: csv, filename } };
    }

    case '/test': {
      if (chatId) {
        store.setTestMode(chatId, true);
        // Сбрасываем данные пользователя чтобы пройти цепочку заново
        store.upsertUser(chatId, 'WELCOME_SENT');
        // Очищаем ответы теста и архетип
        store.saveAnswer(chatId, 1, null);
        store.saveAnswer(chatId, 2, null);
        store.saveAnswer(chatId, 3, null);
        store.saveAnswer(chatId, 4, null);
        store.saveArchetype(chatId, null);
      }
      return {
        text: '🧪 Режим тестирования включён. Твои данные сброшены — можешь проходить цепочку заново.\n\nНапиши /start чтобы начать.',
        testMode: true,
      };
    }

    case '/admin': {
      if (chatId) store.setTestMode(chatId, false);
      return {
        text: `👑 Режим админа активен.

Команды:
/stats — статистика воронки
/completed — список оплативших
/user <id> — инфо о пользователе
/reset <id> — сбросить пользователя в начало
/broadcast <текст> — рассылка всем в ожидании оплаты
/export — выгрузка базы в CSV
/test — войти в режим тестирования (сброс твоих данных + /start)`,
        adminMode: true,
      };
    }

    default:
      return { text: 'Команды:\n/stats — статистика\n/completed — оплатившие\n/user <id> — инфо\n/reset <id> — сброс\n/broadcast <текст> — рассылка\n/export — CSV\n/test / /admin — режим тестирования' };
  }
}

module.exports = { handleAdminCommand };
