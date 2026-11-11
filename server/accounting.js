// Inti pembukuan. Aplikasi ini memakai "pembukuan berpasangan" (double entry):
// setiap transaksi dicatat di dua sisi (debit & kredit) yang jumlahnya selalu sama.
// Ibarat timbangan: kalau kas bertambah, harus jelas dari mana asalnya.
// Pengguna tidak perlu paham ini — form sederhana (pemasukan/pengeluaran)
// otomatis diubah menjadi jurnal oleh fungsi-fungsi di file ini.
import { bad, notFound, v } from './http.js';
import { nowIso } from './db.js';

export const TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];
export const SUBTYPES = {
  asset: ['cash', 'receivable', 'inventory', 'other_current', 'fixed'],
  liability: ['payable', 'loan', 'other'],
  equity: ['capital', 'drawing'],
  income: ['revenue', 'other_income'],
  expense: ['cogs', 'operating', 'other_expense'],
};
const TYPE_ORDER = { asset: 1, liability: 2, equity: 3, income: 4, expense: 5 };
const CODE_PREFIX = { asset: '1', liability: '2', equity: '3', income: '4', expense: '5' };

// Akun yang saldonya normalnya di sisi debit (aset, beban, dan prive).
const debitNormal = (a) => a.type === 'asset' || a.type === 'expense' || a.subtype === 'drawing';
const balanceOf = (a, d, c) => (debitNormal(a) ? d - c : c - d);

// ───────────────────────── Daftar akun bawaan ─────────────────────────

// [kode, nama, tipe, subtipe, peran khusus]
const BASE_ACCOUNTS = [
  ['1101', 'Kas', 'asset', 'cash', 'cash'],
  ['1102', 'Bank', 'asset', 'cash', 'bank'],
  ['1103', 'Dompet Digital', 'asset', 'cash', null],
  ['1201', 'Piutang', 'asset', 'receivable', 'receivable'],
  ['1501', 'Peralatan', 'asset', 'fixed', null],
  ['2101', 'Utang Usaha', 'liability', 'payable', 'payable'],
  ['2201', 'Utang Pinjaman', 'liability', 'loan', 'loan'],
  ['3101', 'Modal', 'equity', 'capital', 'capital'],
  ['3201', 'Prive (Tarik Modal)', 'equity', 'drawing', 'drawing'],
];

const TEMPLATES = {
  usaha: [
    ['1301', 'Persediaan Barang', 'asset', 'inventory', null],
    ['4101', 'Pendapatan Penjualan', 'income', 'revenue', null],
    ['4102', 'Pendapatan Jasa', 'income', 'revenue', null],
    ['4201', 'Pendapatan Lain-lain', 'income', 'other_income', null],
    ['5101', 'Pembelian Barang (HPP)', 'expense', 'cogs', null],
    ['5201', 'Gaji Karyawan', 'expense', 'operating', null],
    ['5202', 'Sewa', 'expense', 'operating', null],
    ['5203', 'Listrik, Air & Internet', 'expense', 'operating', null],
    ['5204', 'Transportasi', 'expense', 'operating', null],
    ['5205', 'Perlengkapan', 'expense', 'operating', null],
    ['5206', 'Pemasaran & Iklan', 'expense', 'operating', null],
    ['5207', 'Makan & Minum', 'expense', 'operating', null],
    ['5208', 'Hiburan', 'expense', 'operating', null],
    ['5301', 'Beban Lain-lain', 'expense', 'other_expense', null],
  ],
  pribadi: [
    ['4101', 'Gaji', 'income', 'revenue', null],
    ['4102', 'Usaha Sampingan', 'income', 'revenue', null],
    ['4201', 'Pendapatan Lain-lain', 'income', 'other_income', null],
    ['5201', 'Makanan & Minuman', 'expense', 'operating', null],
    ['5202', 'Transportasi', 'expense', 'operating', null],
    ['5203', 'Hiburan', 'expense', 'operating', null],
    ['5204', 'Belanja', 'expense', 'operating', null],
    ['5205', 'Tagihan & Utilitas', 'expense', 'operating', null],
    ['5206', 'Kesehatan', 'expense', 'operating', null],
    ['5207', 'Pendidikan', 'expense', 'operating', null],
    ['5208', 'Sedekah & Hadiah', 'expense', 'operating', null],
    ['5301', 'Pengeluaran Lain-lain', 'expense', 'other_expense', null],
  ],
};

export function seedAccounts(db, userId, usage) {
  const rows = [...BASE_ACCOUNTS, ...(TEMPLATES[usage] || TEMPLATES.pribadi)];
  const now = nowIso();
  for (const [code, name, type, subtype, role] of rows) {
    db.run(
      'INSERT OR IGNORE INTO accounts (user_id, code, name, type, subtype, role, created_at) VALUES (?,?,?,?,?,?,?)',
      userId, code, name, type, subtype, role, now,
    );
  }
}

export function roleAccount(db, userId, role) {
  const acc = db.get('SELECT * FROM accounts WHERE user_id = ? AND role = ?', userId, role);
  if (!acc) throw bad('Akun bawaan belum tersedia. Selesaikan pengaturan awal dulu.', 'ONBOARDING_REQUIRED');
  return acc;
}

export function getAccount(db, userId, id, label = 'Akun') {
  const acc = db.get('SELECT * FROM accounts WHERE id = ? AND user_id = ?', v.id(id, label), userId);
  if (!acc) throw bad(`${label} tidak ditemukan.`);
  return acc;
}

