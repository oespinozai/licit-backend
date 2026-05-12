require('dotenv').config();
const db = require('./db');
const { pollLatest } = require('./poller');
const { processAlerts } = require('./alerts');

const SYNC_TARGETS = (process.env.SYNC_API_URLS || 'http://localhost:3001').split(',');

async function syncToTargets(tenders) {
  if (!tenders || tenders.length === 0) return;
  for (const url of SYNC_TARGETS) {
    try {
      const res = await fetch(`${url}/api/tenders/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenders }),
      });
      if (res.ok) console.log(`[SYNC] Pushed ${tenders.length} to ${url}`);
    } catch (err) {
      console.error(`[SYNC] Failed to push to ${url}:`, err.message);
    }
  }
}

async function run() {
  await db.ready;
  console.log('[WORKER] Starting...');

  // Push any unstored records on startup
  const pending = db.all('SELECT ocid, source, title, buyer_name, category, amount, date_published, deadline, procurement_method, department FROM seen_tenders ORDER BY first_seen_at DESC', []);
  if (pending.length > 0) {
    console.log(`[WORKER] Syncing ${pending.length} existing records to targets...`);
    const tenders = pending.map(r => ({
      ocid: r.ocid, source: r.source, title: r.title, buyer_name: r.buyer_name,
      category: r.category, amount: r.amount, date_published: r.date_published,
      deadline: r.deadline, procurement_method: r.procurement_method, department: r.department
    }));
    // Push in batches
    for (let i = 0; i < tenders.length; i += 100) {
      const batch = tenders.slice(i, i + 100);
      for (const url of SYNC_TARGETS) {
        try {
          await fetch(`${url}/api/tenders/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenders: batch }),
          });
        } catch {}
      }
    }
    console.log('[WORKER] Sync complete');
  }

  const interval = parseInt(process.env.POLL_INTERVAL_MINUTES) || 15;

  const doPoll = async () => {
    console.log('[WORKER] Polling OCDS API...');
    const tenders = await pollLatest();
    if (tenders.length > 0) {
      await processAlerts(tenders);
      await syncToTargets(tenders);
    }
  };

  await doPoll();
  setInterval(doPoll, interval * 60 * 1000);
}

run().catch(err => {
  console.error('[WORKER] Fatal:', err);
  process.exit(1);
});
