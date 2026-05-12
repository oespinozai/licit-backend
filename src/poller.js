const db = require('./db');

const API_BASE = process.env.OCDS_API_BASE || 'https://contratacionesabiertas.oece.gob.pe/api/v1';

function mapCategory(cat) {
  const map = { goods: 'Bien', services: 'Servicio', works: 'Obra', consulting: 'Consultoría' };
  return map[cat] || cat;
}

function extractDepartment(release) {
  const ext = release.tender && release.tender.department;
  if (ext) return ext;
  if (release.buyer && release.buyer.name) {
    const name = release.buyer.name.toUpperCase();
    if (name.includes('LIMA')) return 'Lima';
    if (name.includes('AREQUIPA')) return 'Arequipa';
    if (name.includes('CUSCO')) return 'Cusco';
    if (name.includes('LAMBAYEQUE')) return 'Lambayeque';
    if (name.includes('LA LIBERTAD')) return 'La Libertad';
  }
  return null;
}

async function pollLatest() {
  console.log('[POLL] Fetching latest releases...');
  let page = 1;
  let newTenders = [];

  try {
    while (true) {
      const url = `${API_BASE}/releases?page=${page}&paginateBy=100`;
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`[POLL] HTTP ${res.status} on page ${page}`);
        break;
      }
      const data = await res.json();
      const releases = data.releases || [];

      if (releases.length === 0) break;

      for (const release of releases) {
        const ocid = release.ocid;
        if (!ocid) continue;

        const existing = db.prepare('SELECT ocid FROM seen_tenders WHERE ocid = ?').get(ocid);
        if (existing) continue;

        const tender = release.tender || {};
        const buyer = release.buyer || {};
        const planning = release.planning || {};
        const budget = planning.budget || {};
        const amount = (tender.value && tender.value.amount) || (budget.amount && budget.amount.amount) || 0;
        const deadline = (tender.tenderPeriod && tender.tenderPeriod.endDate) || null;

        db.prepare(`
          INSERT OR IGNORE INTO seen_tenders (ocid, source, title, buyer_name, category, amount, date_published, deadline, procurement_method, department, raw_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          ocid,
          'SEACE V3',
          tender.title || '',
          buyer.name || '',
          mapCategory(tender.mainProcurementCategory),
          amount,
          tender.datePublished || null,
          deadline,
          tender.procurementMethodDetails || '',
          extractDepartment(release),
          JSON.stringify(release)
        );

        newTenders.push(release);
      }

      page++;
    }

    console.log(`[POLL] Found ${newTenders.length} new tenders`);
    return newTenders;
  } catch (err) {
    console.error('[POLL] Error:', err.message);
    return [];
  }
}

async function pollSingle(ocid) {
  try {
    const res = await fetch(`${API_BASE}/record/${ocid}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

module.exports = { pollLatest, pollSingle };