function usableAccount(db, userId, id, label, check) {
  const acc = getAccount(db, userId, id, label);
  if (acc.archived) throw bad(`${label} "${acc.name}" sudah diarsipkan.`);
  if (check && !check(acc)) throw bad(`${label} yang dipilih tidak sesuai.`);
  return acc;
}

// Jumlah debit & kredit tiap akun pada rentang tanggal tertentu.
// opts: { from, to, before } — "before" berarti sebelum tanggal itu (tidak termasuk).
export function sums(db, userId, opts = {}) {
  const cond = ['e.user_id = ?'];
  const params = [userId];
  if (opts.from) { cond.push('e.date >= ?'); params.push(opts.from); }
  if (opts.to) { cond.push('e.date <= ?'); params.push(opts.to); }
  if (opts.before) { cond.push('e.date < ?'); params.push(opts.before); }
  return db.all(
    `SELECT a.id, a.code, a.name, a.type, a.subtype, a.role, a.archived,
            COALESCE(s.d, 0) AS d, COALESCE(s.c, 0) AS c
     FROM accounts a
     LEFT JOIN (
       SELECT l.account_id, SUM(l.debit) AS d, SUM(l.credit) AS c
       FROM lines l JOIN entries e ON e.id = l.entry_id
       WHERE ${cond.join(' AND ')}
       GROUP BY l.account_id
     ) s ON s.account_id = a.id
     WHERE a.user_id = ?
     ORDER BY a.code`,
    ...params, userId,
  );
}

// Laba bersih = pendapatan − beban, pada rentang tertentu.
function netIncome(rows) {
  let net = 0;
  for (const r of rows) {
    if (r.type === 'income') net += r.c - r.d;
    else if (r.type === 'expense') net -= r.d - r.c;
  }
  return net;
}

// ───────────────────────────── Akun ─────────────────────────────

export function listAccounts(db, userId) {
  const used = new Set(db.all('SELECT DISTINCT l.account_id AS id FROM lines l JOIN accounts a ON a.id = l.account_id WHERE a.user_id = ?', userId).map((r) => r.id));
  return sums(db, userId).map((r) => ({
    id: r.id, code: r.code, name: r.name, type: r.type, subtype: r.subtype,
    system: Boolean(r.role), archived: Boolean(r.archived), used: used.has(r.id),
    balance: balanceOf(r, r.d, r.c),
  }));
}

function nextCode(db, userId, type) {
  const prefix = CODE_PREFIX[type];
  const row = db.get('SELECT MAX(CAST(code AS INTEGER)) AS m FROM accounts WHERE user_id = ? AND code LIKE ? AND code GLOB ?', userId, `${prefix}%`, '[0-9][0-9][0-9][0-9]');
  const base = Number(`${prefix}900`);
  return String(Math.max(Number(row?.m) || 0, base) + 1);
}

export function createAccount(db, userId, body) {
  const name = v.str(body.name, 'Nama akun', { max: 80 });
  const type = v.oneOf(body.type, TYPES, 'Tipe akun');
  const subtype = body.subtype ? v.oneOf(body.subtype, SUBTYPES[type], 'Jenis akun') : SUBTYPES[type][type === 'expense' ? 1 : 0];
  let code = v.str(body.code, 'Kode akun', { max: 12, optional: true });
  if (code && !/^[0-9A-Za-z.-]+$/.test(code)) throw bad('Kode akun hanya boleh huruf, angka, titik, atau strip.');
  code ||= nextCode(db, userId, type);
  if (db.get('SELECT 1 AS x FROM accounts WHERE user_id = ? AND code = ?', userId, code)) throw bad(`Kode akun ${code} sudah dipakai.`);
  if (db.get('SELECT 1 AS x FROM accounts WHERE user_id = ? AND name = ? COLLATE NOCASE AND type = ?', userId, name, type)) throw bad(`Akun bernama "${name}" sudah ada.`);
  const r = db.run('INSERT INTO accounts (user_id, code, name, type, subtype, created_at) VALUES (?,?,?,?,?,?)', userId, code, name, type, subtype, nowIso());
  return Number(r.lastInsertRowid);
}

export function updateAccount(db, userId, id, body) {
  const acc = getAccount(db, userId, id);
  const name = body.name !== undefined ? v.str(body.name, 'Nama akun', { max: 80 }) : acc.name;
  let code = body.code !== undefined ? v.str(body.code, 'Kode akun', { max: 12 }) : acc.code;
  if (!/^[0-9A-Za-z.-]+$/.test(code)) throw bad('Kode akun hanya boleh huruf, angka, titik, atau strip.');
  if (code !== acc.code && db.get('SELECT 1 AS x FROM accounts WHERE user_id = ? AND code = ? AND id != ?', userId, code, acc.id)) throw bad(`Kode akun ${code} sudah dipakai.`);
  let subtype = acc.subtype;
  if (body.subtype !== undefined && body.subtype !== acc.subtype) {
    if (acc.role) throw bad('Jenis akun bawaan tidak bisa diubah.');
    subtype = v.oneOf(body.subtype, SUBTYPES[acc.type], 'Jenis akun');
  }
  let archived = acc.archived;
  if (body.archived !== undefined) {
    archived = body.archived ? 1 : 0;
    if (archived && acc.role) throw bad('Akun bawaan tidak bisa diarsipkan.');
  }
  db.run('UPDATE accounts SET name = ?, code = ?, subtype = ?, archived = ? WHERE id = ?', name, code, subtype, archived, acc.id);
}

