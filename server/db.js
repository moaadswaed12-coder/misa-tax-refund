const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'misa.db');
let db = null;

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');
  initSchema();
  saveDb();
  return db;
}

function initSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS leads (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL,
      phone           TEXT    NOT NULL UNIQUE,
      refund_estimate INTEGER DEFAULT 0,
      status          TEXT    DEFAULT 'new',
      answers_json    TEXT,
      card_token      TEXT,
      card_last_four  TEXT,
      created_at      TEXT    DEFAULT (datetime('now', '+2 hours'))
    )
  `);

  // Auto-migrate columns for schema upgrades
  // leads table
  try {
    const cols = db.exec("PRAGMA table_info(leads)");
    const colNames = cols[0]?.values.map(r => r[1]) || [];
    const addCol = (name, type) => {
      if (!colNames.includes(name)) db.run(`ALTER TABLE leads ADD COLUMN ${name} ${type}`);
    };
    addCol('card_token', 'TEXT');
    addCol('card_last_four', 'TEXT');
    addCol('charged_amount', 'REAL DEFAULT 0');
    addCol('approved_at', 'TEXT');
    addCol('charged_at', 'TEXT');
    addCol('id_photo_path', 'TEXT');
    addCol('id_photo_verified', 'INTEGER DEFAULT 0');
  } catch (_) { /* ignore */ }

  // documents table
  try {
    const cols = db.exec("PRAGMA table_info(documents)");
    const colNames = cols[0]?.values.map(r => r[1]) || [];
    if (!colNames.includes('doc_type')) db.run("ALTER TABLE documents ADD COLUMN doc_type TEXT DEFAULT '106'");
  } catch (_) { /* ignore */ }

  db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id       INTEGER NOT NULL,
      filename      TEXT    NOT NULL,
      original_name TEXT    NOT NULL,
      file_path     TEXT    NOT NULL,
      mime_type     TEXT,
      file_size     INTEGER,
      uploaded_at   TEXT    DEFAULT (datetime('now', '+2 hours')),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    )
  `);
}

function saveDb() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDb();
  return db.exec("SELECT last_insert_rowid() AS id")[0]?.values[0][0];
}

module.exports = { getDb, queryAll, queryOne, run };
