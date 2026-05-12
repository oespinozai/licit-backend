require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const db = require('./db');
const { pollLatest } = require('./poller');
const { processAlerts } = require('./alerts');

const stripeKey = process.env.STRIPE_SECRET_KEY;
let stripe = null;
if (stripeKey) {
  try { stripe = require('stripe')(stripeKey); } catch(e) { console.error('[STRIPE] Init failed:', e.message); }
}

const PRICE_IDS = {
  basico_monthly: process.env.PRICE_BASICO_MONTHLY || 'price_1TWNgMJPESNny8hCeyVky8vl',
  basico_yearly: process.env.PRICE_BASICO_YEARLY || 'price_1TWNgMJPESNny8hCeyVky8vl',
  pro_monthly: process.env.PRICE_PRO_MONTHLY || 'price_1TWNgNJPESNny8hCcdGeLzzv',
  pro_yearly: process.env.PRICE_PRO_YEARLY || 'price_1TWNgNJPESNny8hCcdGeLzzv',
  portfolio_monthly: process.env.PRICE_PORTFOLIO_MONTHLY || 'price_1TWNgNJPESNny8hC998Ii9gU',
  portfolio_yearly: process.env.PRICE_PORTFOLIO_YEARLY || 'price_1TWNgNJPESNny8hC998Ii9gU',
};

async function main() {
  await db.ready;
  console.log('[LICIT] Database ready');

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    const row = db.get('SELECT COUNT(*) as c FROM seen_tenders');
    res.json({ status: 'ok', seenTenders: row.c || 0 });
  });

  app.get('/api/tenders/recent', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const tenders = db.all(
      'SELECT ocid, source, title, buyer_name, category, amount, date_published, deadline, procurement_method, department, first_seen_at FROM seen_tenders ORDER BY first_seen_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );
    const total = db.get('SELECT COUNT(*) as c FROM seen_tenders').c;
    res.json({ data: tenders, page, limit, total });
  });

  app.get('/api/tenders/:ocid', (req, res) => {
    const tender = db.get('SELECT * FROM seen_tenders WHERE ocid = ?', [req.params.ocid]);
    if (!tender || !tender.ocid) return res.status(404).json({ error: 'Not found' });
    res.json(tender);
  });

  app.get('/api/awards/recent', (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const all = db.all('SELECT ocid, source, title, buyer_name, category, amount, date_published, deadline, procurement_method, department, raw_json FROM seen_tenders ORDER BY first_seen_at DESC LIMIT 500', []);
    const awards = [];
    for (const t of all) {
      try {
        const raw = JSON.parse(t.raw_json || '{}');
        const tags = raw.tag || [];
        const isAward = tags.some(tag => tag === 'award' || tag === 'contract');
        if (!isAward) continue;
        const pubDate = t.date_published || raw.date;
        const consentDate = pubDate ? new Date(new Date(pubDate).getTime() + 7 * 24 * 60 * 60 * 1000) : null;
        const daysLeft = consentDate ? Math.ceil((consentDate - new Date()) / (1000 * 60 * 60 * 24)) : null;
        awards.push({
          ocid: t.ocid,
          title: t.title,
          buyer_name: t.buyer_name,
          category: t.category,
          amount: t.amount,
          award_date: pubDate,
          consent_deadline: consentDate ? consentDate.toISOString() : null,
          days_left_to_contact: daysLeft,
          procurement_method: t.procurement_method,
          department: t.department,
          winner: raw.award && raw.award.suppliers ? raw.award.suppliers.map(s => s.name).join(', ') : null,
        });
      } catch(e) {}
      if (awards.length >= limit) break;
    }
    res.json({ data: awards, total: awards.length });
  });

  app.post('/api/subscribe', (req, res) => {
    const { email, telegram_chat_id, filters } = req.body;
    if (!email && !telegram_chat_id) {
      return res.status(400).json({ error: 'email or telegram_chat_id required' });
    }
    db.run('INSERT INTO subscribers (email, telegram_chat_id, filters) VALUES (?, ?, ?)',
      [email || null, telegram_chat_id || null, JSON.stringify(filters || {})]);
    res.json({ message: 'Subscribed' });
  });

  app.post('/api/tenders/bulk', express.json({ limit: '5mb' }), (req, res) => {
    const { tenders } = req.body;
    if (!tenders || !Array.isArray(tenders)) return res.status(400).json({ error: 'Invalid payload' });
    let count = 0;
    for (const t of tenders) {
      db.run(`INSERT OR IGNORE INTO seen_tenders (ocid, source, title, buyer_name, category, amount, date_published, deadline, procurement_method, department, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [t.ocid, t.source || 'SEACE V3', t.title, t.buyer_name, t.category,
         t.amount, t.date_published, t.deadline, t.procurement_method, t.department, JSON.stringify(t)]);
      count++;
    }
    res.json({ imported: count });
  });

  app.post('/api/poll', async (req, res) => {
    const tenders = await pollLatest();
    await processAlerts(tenders);
    res.json({ newTenders: tenders.length });
  });

  app.post('/api/checkout', express.json(), async (req, res) => {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
    const { plan, interval, email, success_url, cancel_url } = req.body;
    const key = `${plan}_${interval || 'monthly'}`;
    const priceId = PRICE_IDS[key];
    if (!priceId) return res.status(400).json({ error: 'Invalid plan/interval' });

    // 7-day free trial for Pro plan
    const trialDays = plan === 'pro' ? 7 : 0;

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        customer_email: email || undefined,
        subscription_data: trialDays > 0 ? { trial_period_days: trialDays } : undefined,
        success_url: success_url || 'https://oespinozai.github.io/licit/?success=true',
        cancel_url: cancel_url || 'https://oespinozai.github.io/licit/?canceled=true',
        metadata: { plan, interval: interval || 'monthly' },
      });
      res.json({ url: session.url });
    } catch (err) {
      console.error('[STRIPE] Checkout error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`[LICIT] Backend running on port ${PORT}`);
  });

  const interval = parseInt(process.env.POLL_INTERVAL_MINUTES) || 15;
  cron.schedule(`*/${interval} * * * *`, async () => {
    console.log(`[CRON] Running poll (every ${interval} min)...`);
    const tenders = await pollLatest();
    if (tenders.length > 0) await processAlerts(tenders);
  });

  // Initial poll
  setTimeout(async () => {
    console.log('[LICIT] Initial poll...');
    const tenders = await pollLatest();
    console.log(`[LICIT] Found ${tenders.length} new tenders`);
  }, 2000);
}

main().catch(err => {
  console.error('[LICIT] Fatal:', err);
  process.exit(1);
});