export function deleteAccount(db, userId, id) {
  const acc = getAccount(db, userId, id);
  if (acc.role) throw bad('Akun bawaan tidak bisa dihapus.');
  if (db.get('SELECT 1 AS x FROM lines WHERE account_id = ? LIMIT 1', acc.id)) {
    throw bad('Akun ini sudah dipakai di transaksi, jadi tidak bisa dihapus. Kamu bisa mengarsipkannya.');
  }
  db.run('DELETE FROM accounts WHERE id = ?', acc.id);
}

// ───────────────────────────── Jurnal ─────────────────────────────

function cleanLines(db, userId, lines) {
  if (!Array.isArray(lines) || lines.length < 2) throw bad('Jurnal butuh minimal dua baris.');
  if (lines.length > 40) throw bad('Jurnal maksimal 40 baris.');
  let totalDebit = 0;
  let totalCredit = 0;
  const out = [];
  for (const line of lines) {
    const acc = usableAccount(db, userId, line?.accountId, 'Akun');
    const debit = v.amount(line.debit ?? 0, 'Debit', { allowZero: true });
    const credit = v.amount(line.credit ?? 0, 'Kredit', { allowZero: true });
    if ((debit > 0) === (credit > 0)) throw bad('Setiap baris diisi salah satu saja: debit atau kredit.');
    totalDebit += debit;
    totalCredit += credit;
    out.push({ accountId: acc.id, debit, credit });
  }
  if (totalDebit !== totalCredit) throw bad('Total debit dan kredit harus sama (seimbang).');
  return { lines: out, amount: totalDebit };
}

function checkContact(db, userId, contactId) {
  if (contactId === undefined || contactId === null || contactId === '') return null;
  const row = db.get('SELECT id FROM contacts WHERE id = ? AND user_id = ?', v.id(contactId, 'Kontak'), userId);
  if (!row) throw bad('Kontak tidak ditemukan.');
  return row.id;
}

export function createEntry(db, userId, { date, description, kind, contactId, lines }) {
  const d = v.date(date);
  const desc = v.str(description, 'Keterangan', { max: 200 });
  const clean = cleanLines(db, userId, lines);
  const contact = checkContact(db, userId, contactId);
  return db.tx(() => {
    const r = db.run(
      'INSERT INTO entries (user_id, date, description, kind, amount, contact_id, created_at) VALUES (?,?,?,?,?,?,?)',
      userId, d, desc, kind, clean.amount, contact, nowIso(),
    );
    const id = Number(r.lastInsertRowid);
    clean.lines.forEach((l, i) => db.run('INSERT INTO lines (entry_id, account_id, debit, credit, position) VALUES (?,?,?,?,?)', id, l.accountId, l.debit, l.credit, i));
    return id;
  });
}

export function getEntry(db, userId, id) {
  const entry = db.get('SELECT * FROM entries WHERE id = ? AND user_id = ?', v.id(id), userId);
  if (!entry) throw notFound('Transaksi tidak ditemukan.');
  return entry;
}

export function updateEntry(db, userId, id, { date, description, contactId, lines }, allowedKinds) {
  const entry = getEntry(db, userId, id);
  if (!allowedKinds.includes(entry.kind)) throw bad('Transaksi ini tidak bisa diubah dari sini.');
  const d = v.date(date);
  const desc = v.str(description, 'Keterangan', { max: 200 });
  const clean = cleanLines(db, userId, lines);
  const contact = checkContact(db, userId, contactId);
  db.tx(() => {
    db.run('UPDATE entries SET date = ?, description = ?, amount = ?, contact_id = ? WHERE id = ?', d, desc, clean.amount, contact, entry.id);
    db.run('DELETE FROM lines WHERE entry_id = ?', entry.id);
    clean.lines.forEach((l, i) => db.run('INSERT INTO lines (entry_id, account_id, debit, credit, position) VALUES (?,?,?,?,?)', entry.id, l.accountId, l.debit, l.credit, i));
  });
}

export function deleteEntry(db, userId, id) {
  const entry = getEntry(db, userId, id);
  if (entry.kind === 'debt' || entry.kind === 'debt_payment') {
    throw bad('Catatan ini terhubung ke utang/piutang. Hapus lewat menu Utang & Piutang.');
  }
  db.run('DELETE FROM entries WHERE id = ?', entry.id);
}

function attachLines(db, entries) {
  if (!entries.length) return [];
  const ids = entries.map((e) => e.id);
  const rows = db.all(
    `SELECT l.entry_id, l.account_id, l.debit, l.credit, a.code, a.name, a.type, a.subtype
     FROM lines l JOIN accounts a ON a.id = l.account_id
     WHERE l.entry_id IN (${ids.map(() => '?').join(',')})
     ORDER BY l.entry_id, l.position, l.id`,
    ...ids,
  );
  const byEntry = new Map();
  for (const r of rows) {
    if (!byEntry.has(r.entry_id)) byEntry.set(r.entry_id, []);
    byEntry.get(r.entry_id).push({ accountId: r.account_id, code: r.code, name: r.name, type: r.type, subtype: r.subtype, debit: r.debit, credit: r.credit });
  }
  return entries.map((e) => {
    const lines = byEntry.get(e.id) || [];
    const pick = (fn) => { const l = lines.find(fn); return l ? { id: l.accountId, name: l.name } : null; };
    const out = {
      id: e.id, date: e.date, description: e.description, kind: e.kind, amount: e.amount,
      contact: e.contact_id ? { id: e.contact_id, name: e.contact_name } : null,
      lines,
    };
    // Ringkasan untuk tampilan sederhana: kategori & dompet yang dipakai.
    if (e.kind === 'income') { out.cashAccount = pick((l) => l.debit > 0); out.category = pick((l) => l.credit > 0); }
    else if (e.kind === 'expense') { out.category = pick((l) => l.debit > 0); out.cashAccount = pick((l) => l.credit > 0); }
    else if (e.kind === 'transfer') { out.toAccount = pick((l) => l.debit > 0); out.cashAccount = pick((l) => l.credit > 0); }
    else if (e.kind === 'capital_in') { out.cashAccount = pick((l) => l.debit > 0); out.category = pick((l) => l.credit > 0); }
    else if (e.kind === 'drawing') { out.category = pick((l) => l.debit > 0); out.cashAccount = pick((l) => l.credit > 0); }
    return out;
  });
}

