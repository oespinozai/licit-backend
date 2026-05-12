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
