const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DATABASE_PATH || './data/licit.db';
let db = null;
const ready = initDb();

async function initDb() {
  const SQL = await initSqlJs();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS seen_tenders (
    ocid TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    title TEXT,
    buyer_name TEXT,
    category TEXT,
    amount REAL,
    date_published TEXT,
    deadline TEXT,
    procurement_method TEXT,
    department TEXT,
    raw_json TEXT,
    first_seen_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    telegram_chat_id TEXT,
    whatsapp_phone TEXT,
    filters TEXT DEFAULT '{}',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ocid TEXT NOT NULL,
    subscriber_id INTEGER,
    channel TEXT NOT NULL,
    sent_at TEXT DEFAULT (datetime('now'))
  )`);

  persist();
  return db;
}

function persist() {
  if (db) {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }
}

function run(sql, params = []) {
  db.run(sql, params);
  persist();
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  const result = stmt.getAsObject(params);
  stmt.free();
  return result;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

module.exports = { ready, run, get, all };