export function listEntries(db, userId, { from, to, kinds, accountId, contactId, q, limit = 50, offset = 0, order = 'DESC' } = {}) {
  const cond = ['e.user_id = ?'];
  const params = [userId];
  if (from) { cond.push('e.date >= ?'); params.push(from); }
  if (to) { cond.push('e.date <= ?'); params.push(to); }
  if (kinds?.length) { cond.push(`e.kind IN (${kinds.map(() => '?').join(',')})`); params.push(...kinds); }
  if (accountId) { cond.push('EXISTS (SELECT 1 FROM lines l WHERE l.entry_id = e.id AND l.account_id = ?)'); params.push(accountId); }
  if (contactId) { cond.push('e.contact_id = ?'); params.push(contactId); }
  if (q) { cond.push("e.description LIKE ? ESCAPE '\\'"); params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); }
  const where = cond.join(' AND ');
  const dir = order === 'ASC' ? 'ASC' : 'DESC';
  const total = db.get(`SELECT COUNT(*) AS n FROM entries e WHERE ${where}`, ...params).n;
  const rows = db.all(
    `SELECT e.*, c.name AS contact_name FROM entries e LEFT JOIN contacts c ON c.id = e.contact_id
     WHERE ${where} ORDER BY e.date ${dir}, e.id ${dir} LIMIT ? OFFSET ?`,
    ...params, limit, offset,
  );
  const totals = db.get(
    `SELECT COALESCE(SUM(CASE WHEN e.kind = 'income' THEN e.amount END), 0) AS income,
            COALESCE(SUM(CASE WHEN e.kind = 'expense' THEN e.amount END), 0) AS expense
     FROM entries e WHERE ${where}`,
    ...params,
  );
  return { items: attachLines(db, rows), total, totals };
}

// ─────────────────── Transaksi sederhana → baris jurnal ───────────────────

export const SIMPLE_KINDS = ['income', 'expense', 'transfer', 'capital_in', 'drawing'];
const isCash = (a) => a.type === 'asset' && a.subtype === 'cash';

export function simpleLines(db, userId, t) {
  const kind = v.oneOf(t.kind, SIMPLE_KINDS, 'Jenis transaksi');
  const amount = v.amount(t.amount);
  const cash = usableAccount(db, userId, t.cashAccountId, kind === 'transfer' ? 'Dompet asal' : 'Dompet', isCash);
  const dr = (acc) => ({ accountId: acc.id, debit: amount, credit: 0 });
  const cr = (acc) => ({ accountId: acc.id, debit: 0, credit: amount });
  switch (kind) {
    case 'income': {
      const cat = usableAccount(db, userId, t.categoryId, 'Kategori', (a) => a.type === 'income');
      return [dr(cash), cr(cat)]; // uang masuk ke dompet, asalnya dari pendapatan
    }
    case 'expense': {
      const cat = usableAccount(db, userId, t.categoryId, 'Kategori', (a) => a.type === 'expense');
      return [dr(cat), cr(cash)]; // beban bertambah, uang keluar dari dompet
    }
    case 'transfer': {
      const to = usableAccount(db, userId, t.toAccountId, 'Dompet tujuan', isCash);
      if (to.id === cash.id) throw bad('Dompet asal dan tujuan tidak boleh sama.');
      return [dr(to), cr(cash)];
    }
    case 'capital_in':
      return [dr(cash), cr(roleAccount(db, userId, 'capital'))];
    default: // drawing
      return [dr(roleAccount(db, userId, 'drawing')), cr(cash)];
  }
}

// ───────────────────────── Utang & piutang ─────────────────────────

function debtRows(db, userId, where = '', params = []) {
  return db.all(
    `SELECT d.id, d.kind, d.amount, d.due_date, d.description, d.contact_id, d.entry_id, d.account_id,
            e.date, c.name AS contact_name, a.name AS account_name,
            COALESCE((SELECT SUM(p.amount) FROM debt_payments p WHERE p.debt_id = d.id), 0) AS paid
     FROM debts d
     JOIN entries e ON e.id = d.entry_id
     JOIN accounts a ON a.id = d.account_id
     LEFT JOIN contacts c ON c.id = d.contact_id
     WHERE d.user_id = ? ${where}
     ORDER BY (d.due_date IS NULL), d.due_date, d.id`,
    userId, ...params,
  );
}

function shapeDebt(r, today) {
  const remaining = r.amount - r.paid;
  return {
    id: r.id, kind: r.kind, amount: r.amount, paid: r.paid, remaining,
    date: r.date, dueDate: r.due_date, description: r.description,
    contact: r.contact_id ? { id: r.contact_id, name: r.contact_name } : null,
    account: r.account_name,
    status: remaining <= 0 ? 'paid' : r.due_date && today && r.due_date < today ? 'overdue' : 'open',
  };
}

