// Database memakai SQLite bawaan Node.js (node:sqlite), jadi tidak perlu
// memasang program database terpisah. Semua data tersimpan di satu file.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Setiap elemen = satu langkah perubahan struktur tabel. Kalau nanti butuh
// kolom/tabel baru, tambahkan elemen baru di akhir (jangan ubah yang lama).
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    email_verified_at TEXT,
    business_name TEXT,
    usage TEXT,
    onboarded_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    user_agent TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE email_codes (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('verify','reset')),
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    used_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_codes_user ON email_codes(user_id, purpose);

  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
    subtype TEXT NOT NULL,
    role TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, code)
  );
  CREATE UNIQUE INDEX idx_accounts_role ON accounts(user_id, role) WHERE role IS NOT NULL;

  CREATE TABLE contacts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('customer','supplier','employee','other')),
    email TEXT,
    phone TEXT,
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_contacts_user ON contacts(user_id);

  CREATE TABLE entries (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    kind TEXT NOT NULL,
    amount INTEGER NOT NULL,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_entries_user_date ON entries(user_id, date);

  CREATE TABLE lines (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    debit INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_lines_entry ON lines(entry_id);
  CREATE INDEX idx_lines_account ON lines(account_id);

  CREATE TABLE debts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('payable','receivable')),
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    due_date TEXT,
    description TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_debts_user ON debts(user_id);

  CREATE TABLE debt_payments (
    id INTEGER PRIMARY KEY,
    debt_id INTEGER NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    date TEXT NOT NULL
  );
  CREATE INDEX idx_payments_debt ON debt_payments(debt_id);

  CREATE TABLE budgets (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    PRIMARY KEY (user_id, account_id)
  );

  CREATE TABLE chat_messages (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content TEXT NOT NULL,
    mode TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_chat_user ON chat_messages(user_id, id);
  `,
];

export function openDb(file) {
  if (process.env.VERCEL) file = '/tmp/app.db';
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  const cache = new Map();
  const prep = (sql) => {
    let stmt = cache.get(sql);
    if (!stmt) {
      stmt = raw.prepare(sql);
      cache.set(sql, stmt);
    }
    return stmt;
  };

  let inTx = false;
  const db = {
    get: (sql, ...params) => prep(sql).get(...params),
    all: (sql, ...params) => prep(sql).all(...params),
    run: (sql, ...params) => prep(sql).run(...params),
    exec: (sql) => raw.exec(sql),
    // Menjalankan beberapa perintah sebagai satu paket: kalau satu gagal,
    // semuanya dibatalkan. Ini yang menjaga jurnal tidak pernah "setengah tersimpan".
    tx(fn) {
      if (inTx) return fn();
      raw.exec('BEGIN IMMEDIATE');
      inTx = true;
      try {
        const result = fn();
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      } finally {
        inTx = false;
      }
    },
    close: () => raw.close(),
  };

  const current = Number(db.get('PRAGMA user_version').user_version) || 0;
  for (let i = current; i < MIGRATIONS.length; i += 1) {
    db.tx(() => {
      raw.exec(MIGRATIONS[i]);
      raw.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
  return db;
}

export const nowIso = () => new Date().toISOString();
