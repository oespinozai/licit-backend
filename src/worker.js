require('dotenv').config();
const db = require('./db');
const { pollLatest } = require('./poller');
const { processAlerts } = require('./alerts');

const RAILWAY_API = process.env.RAILWAY_API_URL || 'http://localhost:3001';

async function syncToRailway(tenders) {
  if (!tenders || tenders.length === 0) return;
  try {
    const res = await fetch(`${RAILWAY_API}/api/tenders/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenders }),
    });
    if (res.ok) console.log(`[SYNC] Pushed ${tenders.length} tenders to Railway`);
  } catch (err) {
    console.error('[SYNC] Failed:', err.message);
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
      await syncToRailway(tenders);
    }
  };

  await doPoll();
  setInterval(doPoll, interval * 60 * 1000);
}

run().catch(err => {
  console.error('[WORKER] Fatal:', err);
  process.exit(1);
});