export function listDebts(db, userId, { today, kind, status } = {}) {
  let items = debtRows(db, userId, kind ? 'AND d.kind = ?' : '', kind ? [kind] : []).map((r) => shapeDebt(r, today));
  if (status === 'open') items = items.filter((d) => d.status !== 'paid');
  else if (status === 'paid') items = items.filter((d) => d.status === 'paid');
  const ids = items.map((d) => d.id);
  const payments = ids.length
    ? db.all(`SELECT id, debt_id, amount, date FROM debt_payments WHERE debt_id IN (${ids.map(() => '?').join(',')}) ORDER BY date, id`, ...ids)
    : [];
  for (const d of items) d.payments = payments.filter((p) => p.debt_id === d.id).map((p) => ({ id: p.id, amount: p.amount, date: p.date }));
  return items;
}

export function debtTotals(db, userId) {
  const out = { payable: 0, receivable: 0 };
  for (const r of debtRows(db, userId)) out[r.kind] += Math.max(r.amount - r.paid, 0);
  return out;
}

export function createDebt(db, userId, body) {
  const kind = v.oneOf(body.kind, ['payable', 'receivable'], 'Jenis');
  const mode = v.oneOf(body.mode, ['cash', 'credit'], 'Cara');
  const amount = v.amount(body.amount);
  const date = v.date(body.date);
  const dueDate = v.date(body.dueDate, 'Jatuh tempo', { optional: true });
  if (dueDate && dueDate < date) throw bad('Jatuh tempo tidak boleh sebelum tanggal transaksi.');
  const description = v.str(body.description, 'Keterangan', { max: 200 });
  const newName = v.str(body.contactName, 'Nama kontak', { max: 80, optional: true });

  const dr = (acc) => ({ accountId: acc.id, debit: amount, credit: 0 });
  const cr = (acc) => ({ accountId: acc.id, debit: 0, credit: amount });
  let account;
  let lines;
  if (kind === 'payable' && mode === 'cash') {
    // Pinjam uang: kas bertambah, utang pinjaman bertambah.
    account = roleAccount(db, userId, 'loan');
    lines = [dr(usableAccount(db, userId, body.cashAccountId, 'Dompet', isCash)), cr(account)];
  } else if (kind === 'payable') {
    // Beli sesuatu tapi belum dibayar: beban bertambah, utang usaha bertambah.
    account = roleAccount(db, userId, 'payable');
    lines = [dr(usableAccount(db, userId, body.categoryId, 'Kategori', (a) => a.type === 'expense' || (a.type === 'asset' && !isCash(a)))), cr(account)];
  } else if (mode === 'cash') {
    // Meminjamkan uang: piutang bertambah, kas berkurang.
    account = roleAccount(db, userId, 'receivable');
    lines = [dr(account), cr(usableAccount(db, userId, body.cashAccountId, 'Dompet', isCash))];
  } else {
    // Menjual tapi belum dibayar: piutang bertambah, pendapatan bertambah.
    account = roleAccount(db, userId, 'receivable');
    lines = [dr(account), cr(usableAccount(db, userId, body.categoryId, 'Kategori', (a) => a.type === 'income'))];
  }

  return db.tx(() => {
    let contactId = checkContact(db, userId, body.contactId);
    if (!contactId && newName) {
      const existing = db.get('SELECT id FROM contacts WHERE user_id = ? AND name = ? COLLATE NOCASE', userId, newName);
      contactId = existing?.id ?? Number(db.run('INSERT INTO contacts (user_id, name, type, created_at) VALUES (?,?,?,?)', userId, newName, kind === 'payable' ? 'supplier' : 'customer', nowIso()).lastInsertRowid);
    }
    const entryId = createEntry(db, userId, { date, description, kind: 'debt', contactId, lines });
    const r = db.run(
      'INSERT INTO debts (user_id, kind, account_id, contact_id, entry_id, amount, due_date, description, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      userId, kind, account.id, contactId, entryId, amount, dueDate, description, nowIso(),
    );
    return Number(r.lastInsertRowid);
  });
}

function getDebt(db, userId, id) {
  const row = debtRows(db, userId, 'AND d.id = ?', [v.id(id)])[0];
  if (!row) throw notFound('Catatan utang/piutang tidak ditemukan.');
  return row;
}

export function payDebt(db, userId, id, body) {
  const debt = getDebt(db, userId, id);
  const amount = v.amount(body.amount);
  const date = v.date(body.date);
  const remaining = debt.amount - debt.paid;
  if (remaining <= 0) throw bad('Catatan ini sudah lunas.');
  if (amount > remaining) throw bad(`Jumlah melebihi sisa (${remaining.toLocaleString('id-ID')}).`);
  if (date < debt.date) throw bad('Tanggal pembayaran tidak boleh sebelum tanggal utang/piutang dicatat.');
  const cash = usableAccount(db, userId, body.cashAccountId, 'Dompet', isCash);
  const lines = debt.kind === 'payable'
    ? [{ accountId: debt.account_id, debit: amount, credit: 0 }, { accountId: cash.id, debit: 0, credit: amount }]
    : [{ accountId: cash.id, debit: amount, credit: 0 }, { accountId: debt.account_id, debit: 0, credit: amount }];
  const label = debt.kind === 'payable' ? 'Bayar utang' : 'Terima piutang';
  return db.tx(() => {
    const entryId = createEntry(db, userId, { date, description: `${label}: ${debt.description}`.slice(0, 200), kind: 'debt_payment', contactId: debt.contact_id, lines });
    const r = db.run('INSERT INTO debt_payments (debt_id, entry_id, amount, date) VALUES (?,?,?,?)', debt.id, entryId, amount, date);
    return Number(r.lastInsertRowid);
  });
}

