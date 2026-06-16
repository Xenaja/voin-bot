const store = require('./store');

function handleAdminCommand(text, platform = 'telegram', chatId = null) {
  const [cmd, ...args] = text.trim().split(/\s+/);

  switch (cmd.toLowerCase()) {

    case '/stats': {
      const s = store.getStats();
      const pct = (n, total) => total ? Math.round(n / total * 100) + '%' : '—';
      let out = `📊 Статистика:\n\n`;
      out += `Всего: ${s.started}\n`;
      out += `Дошли до оплаты: ${s.reachedPayment} (${pct(s.reachedPayment, s.started)})\n`;
      out += `Оплатили: ${s.paid} (${pct(s.paid, s.started)})\n`;
      if (s.paid > 0) {
        out += `\n💰 По продуктам:\n`;
        out += `  Код Воина (990₽): ${s.byProduct.guide || 0}\n`;
        out += `  Только клуб (490₽): ${s.byProduct.club || 0}\n`;
        out += `  Гайд + Клуб (1390₽): ${s.byProduct.bundle || 0}\n`;
      }
      if (s.bySources && Object.keys(s.bySources).length > 0) {
        out += `\n📍 По источникам:\n`;
        for (const [src, cnt] of Object.entries(s.bySources)) {
          out += `  ${src}: ${cnt}\n`;
        }
      }
      return { text: out };
    }

    case '/completed': {
      const users = store.getAllUsers().filter(u => u.state && u.state.startsWith('COMPLETED_'));
      if (!users.length) return { text: 'Оплативших пока нет.' };
      const list = users.map(u => `${u.chat_id} — ${u.product_type || '?'} (${u.state})`).join('\n');
      return { text: `✅ Оплатили (${users.length}):\n\n${list}` };
    }

    case '/user': {
      const targetId = args[0];
      if (!targetId) return { text: 'Использование: /user <chat_id>' };
      const u = store.getUser(targetId);
      if (!u) return { text: 'Пользователь не найден.' };
      return {
        text: `👤 ${u.chat_id}\nСтатус: ${u.state}\nПродукт: ${u.product_type || '—'}\nКлуб до: ${u.club_expires_at || '—'}\nРассылка: ${u.opt_out ? '🔕 отписан (/stop)' : '✅ активна'}\nОбновлён: ${u.updated_at}`,
      };
    }

    case '/reset': {
      const targetId = args[0];
      if (!targetId) return { text: 'Использование: /reset <chat_id>' };
      const u = store.getUser(targetId);
      if (!u) return { text: 'Пользователь не найден.' };
      store.upsertUser(targetId, 'CONSENT_SENT');
      return { text: `🔄 Пользователь ${targetId} сброшен в начало.` };
    }

    case '/broadcast': {
      const broadcastText = args.join(' ');
      if (!broadcastText) return { text: 'Использование: /broadcast <текст>' };
      const awaitStates = ['AWAIT_PAYMENT_GUIDE', 'AWAIT_PAYMENT_CLUB', 'AWAIT_PAYMENT_BUNDLE', 'OFFER_SENT'];
      const targets = store.getAllUsers().filter(u => awaitStates.includes(u.state) && !u.opt_out);
      if (!targets.length) return { text: 'Нет подходящих пользователей.', broadcast: [] };
      return {
        text: `📨 Рассылка для ${targets.length} пользователей запущена.`,
        broadcast: targets.map(u => ({ platform: 'telegram', chatId: u.chat_id, text: broadcastText })),
      };
    }

    case '/export': {
      const users = store.getAllUsers();
      const rows = users.map(u =>
        `${u.id},${u.chat_id},${u.username || ''},${u.first_name || ''},${u.source || ''},${u.state},${u.product_type || ''},${u.club_expires_at || ''},${u.started_at || ''},${u.completed_at || ''},${u.updated_at}`
      );
      const csv = 'id,chat_id,username,first_name,source,state,product_type,club_expires_at,started_at,completed_at,updated_at\n' + rows.join('\n');
      const filename = `users_export_${Date.now()}.csv`;
      return { text: `📋 База (${users.length} записей). Отправляю файл:`, file: { content: csv, filename } };
    }

    case '/test': {
      if (chatId) {
        store.setTestMode(chatId, true);
        // Сброс состояния для чистого прохождения цепочки
        store.upsertUser(chatId, 'CONSENT_SENT');
        store.savePaymentId(chatId, null);
        store.saveProductType(chatId, null);
        store.saveClubExpiry(chatId, null);
      }
      return {
        text: '🧪 Режим тестирования включён. Твои данные сброшены — напиши /start чтобы начать заново.',
        testMode: true,
      };
    }

    case '/admin': {
      if (chatId) store.setTestMode(chatId, false);
      return {
        text: `👑 Режим админа активен.\n\nКоманды:\n/stats — статистика\n/completed — оплатившие\n/user <id> — инфо\n/reset <id> — сброс\n/broadcast <текст> — рассылка\n/export — CSV\n/test — режим тестирования`,
        adminMode: true,
      };
    }

    default:
      return { text: 'Команды:\n/stats /completed /user <id> /reset <id> /broadcast <текст> /export /test /admin' };
  }
}

module.exports = { handleAdminCommand };
