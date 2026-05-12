require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { pollLatest } = require('./poller');
const { processAlerts } = require('./alerts');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- API Routes ---

app.get('/api/health', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as c FROM seen_tenders').get();
  res.json({ status: 'ok', seenTenders: count.c });
});

app.get('/api/tenders/recent', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const tenders = db.prepare(
    'SELECT ocid, source, title, buyer_name, category, amount, date_published, deadline, procurement_method, department, first_seen_at FROM seen_tenders ORDER BY first_seen_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) as c FROM seen_tenders').get().c;
  res.json({ data: tenders, page, limit, total });
});

app.get('/api/tenders/:ocid', (req, res) => {
  const tender = db.prepare('SELECT * FROM seen_tenders WHERE ocid = ?').get(req.params.ocid);
  if (!tender) return res.status(404).json({ error: 'Not found' });
  tender.raw = JSON.parse(tender.raw_json || '{}');
  res.json(tender);
});

app.post('/api/subscribe', (req, res) => {
  const { email, telegram_chat_id, filters } = req.body;
  if (!email && !telegram_chat_id) {
    return res.status(400).json({ error: 'email or telegram_chat_id required' });
  }
  const result = db.prepare(
    'INSERT INTO subscribers (email, telegram_chat_id, filters) VALUES (?, ?, ?)'
  ).run(email || null, telegram_chat_id || null, JSON.stringify(filters || {}));
  res.json({ id: result.lastInsertRowid, message: 'Subscribed' });
});

app.post('/api/poll', async (req, res) => {
  const tenders = await pollLatest();
  await processAlerts(tenders);
  res.json({ newTenders: tenders.length });
});

// --- Scheduled polling ---
const interval = parseInt(process.env.POLL_INTERVAL_MINUTES) || 15;
cron.schedule(`*/${interval} * * * *`, async () => {
  console.log(`[CRON] Running poll (every ${interval} min)...`);
  const tenders = await pollLatest();
  if (tenders.length > 0) {
    await processAlerts(tenders);
  }
});

// --- Start ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[LICIT] Backend running on port ${PORT}`);
  console.log(`[LICIT] Poll interval: ${interval} minutes`);

  // Initial poll on startup
  setTimeout(async () => {
    console.log('[LICIT] Initial poll...');
    const tenders = await pollLatest();
    console.log(`[LICIT] Found ${tenders.length} existing tenders (cached)`);
  }, 2000);
});