export function deleteDebt(db, userId, id) {
  const debt = getDebt(db, userId, id);
  db.tx(() => {
    const payments = db.all('SELECT entry_id FROM debt_payments WHERE debt_id = ?', debt.id);
    for (const p of payments) db.run('DELETE FROM entries WHERE id = ?', p.entry_id);
    db.run('DELETE FROM entries WHERE id = ?', debt.entry_id); // ikut menghapus catatan utangnya
  });
}

export function deleteDebtPayment(db, userId, debtId, paymentId) {
  const debt = getDebt(db, userId, debtId);
  const pay = db.get('SELECT * FROM debt_payments WHERE id = ? AND debt_id = ?', v.id(paymentId), debt.id);
  if (!pay) throw notFound('Pembayaran tidak ditemukan.');
  db.run('DELETE FROM entries WHERE id = ?', pay.entry_id);
}

// ───────────────────────────── Anggaran ─────────────────────────────

export function budgetStatus(db, userId, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw bad('Bulan tidak valid.');
  const rows = db.all(
    `SELECT a.id, a.code, a.name, COALESCE(b.amount, 0) AS budget, COALESCE(s.spent, 0) AS spent
     FROM accounts a
     LEFT JOIN budgets b ON b.account_id = a.id AND b.user_id = a.user_id
     LEFT JOIN (
       SELECT l.account_id, SUM(l.debit - l.credit) AS spent
       FROM lines l JOIN entries e ON e.id = l.entry_id
       WHERE e.user_id = ? AND e.date >= ? AND e.date <= ?
       GROUP BY l.account_id
     ) s ON s.account_id = a.id
     WHERE a.user_id = ? AND a.type = 'expense' AND (a.archived = 0 OR b.amount IS NOT NULL)
     ORDER BY a.code`,
    userId, `${month}-01`, `${month}-31`, userId,
  );
  const items = rows.map((r) => ({ accountId: r.id, code: r.code, name: r.name, budget: r.budget, spent: r.spent }));
  const withBudget = items.filter((i) => i.budget > 0);
  return {
    month,
    items,
    totalBudget: withBudget.reduce((s, i) => s + i.budget, 0),
    totalSpent: withBudget.reduce((s, i) => s + i.spent, 0),
  };
}

export function setBudget(db, userId, accountId, amount) {
  const acc = getAccount(db, userId, accountId, 'Kategori');
  if (acc.type !== 'expense') throw bad('Anggaran hanya bisa dipasang pada kategori pengeluaran.');
  const value = v.amount(amount, 'Anggaran', { allowZero: true });
  if (value === 0) db.run('DELETE FROM budgets WHERE user_id = ? AND account_id = ?', userId, acc.id);
  else db.run('INSERT INTO budgets (user_id, account_id, amount) VALUES (?,?,?) ON CONFLICT(user_id, account_id) DO UPDATE SET amount = excluded.amount', userId, acc.id, value);
}

// ───────────────────────────── Laporan ─────────────────────────────

export function journalReport(db, userId, { from, to }) {
  const res = listEntries(db, userId, { from, to, limit: 2000, order: 'ASC' });
  const total = res.items.reduce((s, e) => s + e.amount, 0);
  return { from, to, entries: res.items, totalDebit: total, totalCredit: total, truncated: res.total > res.items.length };
}

export function ledgerReport(db, userId, { from, to, accountId }) {
  const accounts = db.all(`SELECT * FROM accounts WHERE user_id = ? ${accountId ? 'AND id = ?' : ''} ORDER BY code`, ...(accountId ? [userId, accountId] : [userId]));
  if (accountId && !accounts.length) throw notFound('Akun tidak ditemukan.');
  const opening = new Map(sums(db, userId, { before: from }).map((r) => [r.id, r]));
  const out = [];
  for (const acc of accounts) {
    const rows = db.all(
      `SELECT e.id AS entry_id, e.date, e.description, l.debit, l.credit
       FROM lines l JOIN entries e ON e.id = l.entry_id
       WHERE l.account_id = ? AND e.date >= ? AND e.date <= ?
       ORDER BY e.date, e.id, l.position`,
      acc.id, from, to,
    );
    const o = opening.get(acc.id);
    const openingBalance = o ? balanceOf(acc, o.d, o.c) : 0;
    if (!accountId && !rows.length && openingBalance === 0) continue;
    let balance = openingBalance;
    let totalDebit = 0;
    let totalCredit = 0;
    const lines = rows.map((r) => {
      balance += debitNormal(acc) ? r.debit - r.credit : r.credit - r.debit;
      totalDebit += r.debit;
      totalCredit += r.credit;
      return { entryId: r.entry_id, date: r.date, description: r.description, debit: r.debit, credit: r.credit, balance };
    });
    out.push({ id: acc.id, code: acc.code, name: acc.name, type: acc.type, normal: debitNormal(acc) ? 'debit' : 'credit', openingBalance, lines, totalDebit, totalCredit, closingBalance: balance });
  }
  return { from, to, accounts: out };
}

