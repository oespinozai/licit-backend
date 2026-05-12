const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DATABASE_PATH || './data/licit.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS seen_tenders (
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
  );

  CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    telegram_chat_id TEXT,
    whatsapp_phone TEXT,
    filters TEXT DEFAULT '{}',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ocid TEXT NOT NULL,
    subscriber_id INTEGER,
    channel TEXT NOT NULL,
    sent_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (subscriber_id) REFERENCES subscribers(id)
  );
`);

module.exports = db;
