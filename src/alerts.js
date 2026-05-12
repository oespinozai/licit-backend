const db = require('./db');

function matchFilters(tender, filters) {
  if (!filters || Object.keys(filters).length === 0) return true;
  const f = typeof filters === 'string' ? JSON.parse(filters) : filters;

  if (f.categories && f.categories.length > 0) {
    const cat = tender.category || '';
    if (!f.categories.some(c => cat.toLowerCase().includes(c.toLowerCase()))) return false;
  }

  if (f.departments && f.departments.length > 0) {
    const dept = tender.department || '';
    if (!f.departments.some(d => dept.toLowerCase().includes(d.toLowerCase()))) return false;
  }

  if (f.minAmount && tender.amount < f.minAmount) return false;
  if (f.maxAmount && tender.amount > f.maxAmount) return false;

  if (f.keywords && f.keywords.length > 0) {
    const text = (tender.title || '') + ' ' + (tender.buyer_name || '');
    if (!f.keywords.some(k => text.toLowerCase().includes(k.toLowerCase()))) return false;
  }

  return true;
}

async function processAlerts(newTenders) {
  const subscribers = db.prepare('SELECT * FROM subscribers WHERE active = 1').all();
  if (subscribers.length === 0) return;

  for (const tender of newTenders) {
    for (const sub of subscribers) {
      const filters = sub.filters ? JSON.parse(sub.filters) : {};
      if (!matchFilters(tender, filters)) continue;

      if (sub.telegram_chat_id) {
        await sendTelegram(sub.telegram_chat_id, tender);
      }
      if (sub.email) {
        await sendEmail(sub.email, tender);
      }
    }
  }
}

async function sendTelegram(chatId, tender) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const cat = tender.category || '';
  const amount = tender.amount ? `S/ ${tender.amount.toLocaleString('es-PE')}` : 'Monto no especificado';
  const msg = `🔔 *Nueva convocatoria*\n\n*${tender.title || 'Sin título'}*\n\nEntidad: ${tender.buyer_name || 'N/A'}\nObjeto: ${cat}\nMonto: ${amount}\nPublicación: ${tender.date_published || 'N/A'}\n\n#Licit #SEACE`;

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' }),
    });
    console.log(`[ALERT] Sent Telegram to ${chatId}: ${tender.ocid}`);
  } catch (err) {
    console.error('[ALERT] Telegram error:', err.message);
  }
}

async function sendEmail(email, tender) {
  // Placeholder: Integrate with SendGrid, Resend, etc.
  console.log(`[ALERT] Would email ${email} about ${tender.ocid}`);
}

module.exports = { processAlerts };