export function trialBalance(db, userId, { to }) {
  const rows = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const r of sums(db, userId, { to })) {
    const net = r.d - r.c;
    if (net === 0 && r.d === 0) continue;
    const debit = net > 0 ? net : 0;
    const credit = net < 0 ? -net : 0;
    totalDebit += debit;
    totalCredit += credit;
    rows.push({ id: r.id, code: r.code, name: r.name, type: r.type, debit, credit });
  }
  return { to, rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

const IS_SECTIONS = [
  ['revenue', 'Pendapatan', 'income'],
  ['cogs', 'Harga Pokok Penjualan', 'expense'],
  ['operating', 'Beban', 'expense'],
  ['other_income', 'Pendapatan Lain-lain', 'income'],
  ['other_expense', 'Beban Lain-lain', 'expense'],
];

export function incomeStatement(db, userId, { from, to }) {
  const rows = sums(db, userId, { from, to });
  const sections = IS_SECTIONS.map(([key, label, type]) => {
    const items = rows
      .filter((r) => r.type === type && r.subtype === key)
      .map((r) => ({ id: r.id, code: r.code, name: r.name, amount: type === 'income' ? r.c - r.d : r.d - r.c }))
      .filter((i) => i.amount !== 0);
    return { key, label, type, items, total: items.reduce((s, i) => s + i.amount, 0) };
  });
  const total = (key) => sections.find((s) => s.key === key).total;
  const totalIncome = total('revenue') + total('other_income');
  const totalExpense = total('cogs') + total('operating') + total('other_expense');
  return {
    from, to, sections, totalIncome, totalExpense,
    grossProfit: total('revenue') - total('cogs'),
    operatingProfit: total('revenue') - total('cogs') - total('operating'),
    net: totalIncome - totalExpense,
  };
}

export function balanceSheet(db, userId, { to }) {
  const rows = sums(db, userId, { to });
  const yearStart = `${to.slice(0, 4)}-01-01`;
  const earlier = netIncome(sums(db, userId, { before: yearStart }));
  const current = netIncome(sums(db, userId, { from: yearStart, to }));
  const item = (r, amount) => ({ id: r.id, code: r.code, name: r.name, amount });
  const nz = (list) => list.filter((i) => i.amount !== 0);
  const sum = (list) => list.reduce((s, i) => s + i.amount, 0);

  const currentAssets = nz(rows.filter((r) => r.type === 'asset' && r.subtype !== 'fixed').map((r) => item(r, r.d - r.c)));
  const fixedAssets = nz(rows.filter((r) => r.type === 'asset' && r.subtype === 'fixed').map((r) => item(r, r.d - r.c)));
  const liabilities = nz(rows.filter((r) => r.type === 'liability').map((r) => item(r, r.c - r.d)));
  const equity = nz(rows.filter((r) => r.type === 'equity').map((r) => item(r, r.c - r.d)));
  if (earlier !== 0) equity.push({ id: null, code: '', name: 'Saldo laba tahun-tahun sebelumnya', amount: earlier });
  equity.push({ id: null, code: '', name: 'Laba (rugi) tahun berjalan', amount: current });

  const totalAssets = sum(currentAssets) + sum(fixedAssets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = sum(equity);
  return {
    to,
    assets: { current: currentAssets, fixed: fixedAssets, totalCurrent: sum(currentAssets), totalFixed: sum(fixedAssets), total: totalAssets },
    liabilities: { items: liabilities, total: totalLiabilities },
    equity: { items: equity, total: totalEquity },
    totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
    balanced: totalAssets === totalLiabilities + totalEquity,
  };
}

export function equityStatement(db, userId, { from, to }) {
  const equityOf = (rows) => rows.filter((r) => r.type === 'equity').reduce((s, r) => s + (r.c - r.d), 0) + netIncome(rows);
  const period = sums(db, userId, { from, to });
  const opening = equityOf(sums(db, userId, { before: from }));
  const contributions = period.filter((r) => r.type === 'equity' && r.subtype !== 'drawing').reduce((s, r) => s + (r.c - r.d), 0);
  const drawings = period.filter((r) => r.type === 'equity' && r.subtype === 'drawing').reduce((s, r) => s + (r.d - r.c), 0);
  const net = netIncome(period);
  return { from, to, opening, contributions, net, drawings, closing: opening + contributions + net - drawings };
}

const FLOW_SECTIONS = [
  ['operating', 'Aktivitas operasi (kegiatan sehari-hari)'],
  ['investing', 'Aktivitas investasi (beli/jual aset tetap)'],
  ['financing', 'Aktivitas pendanaan (modal & pinjaman)'],
];

function flowSection(a) {
  if (a.type === 'income' || a.type === 'expense') return 'operating';
  if (a.type === 'asset') return a.subtype === 'fixed' ? 'investing' : 'operating';
  if (a.type === 'liability') return a.subtype === 'loan' ? 'financing' : 'operating';
  return 'financing';
}

export function cashFlow(db, userId, { from, to }) {
  const cashBalance = (rows) => rows.filter(isCash).reduce((s, r) => s + (r.d - r.c), 0);
  const opening = cashBalance(sums(db, userId, { before: from }));
  const closing = cashBalance(sums(db, userId, { to }));
  // Untuk tiap jurnal yang menyentuh kas, sisi "lawannya" menjelaskan
  // uang itu datang dari mana / dipakai untuk apa.
  const rows = db.all(
    `SELECT a.id, a.code, a.name, a.type, a.subtype, SUM(l.credit - l.debit) AS flow
     FROM lines l
     JOIN entries e ON e.id = l.entry_id
     JOIN accounts a ON a.id = l.account_id
     WHERE e.user_id = ? AND e.date >= ? AND e.date <= ?
       AND NOT (a.type = 'asset' AND a.subtype = 'cash')
       AND EXISTS (
         SELECT 1 FROM lines l2 JOIN accounts a2 ON a2.id = l2.account_id
         WHERE l2.entry_id = e.id AND a2.type = 'asset' AND a2.subtype = 'cash'
       )
     GROUP BY a.id ORDER BY a.code`,
    userId, from, to,
  );
  // Urutan baris: pendapatan dulu, lalu beban, baru piutang/utang — lebih enak dibaca.
  const rank = { income: 0, expense: 1, asset: 2, liability: 3, equity: 4 };
  rows.sort((a, b) => rank[a.type] - rank[b.type] || a.code.localeCompare(b.code));
  const sections = FLOW_SECTIONS.map(([key, label]) => {
    const items = rows.filter((r) => flowSection(r) === key && r.flow !== 0).map((r) => ({ id: r.id, code: r.code, name: r.name, amount: r.flow }));
    return { key, label, items, total: items.reduce((s, i) => s + i.amount, 0) };
  });
  const netChange = sections.reduce((s, sec) => s + sec.total, 0);
  return { from, to, opening, sections, netChange, closing, consistent: opening + netChange === closing };
}

export function debtReport(db, userId, { today }) {
  const debts = listDebts(db, userId, { today, status: 'open' });
  const group = (kind) => {
    const items = debts.filter((d) => d.kind === kind);
    return { items, total: items.reduce((s, d) => s + d.remaining, 0), overdue: items.filter((d) => d.status === 'overdue').reduce((s, d) => s + d.remaining, 0) };
  };
  return { today, payable: group('payable'), receivable: group('receivable') };
}

// ───────────────────────────── Dasbor ─────────────────────────────

function periodTotals(rows) {
  let income = 0;
  let expense = 0;
  for (const r of rows) {
    if (r.type === 'income') income += r.c - r.d;
    else if (r.type === 'expense') expense += r.d - r.c;
  }
  return { income, expense, net: income - expense };
}

const monthAdd = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const dayAdd = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function dashboard(db, userId, { from, to, pfrom, pto, today }) {
  const periodRows = sums(db, userId, { from, to });
  const period = periodTotals(periodRows);
  const previous = pfrom && pto ? periodTotals(sums(db, userId, { from: pfrom, to: pto })) : null;

  const asOf = sums(db, userId, { to });
  const wallets = asOf.filter((r) => isCash(r) && (!r.archived || r.d - r.c !== 0)).map((r) => ({ id: r.id, name: r.name, balance: r.d - r.c }));
  const cashBalance = wallets.reduce((s, w) => s + w.balance, 0);

  // Pemasukan vs pengeluaran 6 bulan terakhir (berakhir di bulan "to").
  const endMonth = to.slice(0, 7);
  const months = Array.from({ length: 6 }, (_, i) => monthAdd(endMonth, i - 5));
  const monthlyRows = db.all(
    `SELECT substr(e.date, 1, 7) AS ym, a.type, SUM(l.debit) AS d, SUM(l.credit) AS c
     FROM lines l JOIN entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
     WHERE e.user_id = ? AND e.date >= ? AND e.date <= ? AND a.type IN ('income', 'expense')
     GROUP BY ym, a.type`,
    userId, `${months[0]}-01`, `${endMonth}-31`,
  );
  const monthly = months.map((ym) => {
    const inc = monthlyRows.find((r) => r.ym === ym && r.type === 'income');
    const exp = monthlyRows.find((r) => r.ym === ym && r.type === 'expense');
    return { month: ym, income: inc ? inc.c - inc.d : 0, expense: exp ? exp.d - exp.c : 0 };
  });

  const byCategory = (type) => periodRows
    .filter((r) => r.type === type)
    .map((r) => ({ id: r.id, name: r.name, amount: type === 'income' ? r.c - r.d : r.d - r.c }))
    .filter((i) => i.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  // Tren saldo kas harian pada periode terpilih (dirapatkan kalau terlalu panjang).
  const first = db.get('SELECT MIN(date) AS d FROM entries WHERE user_id = ?', userId).d;
  let start = from;
  if (first && start < first) start = first;
  const end = today && to > today ? today : to;
  const cashTrend = [];
  if (first && start <= end) {
    const before = sums(db, userId, { before: start }).filter(isCash).reduce((s, r) => s + (r.d - r.c), 0);
    const deltas = new Map(db.all(
      `SELECT e.date, SUM(l.debit - l.credit) AS delta
       FROM lines l JOIN entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
       WHERE e.user_id = ? AND e.date >= ? AND e.date <= ? AND a.type = 'asset' AND a.subtype = 'cash'
       GROUP BY e.date`,
      userId, start, end,
    ).map((r) => [r.date, r.delta]));
    const days = dayDiff(start, end) + 1;
    const step = Math.max(1, Math.ceil(days / 62));
    let balance = before;
    for (let i = 0; i < days; i += 1) {
      const date = dayAdd(start, i);
      balance += deltas.get(date) || 0;
      if ((days - 1 - i) % step === 0) cashTrend.push({ date, balance });
    }
  }

  const recent = listEntries(db, userId, { from, to, limit: 6 }).items.map(({ lines, ...rest }) => rest);
  const openDebts = listDebts(db, userId, { today, status: 'open' });
  const debtSum = (kind) => openDebts.filter((d) => d.kind === kind).reduce((s, d) => s + d.remaining, 0);

  return {
    from, to,
    kpis: { cashBalance, ...period },
    previous,
    wallets,
    monthly,
    expenseByCategory: byCategory('expense'),
    incomeByCategory: byCategory('income'),
    budget: budgetStatus(db, userId, endMonth),
    cashTrend,
    recent,
    debts: {
      payable: debtSum('payable'),
      receivable: debtSum('receivable'),
      upcoming: openDebts.slice(0, 5).map(({ payments, ...rest }) => rest),
    },
    hasData: Boolean(first),
  };
}

export { TYPE_ORDER };
