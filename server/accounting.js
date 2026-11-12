// Inti pembukuan. Aplikasi ini memakai "pembukuan berpasangan" (double entry):
// setiap transaksi dicatat di dua sisi (debit & kredit) yang jumlahnya selalu sama.
// Ibarat timbangan: kalau kas bertambah, harus jelas dari mana asalnya.
// Pengguna tidak perlu paham ini — form sederhana (pemasukan/pengeluaran)
// otomatis diubah menjadi jurnal oleh fungsi-fungsi di file ini.
import { HttpError, bad, notFound, v } from './http.js';
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

export async function seedAccounts(db, userId, usage) {
  const rows = [...BASE_ACCOUNTS, ...(TEMPLATES[usage] || TEMPLATES.pribadi)];
  const now = nowIso();
  for (const [code, name, type, subtype, role] of rows) {
    await db.run(
      'INSERT INTO accounts (user_id, code, name, type, subtype, role, created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',
      userId, code, name, type, subtype, role, now,
    );
  }
}

export async function roleAccount(db, userId, role) {
  const acc = await db.get('SELECT * FROM accounts WHERE user_id = ? AND role = ?', userId, role);
  if (!acc) throw bad('Akun bawaan belum tersedia. Selesaikan pengaturan awal dulu.', 'ONBOARDING_REQUIRED');
  return acc;
}

// Akun "Utang Pajak (PPN)" dibuat saat faktur pertama yang memakai pajak (tidak semua pengguna butuh).
export async function ensureTaxAccount(db, userId) {
  const existing = await db.get("SELECT * FROM accounts WHERE user_id = ? AND role = 'tax_payable'", userId);
  if (existing) return existing;
  const taken = await db.get('SELECT 1 AS x FROM accounts WHERE user_id = ? AND code = ?', userId, '2301');
  const code = taken ? await nextCode(db, userId, 'liability') : '2301';
  const id = await db.insert(
    'INSERT INTO accounts (user_id, code, name, type, subtype, role, created_at) VALUES (?,?,?,?,?,?,?)',
    userId, code, 'Utang Pajak (PPN)', 'liability', 'other', 'tax_payable', nowIso(),
  );
  return db.get('SELECT * FROM accounts WHERE id = ?', id);
}

export async function getAccount(db, userId, id, label = 'Akun') {
  const acc = await db.get('SELECT * FROM accounts WHERE id = ? AND user_id = ?', v.id(id, label), userId);
  if (!acc) throw bad(`${label} tidak ditemukan.`);
  return acc;
}

async function usableAccount(db, userId, id, label, check) {
  const acc = await getAccount(db, userId, id, label);
  if (acc.archived) throw bad(`${label} "${acc.name}" sudah diarsipkan.`);
  if (check && !check(acc)) throw bad(`${label} yang dipilih tidak sesuai.`);
  return acc;
}

// Jumlah debit & kredit tiap akun pada rentang tanggal tertentu.
// opts: { from, to, before } — "before" berarti sebelum tanggal itu (tidak termasuk).
export async function sums(db, userId, opts = {}) {
  const cond = ['e.user_id = ?'];
  const params = [userId];
  if (opts.from) { cond.push('e.date >= ?'); params.push(opts.from); }
  if (opts.to) { cond.push('e.date <= ?'); params.push(opts.to); }
  if (opts.before) { cond.push('e.date < ?'); params.push(opts.before); }
  return await db.all(
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

export async function listAccounts(db, userId) {
  const used = new Set((await db.all('SELECT DISTINCT l.account_id AS id FROM lines l JOIN accounts a ON a.id = l.account_id WHERE a.user_id = ?', userId)).map((r) => r.id));
  return (await sums(db, userId)).map((r) => ({
    id: r.id, code: r.code, name: r.name, type: r.type, subtype: r.subtype,
    system: Boolean(r.role), archived: Boolean(r.archived), used: used.has(r.id),
    balance: balanceOf(r, r.d, r.c),
  }));
}

async function nextCode(db, userId, type) {
  const prefix = CODE_PREFIX[type];
  const row = await db.get("SELECT MAX(CASE WHEN code ~ '^[0-9]{4}$' THEN CAST(code AS INTEGER) END) AS m FROM accounts WHERE user_id = ? AND code LIKE ?", userId, `${prefix}%`);
  const base = Number(`${prefix}900`);
  return String(Math.max(Number(row?.m) || 0, base) + 1);
}

export async function createAccount(db, userId, body) {
  const name = v.str(body.name, 'Nama akun', { max: 80 });
  const type = v.oneOf(body.type, TYPES, 'Tipe akun');
  const subtype = body.subtype ? v.oneOf(body.subtype, SUBTYPES[type], 'Jenis akun') : SUBTYPES[type][type === 'expense' ? 1 : 0];
  let code = v.str(body.code, 'Kode akun', { max: 12, optional: true });
  if (code && !/^[0-9A-Za-z.-]+$/.test(code)) throw bad('Kode akun hanya boleh huruf, angka, titik, atau strip.');
  code ||= await nextCode(db, userId, type);
  if (await db.get('SELECT 1 AS x FROM accounts WHERE user_id = ? AND code = ?', userId, code)) throw bad(`Kode akun ${code} sudah dipakai.`);
  if (await db.get('SELECT 1 AS x FROM accounts WHERE user_id = ? AND lower(name) = lower(?) AND type = ?', userId, name, type)) throw bad(`Akun bernama "${name}" sudah ada.`);
  return db.insert('INSERT INTO accounts (user_id, code, name, type, subtype, created_at) VALUES (?,?,?,?,?,?)', userId, code, name, type, subtype, nowIso());
}

export async function updateAccount(db, userId, id, body) {
  const acc = await getAccount(db, userId, id);
  const name = body.name !== undefined ? v.str(body.name, 'Nama akun', { max: 80 }) : acc.name;
  let code = body.code !== undefined ? v.str(body.code, 'Kode akun', { max: 12 }) : acc.code;
  if (!/^[0-9A-Za-z.-]+$/.test(code)) throw bad('Kode akun hanya boleh huruf, angka, titik, atau strip.');
  if (code !== acc.code && await db.get('SELECT 1 AS x FROM accounts WHERE user_id = ? AND code = ? AND id != ?', userId, code, acc.id)) throw bad(`Kode akun ${code} sudah dipakai.`);
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
  await db.run('UPDATE accounts SET name = ?, code = ?, subtype = ?, archived = ? WHERE id = ?', name, code, subtype, archived, acc.id);
}

export async function deleteAccount(db, userId, id) {
  const acc = await getAccount(db, userId, id);
  if (acc.role) throw bad('Akun bawaan tidak bisa dihapus.');
  if (await db.get('SELECT 1 AS x FROM lines WHERE account_id = ? LIMIT 1', acc.id)) {
    throw bad('Akun ini sudah dipakai di transaksi, jadi tidak bisa dihapus. Kamu bisa mengarsipkannya.');
  }
  await db.run('DELETE FROM accounts WHERE id = ?', acc.id);
}

// ───────────────────────────── Jurnal ─────────────────────────────

async function cleanLines(db, userId, lines) {
  if (!Array.isArray(lines) || lines.length < 2) throw bad('Jurnal butuh minimal dua baris.');
  if (lines.length > 40) throw bad('Jurnal maksimal 40 baris.');
  let totalDebit = 0;
  let totalCredit = 0;
  const out = [];
  for (const line of lines) {
    const acc = await usableAccount(db, userId, line?.accountId, 'Akun');
    const debit = v.amount(line.debit ?? 0, 'Debit', { allowZero: true });
    const credit = v.amount(line.credit ?? 0, 'Kredit', { allowZero: true });
    if ((debit > 0) === (credit > 0)) throw bad('Setiap baris diisi salah satu saja: debit atau kredit.');
    totalDebit += debit;
    totalCredit += credit;
    out.push({ accountId: acc.id, debit, credit, cash: isCash(acc), name: acc.name });
  }
  if (totalDebit !== totalCredit) throw bad('Total debit dan kredit harus sama (seimbang).');
  return { lines: out, amount: totalDebit };
}

async function checkContact(db, userId, contactId) {
  if (contactId === undefined || contactId === null || contactId === '') return null;
  const row = await db.get('SELECT id FROM contacts WHERE id = ? AND user_id = ?', v.id(contactId, 'Kontak'), userId);
  if (!row) throw bad('Kontak tidak ditemukan.');
  return row.id;
}

// ───────────── Saldo dompet tidak boleh minus ─────────────
// Setiap perubahan yang MENGURANGI uang di sebuah dompet (kas, bank, dompet digital) ditolak kalau
// membuat saldo dompet itu minus pada tanggal mana pun, termasuk transaksi bertanggal mundur yang
// membuat saldo hari-hari sesudahnya minus. Yang dihitung hanya efek dari perubahan itu: saldo yang
// SUDAH minus dari data lama tetap bisa diperbaiki (ditambah), hanya tidak boleh makin dalam.
// Aturan ini berlaku untuk semua jalur: transaksi, transfer, prive, utang/piutang, jurnal manual,
// faktur, impor, dan juga ubah/hapus catatan lama.

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const idr = (n) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const idDate = (d) => {
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${SHORT_MONTHS[m - 1]} ${y}`;
};

// deltas: Map<idDompet, { name, days: Map<tanggal, perubahan> }>; angka positif = uang masuk.
export function addCash(deltas, line, date, sign = 1) {
  if (!line.cash) return;
  const change = sign * (line.debit - line.credit);
  if (!change) return;
  const wallet = deltas.get(line.accountId) ?? { name: line.name, days: new Map() };
  wallet.days.set(date, (wallet.days.get(date) ?? 0) + change);
  deltas.set(line.accountId, wallet);
}

const OLD_LINES = `SELECT l.account_id AS "accountId", l.debit, l.credit, a.name, (a.type = 'asset' AND a.subtype = 'cash') AS cash
  FROM lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ?`;

/**
 * Mencari tanggal pertama saat saldo dompet jadi (lebih) minus karena sebuah perubahan.
 * rows  = saldo bersih per tanggal yang ada di database (urut tanggal)
 * days  = perubahan dari transaksi ini per tanggal
 * applied = true kalau rows SUDAH memuat perubahan itu (setelah ditulis), false kalau belum (pratinjau)
 */
export function firstOverdraft(rows, days, applied) {
  const changes = [...days.entries()].filter(([, c]) => c).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (!changes.length) return null;
  const dates = [...new Set([...rows.map((r) => r.date), ...changes.map(([d]) => d)])].sort();
  let ri = 0;
  let ci = 0;
  let balance = 0;
  let cum = 0;
  for (const date of dates) {
    while (ri < rows.length && rows[ri].date <= date) balance += rows[ri++].net;
    while (ci < changes.length && changes[ci][0] <= date) cum += changes[ci++][1];
    const after = applied ? balance : balance + cum;
    if (cum < 0 && after < 0) return { date, shortage: -after, before: after - cum };
  }
  return null;
}

// Hanya dompet yang pernah berkurang (secara kumulatif) yang perlu diperiksa.
function walletsAtRisk(deltas) {
  return [...deltas.entries()]
    .filter(([, w]) => {
      let cum = 0;
      for (const [, change] of [...w.days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        cum += change;
        if (cum < 0) return true;
      }
      return false;
    })
    .sort((a, b) => a[0] - b[0]);
}

const dailyNet = (db, userId, walletId) => db.all(
  'SELECT e.date, SUM(l.debit - l.credit) AS net FROM lines l JOIN entries e ON e.id = l.entry_id WHERE l.account_id = ? AND e.user_id = ? GROUP BY e.date ORDER BY e.date',
  walletId, userId,
);

function overdraftError(name, hit, op) {
  const have = Math.max(hit.before, 0);
  const when = idDate(hit.date);
  let message;
  if (op === 'delete') message = `Catatan ini tidak bisa dihapus karena uang darinya sudah terpakai: saldo ${name} pada ${when} akan minus ${idr(hit.shortage)}.`;
  else if (op === 'import') message = `Impor ini membuat saldo ${name} minus pada ${when} (kurang ${idr(hit.shortage)}). Catat saldo awal atau pemasukan lebih dulu, atau keluarkan baris pengeluarannya dari file.`;
  else message = `Saldo ${name} tidak cukup. Pada ${when} saldonya hanya ${idr(have)}, sedangkan ${op === 'update' ? 'perubahan' : 'transaksi'} ini membuatnya kurang ${idr(hit.shortage)}. Kalau uangnya memang sudah ada, catat dulu pemasukan atau setor modal bertanggal sebelum itu, atau ubah tanggal/jumlah saldo awal di Jurnal Umum.`;
  return new HttpError(400, message, 'INSUFFICIENT_FUNDS', { wallet: name, date: hit.date, shortage: hit.shortage, available: have });
}

// Dipanggil SETELAH perubahan ditulis, di dalam transaksi database: kalau melanggar, melempar error
// dan seluruh perubahan dibatalkan. Dompetnya dikunci dulu (urut id supaya tidak saling menunggu),
// jadi dua catatan yang masuk bersamaan tidak bisa sama-sama lolos.
export async function assertNoOverdraft(db, userId, deltas, op) {
  const risky = walletsAtRisk(deltas);
  if (!risky.length) return;
  const ids = risky.map(([id]) => id);
  await db.all(`SELECT id FROM accounts WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`, userId, ...ids);
  for (const [id, wallet] of risky) {
    const hit = firstOverdraft(await dailyNet(db, userId, id), wallet.days, true);
    if (hit) throw overdraftError(wallet.name, hit, op);
  }
}

// Versi pratinjau (belum ditulis, tanpa mengunci): mengembalikan pelanggaran pertama atau null.
export async function previewOverdraft(db, userId, deltas) {
  for (const [id, wallet] of walletsAtRisk(deltas)) {
    const hit = firstOverdraft(await dailyNet(db, userId, id), wallet.days, false);
    if (hit) return { wallet: wallet.name, date: hit.date, shortage: hit.shortage, available: Math.max(hit.before, 0) };
  }
  return null;
}

// Menghapus catatan beserta barisnya, lalu memastikan saldo dompet tidak jadi minus.
// Beberapa catatan sekaligus diperiksa SEKALI di akhir (urutan menghapus tidak boleh menentukan hasil).
// Harus dipanggil di dalam transaksi database.
async function deleteEntries(db, userId, entryIds) {
  await lockBook(db, userId);
  const found = [];
  for (const id of entryIds) {
    const entry = await db.get('SELECT id, date FROM entries WHERE id = ? AND user_id = ?', id, userId);
    if (entry) found.push({ ...entry, lines: await db.all(OLD_LINES, id) });
  }
  await lockWallets(db, userId, found.flatMap((e) => e.lines.filter((l) => l.cash).map((l) => l.accountId)));
  const deltas = new Map();
  for (const entry of found) {
    for (const line of entry.lines) addCash(deltas, line, entry.date, -1);
    await db.run('DELETE FROM entries WHERE id = ?', entry.id);
  }
  await assertNoOverdraft(db, userId, deltas, 'delete');
}

// ── Urutan kunci database ──
// Semua jalur yang menulis catatan mengunci dalam urutan YANG SAMA: (1) pembukuan, (2) dompet yang berkurang,
// (3) utang. Urutan seragam mencegah dua permintaan saling menunggu (deadlock).
// Dompet harus dikunci SEBELUM menulis baris yang merujuk ke dompet itu: menulis baris saja sudah menahan
// kunci bersama (FOR KEY SHARE) pada dompet, dan dua transaksi yang sama-sama memegangnya lalu meminta
// FOR UPDATE akan saling menunggu selamanya.
// Jurnal manual memakai kunci penuh pembukuan karena menyinkronkan utang; yang lain cukup kunci bersama.
export const lockBook = (db, userId, exclusive = false) => db.get(`SELECT id FROM users WHERE id = ? FOR ${exclusive ? 'UPDATE' : 'KEY SHARE'}`, userId);

export async function lockWallets(db, userId, ids) {
  const list = [...new Set(ids)].sort((a, b) => a - b);
  if (list.length) await db.all(`SELECT id FROM accounts WHERE user_id = ? AND id IN (${list.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`, userId, ...list);
}

// createdBy = id orang yang mencatat (bukan pemilik pembukuan, kalau pembukuannya dibagi).
// dueDate dipakai kalau jurnal manual ini mencatat utang/piutang.
export async function createEntry(db, userId, { date, description, kind, contactId, lines, dueDate, createdBy }) {
  const d = v.date(date);
  const desc = v.str(description, 'Keterangan', { max: 200 });
  const clean = await cleanLines(db, userId, lines);
  const contact = await checkContact(db, userId, contactId);
  return db.tx(async () => {
    await lockBook(db, userId, JOURNAL_KINDS.includes(kind));
    // Semua dompet yang disentuh dikunci (bukan hanya yang berkurang): menulis baris ke dompet yang sedang dikunci
    // transaksi lain ikut menunggu, jadi transfer berlawanan arah (Kas→Bank dan Bank→Kas) bisa saling mengunci.
    await lockWallets(db, userId, clean.lines.filter((l) => l.cash).map((l) => l.accountId));
    const id = await db.insert(
      'INSERT INTO entries (user_id, date, description, kind, amount, contact_id, created_at, created_by) VALUES (?,?,?,?,?,?,?,?)',
      userId, d, desc, kind, clean.amount, contact, nowIso(), createdBy ?? null,
    );
    for (const [i, l] of clean.lines.entries()) await db.run('INSERT INTO lines (entry_id, account_id, debit, credit, position) VALUES (?,?,?,?,?)', id, l.accountId, l.debit, l.credit, i);
    const deltas = new Map();
    for (const l of clean.lines) addCash(deltas, l, d);
    await assertNoOverdraft(db, userId, deltas, 'create');
    if (JOURNAL_KINDS.includes(kind)) await syncJournalDebts(db, userId, id, { dueDate });
    return id;
  });
}

export async function getEntry(db, userId, id) {
  const entry = await db.get('SELECT * FROM entries WHERE id = ? AND user_id = ?', v.id(id), userId);
  if (!entry) throw notFound('Transaksi tidak ditemukan.');
  return entry;
}

export async function updateEntry(db, userId, id, { date, description, contactId, lines, dueDate }, allowedKinds) {
  const entry = await getEntry(db, userId, id);
  if (!allowedKinds.includes(entry.kind)) throw bad('Transaksi ini tidak bisa diubah dari sini.');
  const d = v.date(date);
  const desc = v.str(description, 'Keterangan', { max: 200 });
  const clean = await cleanLines(db, userId, lines);
  const contact = await checkContact(db, userId, contactId);
  await db.tx(async () => {
    await lockBook(db, userId, JOURNAL_KINDS.includes(entry.kind));
    const oldLines = await db.all(OLD_LINES, entry.id);
    await lockWallets(db, userId, [...oldLines, ...clean.lines].filter((l) => l.cash).map((l) => l.accountId));
    await db.run('UPDATE entries SET date = ?, description = ?, amount = ?, contact_id = ? WHERE id = ?', d, desc, clean.amount, contact, entry.id);
    await db.run('DELETE FROM lines WHERE entry_id = ?', entry.id);
    for (const [i, l] of clean.lines.entries()) await db.run('INSERT INTO lines (entry_id, account_id, debit, credit, position) VALUES (?,?,?,?,?)', entry.id, l.accountId, l.debit, l.credit, i);
    const deltas = new Map();
    for (const l of oldLines) addCash(deltas, l, entry.date, -1);
    for (const l of clean.lines) addCash(deltas, l, d);
    await assertNoOverdraft(db, userId, deltas, 'update');
    if (JOURNAL_KINDS.includes(entry.kind)) await syncJournalDebts(db, userId, entry.id, { dueDate });
  });
}

export async function deleteEntry(db, userId, id) {
  const entry = await getEntry(db, userId, id);
  if (entry.kind === 'debt' || entry.kind === 'debt_payment') {
    throw bad('Catatan ini terhubung ke utang/piutang. Hapus lewat menu Utang & Piutang.');
  }
  if (JOURNAL_KINDS.includes(entry.kind)) {
    await db.tx(async () => {
      await lockBook(db, userId, true);
      const accounts = await journalDebtAccounts(db, entry.id);
      const paid = await db.get('SELECT COUNT(*) AS n FROM debts d JOIN debt_payments p ON p.debt_id = d.id WHERE d.entry_id = ?', entry.id);
      if (paid.n > 0) throw bad('Jurnal ini mencatat utang/piutang yang sudah ada pembayarannya. Hapus dulu pembayarannya (di menu Utang & Piutang, atau jurnal pembayarannya di Jurnal Umum).');
      await deleteEntries(db, userId, [entry.id]);
      // Pembayaran jurnal lain yang tadinya tidak punya pasangan mungkin sekarang bisa dicocokkan.
      for (const accountId of accounts) await allocateUnmatched(db, userId, accountId);
    });
    return;
  }
  await db.tx(() => deleteEntries(db, userId, [entry.id]));
}

async function attachLines(db, entries) {
  if (!entries.length) return [];
  const ids = entries.map((e) => e.id);
  const rows = await db.all(
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
  const debtRowsOf = await db.all(
    `SELECT d.id, d.entry_id, d.kind, d.amount, d.due_date,
            COALESCE((SELECT SUM(p.amount) FROM debt_payments p WHERE p.debt_id = d.id), 0) AS paid
     FROM debts d WHERE d.entry_id IN (${ids.map(() => '?').join(',')})`,
    ...ids,
  );
  const debtsByEntry = new Map();
  for (const d of debtRowsOf) {
    if (!debtsByEntry.has(d.entry_id)) debtsByEntry.set(d.entry_id, []);
    debtsByEntry.get(d.entry_id).push({ id: d.id, kind: d.kind, amount: d.amount, paid: d.paid, dueDate: d.due_date });
  }
  return entries.map((e) => {
    const lines = byEntry.get(e.id) || [];
    const pick = (fn) => { const l = lines.find(fn); return l ? { id: l.accountId, name: l.name } : null; };
    const out = {
      id: e.id, date: e.date, description: e.description, kind: e.kind, amount: e.amount,
      contact: e.contact_id ? { id: e.contact_id, name: e.contact_name } : null,
      createdBy: e.created_by ? { id: e.created_by, name: e.created_by_name } : null,
      lines,
    };
    if (debtsByEntry.has(e.id)) out.debts = debtsByEntry.get(e.id);
    // Ringkasan untuk tampilan sederhana: kategori & dompet yang dipakai.
    if (e.kind === 'income') { out.cashAccount = pick((l) => l.debit > 0); out.category = pick((l) => l.credit > 0); }
    else if (e.kind === 'expense') { out.category = pick((l) => l.debit > 0); out.cashAccount = pick((l) => l.credit > 0); }
    else if (e.kind === 'transfer') { out.toAccount = pick((l) => l.debit > 0); out.cashAccount = pick((l) => l.credit > 0); }
    else if (e.kind === 'capital_in') { out.cashAccount = pick((l) => l.debit > 0); out.category = pick((l) => l.credit > 0); }
    else if (e.kind === 'drawing') { out.category = pick((l) => l.debit > 0); out.cashAccount = pick((l) => l.credit > 0); }
    return out;
  });
}

export async function listEntries(db, userId, { from, to, kinds, accountId, contactId, q, limit = 50, offset = 0, order = 'DESC' } = {}) {
  const cond = ['e.user_id = ?'];
  const params = [userId];
  if (from) { cond.push('e.date >= ?'); params.push(from); }
  if (to) { cond.push('e.date <= ?'); params.push(to); }
  if (kinds?.length) { cond.push(`e.kind IN (${kinds.map(() => '?').join(',')})`); params.push(...kinds); }
  if (accountId) { cond.push('EXISTS (SELECT 1 FROM lines l WHERE l.entry_id = e.id AND l.account_id = ?)'); params.push(accountId); }
  if (contactId) { cond.push('e.contact_id = ?'); params.push(contactId); }
  if (q) { cond.push("e.description ILIKE ? ESCAPE '\\'"); params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); }
  const where = cond.join(' AND ');
  const dir = order === 'ASC' ? 'ASC' : 'DESC';
  const total = (await db.get(`SELECT COUNT(*) AS n FROM entries e WHERE ${where}`, ...params)).n;
  const rows = await db.all(
    `SELECT e.*, c.name AS contact_name, cu.name AS created_by_name
     FROM entries e LEFT JOIN contacts c ON c.id = e.contact_id LEFT JOIN users cu ON cu.id = e.created_by
     WHERE ${where} ORDER BY e.date ${dir}, e.id ${dir} LIMIT ? OFFSET ?`,
    ...params, limit, offset,
  );
  const totals = await db.get(
    `SELECT COALESCE(SUM(CASE WHEN e.kind = 'income' THEN e.amount END), 0) AS income,
            COALESCE(SUM(CASE WHEN e.kind = 'expense' THEN e.amount END), 0) AS expense
     FROM entries e WHERE ${where}`,
    ...params,
  );
  return { items: await attachLines(db, rows), total, totals };
}

// ─────────────────── Transaksi sederhana → baris jurnal ───────────────────

export const SIMPLE_KINDS = ['income', 'expense', 'transfer', 'capital_in', 'drawing'];
const isCash = (a) => a.type === 'asset' && a.subtype === 'cash';

export async function simpleLines(db, userId, t) {
  const kind = v.oneOf(t.kind, SIMPLE_KINDS, 'Jenis transaksi');
  const amount = v.amount(t.amount);
  const cash = await usableAccount(db, userId, t.cashAccountId, kind === 'transfer' ? 'Dompet asal' : 'Dompet', isCash);
  const dr = (acc) => ({ accountId: acc.id, debit: amount, credit: 0 });
  const cr = (acc) => ({ accountId: acc.id, debit: 0, credit: amount });
  switch (kind) {
    case 'income': {
      const cat = await usableAccount(db, userId, t.categoryId, 'Kategori', (a) => a.type === 'income');
      return [dr(cash), cr(cat)]; // uang masuk ke dompet, asalnya dari pendapatan
    }
    case 'expense': {
      const cat = await usableAccount(db, userId, t.categoryId, 'Kategori', (a) => a.type === 'expense');
      return [dr(cat), cr(cash)]; // beban bertambah, uang keluar dari dompet
    }
    case 'transfer': {
      const to = await usableAccount(db, userId, t.toAccountId, 'Dompet tujuan', isCash);
      if (to.id === cash.id) throw bad('Dompet asal dan tujuan tidak boleh sama.');
      return [dr(to), cr(cash)];
    }
    case 'capital_in':
      return [dr(cash), cr(await roleAccount(db, userId, 'capital'))];
    default: // drawing
      return [dr(await roleAccount(db, userId, 'drawing')), cr(cash)];
  }
}

// ─────────────── Utang/piutang yang dicatat lewat jurnal manual ───────────────
// Jurnal manual yang menyentuh akun utang/piutang otomatis dicatat juga di menu
// Utang & Piutang. Kenaikan saldo akun = catatan utang baru; penurunan = pelunasan
// yang memotong utang tertua pada akun yang sama (atau milik kontak yang dipilih).

const JOURNAL_KINDS = ['manual', 'opening'];

// Akun yang dianggap utang (payable) atau piutang (receivable).
export const debtKindOf = (a) => {
  if (a.type === 'liability' && (a.subtype === 'payable' || a.subtype === 'loan')) return 'payable';
  if (a.type === 'asset' && a.subtype === 'receivable') return 'receivable';
  return null;
};

async function journalDebtAccounts(db, entryId) {
  const rows = await db.all('SELECT DISTINCT l.account_id, a.type, a.subtype FROM lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ?', entryId);
  return rows.filter((r) => debtKindOf(r)).map((r) => r.account_id);
}

// Mencocokkan pembayaran jurnal yang belum punya pasangan dengan utang yang masih terbuka.
async function allocateUnmatched(db, userId, accountId) {
  const acc = await db.get('SELECT id, type, subtype FROM accounts WHERE id = ? AND user_id = ?', accountId, userId);
  const kind = acc && debtKindOf(acc);
  if (!kind) return;
  const pay = kind === 'payable' ? 'l.debit - l.credit' : 'l.credit - l.debit';
  const payers = await db.all(
    `SELECT e.id, e.date, e.contact_id, SUM(${pay}) AS amount
     FROM entries e JOIN lines l ON l.entry_id = e.id
     WHERE e.user_id = ? AND e.kind IN ('manual','opening') AND l.account_id = ?
     GROUP BY e.id, e.date, e.contact_id
     HAVING SUM(${pay}) > 0
     ORDER BY e.date, e.id`,
    userId, accountId,
  );
  if (!payers.length) return;
  // Kunci dulu baris utangnya supaya pelunasan dari menu yang masuk bersamaan tidak tumpang tindih.
  await db.all('SELECT id FROM debts WHERE user_id = ? AND account_id = ? ORDER BY id FOR UPDATE', userId, accountId);
  for (const payer of payers) {
    const done = (await db.get('SELECT COALESCE(SUM(p.amount), 0) AS n FROM debt_payments p JOIN debts d ON d.id = p.debt_id WHERE p.entry_id = ? AND d.account_id = ?', payer.id, accountId)).n;
    let need = payer.amount - done;
    if (need <= 0) continue;
    const open = await db.all(
      `SELECT d.id, d.amount - COALESCE((SELECT SUM(p.amount) FROM debt_payments p WHERE p.debt_id = d.id), 0) AS remaining
       FROM debts d JOIN entries de ON de.id = d.entry_id
       WHERE d.user_id = ? AND d.account_id = ? AND de.date <= ? AND d.entry_id != ? ${payer.contact_id ? 'AND d.contact_id = ?' : ''}
       ORDER BY de.date, d.id`,
      userId, accountId, payer.date, payer.id, ...(payer.contact_id ? [payer.contact_id] : []),
    );
    for (const d of open) {
      if (need <= 0) break;
      if (d.remaining <= 0) continue;
      const take = Math.min(need, d.remaining);
      await db.run('INSERT INTO debt_payments (debt_id, entry_id, amount, date) VALUES (?,?,?,?)', d.id, payer.id, take, payer.date);
      need -= take;
    }
  }
}

// Menyamakan catatan utang/piutang dengan isi sebuah jurnal manual (dipanggil di dalam transaksi).
export async function syncJournalDebts(db, userId, entryId, { dueDate } = {}) {
  const entry = await db.get('SELECT * FROM entries WHERE id = ? AND user_id = ?', entryId, userId);
  if (!entry || !JOURNAL_KINDS.includes(entry.kind)) return;
  const lines = await db.all('SELECT l.account_id, l.debit, l.credit, a.type, a.subtype FROM lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ?', entryId);
  const net = new Map(); // akun utang → { kind, delta } ; delta > 0 berarti utang/piutang bertambah
  for (const l of lines) {
    const kind = debtKindOf(l);
    if (!kind) continue;
    const cur = net.get(l.account_id) || { kind, delta: 0 };
    cur.delta += kind === 'payable' ? l.credit - l.debit : l.debit - l.credit;
    net.set(l.account_id, cur);
  }
  const hadDebts = (await db.get('SELECT COUNT(*) AS n FROM debts WHERE entry_id = ?', entryId)).n;
  const hadPays = (await db.get('SELECT COUNT(*) AS n FROM debt_payments WHERE entry_id = ?', entryId)).n;
  if (!net.size && !hadDebts && !hadPays) return;

  // Satu pembukuan diproses satu per satu supaya pencocokan pembayaran tidak saling menimpa.
  await db.get('SELECT id FROM users WHERE id = ? FOR UPDATE', userId);

  const touched = new Set(net.keys());
  for (const r of await db.all('SELECT DISTINCT d.account_id FROM debt_payments p JOIN debts d ON d.id = p.debt_id WHERE p.entry_id = ?', entryId)) touched.add(r.account_id);
  await db.run('DELETE FROM debt_payments WHERE entry_id = ?', entryId); // dicocokkan ulang di bawah

  const existing = await db.all(
    `SELECT d.*, COALESCE((SELECT SUM(p.amount) FROM debt_payments p WHERE p.debt_id = d.id), 0) AS paid,
            (SELECT MIN(p.date) FROM debt_payments p WHERE p.debt_id = d.id) AS first_paid
     FROM debts d WHERE d.entry_id = ?`,
    entryId,
  );
  for (const d of existing) touched.add(d.account_id);

  if (dueDate && dueDate < entry.date) throw bad('Jatuh tempo tidak boleh sebelum tanggal jurnal.');
  for (const d of existing) {
    const n = net.get(d.account_id);
    if (n && n.delta > 0) continue;
    if (d.paid > 0) throw bad('Jurnal ini mencatat utang/piutang yang sudah ada pembayarannya. Hapus dulu pembayarannya (di menu Utang & Piutang, atau jurnal pembayarannya di Jurnal Umum).');
    await db.run('DELETE FROM debts WHERE id = ?', d.id);
  }
  for (const [accountId, n] of net) {
    if (n.delta <= 0) continue;
    const row = existing.find((d) => d.account_id === accountId);
    if (row) {
      if (n.delta < row.paid) throw bad(`Jumlah utang/piutang tidak boleh lebih kecil dari yang sudah dibayar (${row.paid.toLocaleString('id-ID')}).`);
      if (row.first_paid && entry.date > row.first_paid) throw bad('Tanggal jurnal tidak boleh setelah tanggal pembayarannya.');
      await db.run(
        'UPDATE debts SET amount = ?, contact_id = ?, description = ?, due_date = ? WHERE id = ?',
        n.delta, entry.contact_id, entry.description, dueDate === undefined ? row.due_date : dueDate, row.id,
      );
    } else {
      await db.insert(
        'INSERT INTO debts (user_id, kind, account_id, contact_id, entry_id, amount, due_date, description, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        userId, n.kind, accountId, entry.contact_id, entryId, n.delta, dueDate ?? null, entry.description, nowIso(),
      );
    }
  }
  for (const accountId of touched) await allocateUnmatched(db, userId, accountId);
}

// Dipakai sekali saat peningkatan versi: menyinkronkan jurnal manual lama.
export async function backfillJournalDebts(db) {
  const rows = await db.all(
    `SELECT DISTINCT e.user_id, e.id, e.date FROM entries e
     JOIN lines l ON l.entry_id = e.id JOIN accounts a ON a.id = l.account_id
     WHERE e.kind IN ('manual','opening')
       AND ((a.type = 'liability' AND a.subtype IN ('payable','loan')) OR (a.type = 'asset' AND a.subtype = 'receivable'))
     ORDER BY e.user_id, e.date, e.id`,
  );
  for (const r of rows) await syncJournalDebts(db, r.user_id, r.id);
}

// ───────────────────────── Utang & piutang ─────────────────────────

async function debtRows(db, userId, where = '', params = []) {
  return await db.all(
    `SELECT d.id, d.kind, d.amount, d.due_date, d.description, d.contact_id, d.entry_id, d.account_id,
            e.date, e.kind AS entry_kind, c.name AS contact_name, a.name AS account_name,
            i.id AS invoice_id, i.number AS invoice_number,
            COALESCE((SELECT SUM(p.amount) FROM debt_payments p WHERE p.debt_id = d.id), 0) AS paid
     FROM debts d
     JOIN entries e ON e.id = d.entry_id
     JOIN accounts a ON a.id = d.account_id
     LEFT JOIN contacts c ON c.id = d.contact_id
     LEFT JOIN invoices i ON i.debt_id = d.id
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
    // Asal catatan: dari menu ini ('menu'), dari jurnal manual ('journal'), atau dari faktur (invoice).
    source: r.invoice_id ? 'invoice' : r.entry_kind === 'debt' ? 'menu' : 'journal',
    entryId: r.entry_id,
    invoice: r.invoice_id ? { id: r.invoice_id, number: r.invoice_number } : null,
    status: remaining <= 0 ? 'paid' : r.due_date && today && r.due_date < today ? 'overdue' : 'open',
  };
}

export async function listDebts(db, userId, { today, kind, status } = {}) {
  let items = (await debtRows(db, userId, kind ? 'AND d.kind = ?' : '', kind ? [kind] : [])).map((r) => shapeDebt(r, today));
  if (status === 'open') items = items.filter((d) => d.status !== 'paid');
  else if (status === 'paid') items = items.filter((d) => d.status === 'paid');
  const ids = items.map((d) => d.id);
  const payments = ids.length
    ? await db.all(
      `SELECT p.id, p.debt_id, p.amount, p.date, p.entry_id, pe.kind AS entry_kind
       FROM debt_payments p JOIN entries pe ON pe.id = p.entry_id
       WHERE p.debt_id IN (${ids.map(() => '?').join(',')}) ORDER BY p.date, p.id`,
      ...ids,
    )
    : [];
  for (const d of items) {
    d.payments = payments.filter((p) => p.debt_id === d.id).map((p) => ({ id: p.id, amount: p.amount, date: p.date, source: p.entry_kind === 'debt_payment' ? 'menu' : 'journal', entryId: p.entry_id }));
  }
  return items;
}

export async function debtTotals(db, userId) {
  const out = { payable: 0, receivable: 0 };
  for (const r of await debtRows(db, userId)) out[r.kind] += Math.max(r.amount - r.paid, 0);
  return out;
}

// Saldo utang/piutang menurut buku besar (yang dipakai Neraca). Kalau berbeda dari total di daftar,
// artinya ada saldo yang belum tercatat sebagai catatan utang/piutang (mis. pembayaran jurnal yang
// tidak punya utang pasangan), dan halaman Utang & Piutang menampilkan selisihnya.
export async function debtLedger(db, userId) {
  const rows = await db.all(
    `SELECT a.type, a.subtype, COALESCE(SUM(l.debit), 0) AS d, COALESCE(SUM(l.credit), 0) AS c
     FROM accounts a LEFT JOIN lines l ON l.account_id = a.id
     WHERE a.user_id = ? GROUP BY a.id, a.type, a.subtype`,
    userId,
  );
  const out = { payable: 0, receivable: 0 };
  for (const r of rows) {
    const kind = debtKindOf(r);
    if (kind === 'payable') out.payable += r.c - r.d;
    else if (kind === 'receivable') out.receivable += r.d - r.c;
  }
  return out;
}

export async function createDebt(db, userId, body, createdBy) {
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
    account = await roleAccount(db, userId, 'loan');
    lines = [dr(await usableAccount(db, userId, body.cashAccountId, 'Dompet', isCash)), cr(account)];
  } else if (kind === 'payable') {
    // Beli sesuatu tapi belum dibayar: beban bertambah, utang usaha bertambah.
    account = await roleAccount(db, userId, 'payable');
    lines = [dr(await usableAccount(db, userId, body.categoryId, 'Kategori', (a) => a.type === 'expense' || (a.type === 'asset' && !isCash(a)))), cr(account)];
  } else if (mode === 'cash') {
    // Meminjamkan uang: piutang bertambah, kas berkurang.
    account = await roleAccount(db, userId, 'receivable');
    lines = [dr(account), cr(await usableAccount(db, userId, body.cashAccountId, 'Dompet', isCash))];
  } else {
    // Menjual tapi belum dibayar: piutang bertambah, pendapatan bertambah.
    account = await roleAccount(db, userId, 'receivable');
    lines = [dr(account), cr(await usableAccount(db, userId, body.categoryId, 'Kategori', (a) => a.type === 'income'))];
  }

  return await db.tx(async () => {
    await lockBook(db, userId); // pembukuan dulu, sebelum menulis apa pun (urutan kunci seragam)
    let contactId = await checkContact(db, userId, body.contactId);
    if (!contactId && newName) {
      const existing = await db.get('SELECT id FROM contacts WHERE user_id = ? AND lower(name) = lower(?)', userId, newName);
      contactId = existing?.id ?? await db.insert('INSERT INTO contacts (user_id, name, type, created_at) VALUES (?,?,?,?)', userId, newName, kind === 'payable' ? 'supplier' : 'customer', nowIso());
    }
    const entryId = await createEntry(db, userId, { date, description, kind: 'debt', contactId, lines, createdBy });
    return db.insert(
      'INSERT INTO debts (user_id, kind, account_id, contact_id, entry_id, amount, due_date, description, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      userId, kind, account.id, contactId, entryId, amount, dueDate, description, nowIso(),
    );
  });
}

async function getDebt(db, userId, id) {
  const row = (await debtRows(db, userId, 'AND d.id = ?', [v.id(id)]))[0];
  if (!row) throw notFound('Catatan utang/piutang tidak ditemukan.');
  return row;
}

export async function payDebt(db, userId, id, body, createdBy) {
  const amount = v.amount(body.amount);
  const date = v.date(body.date);
  await getDebt(db, userId, id); // pastikan milik pengguna ini sebelum mengunci
  return db.tx(async () => {
    // Urutan kunci: pembukuan, dompet, baru utangnya (sama dengan jalur lain, supaya tidak saling menunggu).
    await lockBook(db, userId);
    const walletId = Number(body.cashAccountId);
    if (Number.isInteger(walletId) && walletId > 0) await lockWallets(db, userId, [walletId]);
    // Kunci baris utangnya, supaya dua pelunasan yang masuk bersamaan tidak
    // sama-sama lolos pemeriksaan sisa dan membuat total bayar melebihi utang.
    await db.get('SELECT id FROM debts WHERE id = ? FOR UPDATE', v.id(id));
    const debt = await getDebt(db, userId, id);
    const remaining = debt.amount - debt.paid;
    if (remaining <= 0) throw bad('Catatan ini sudah lunas.');
    if (amount > remaining) throw bad(`Jumlah melebihi sisa (${remaining.toLocaleString('id-ID')}).`);
    if (date < debt.date) throw bad('Tanggal pembayaran tidak boleh sebelum tanggal utang/piutang dicatat.');
    const cash = await usableAccount(db, userId, body.cashAccountId, 'Dompet', isCash);
    const lines = debt.kind === 'payable'
      ? [{ accountId: debt.account_id, debit: amount, credit: 0 }, { accountId: cash.id, debit: 0, credit: amount }]
      : [{ accountId: cash.id, debit: amount, credit: 0 }, { accountId: debt.account_id, debit: 0, credit: amount }];
    const label = debt.kind === 'payable' ? 'Bayar utang' : 'Terima piutang';
    const entryId = await createEntry(db, userId, { date, description: `${label}: ${debt.description}`.slice(0, 200), kind: 'debt_payment', contactId: debt.contact_id, lines, createdBy });
    return db.insert('INSERT INTO debt_payments (debt_id, entry_id, amount, date) VALUES (?,?,?,?)', debt.id, entryId, amount, date);
  });
}

// Menghapus utang beserta pelunasannya dari menu (tanpa pemeriksaan asal; dipakai juga oleh faktur).
export async function removeDebt(db, userId, debt) {
  await db.tx(async () => {
    // Hanya catatan pelunasan dari menu yang ikut dihapus. Jurnal manual yang kebetulan melunasi
    // utang ini tidak disentuh (jurnalnya tetap milik pengguna).
    const payments = await db.all("SELECT p.entry_id FROM debt_payments p JOIN entries e ON e.id = p.entry_id WHERE p.debt_id = ? AND e.kind = 'debt_payment'", debt.id);
    // Pelunasan dan catatan utangnya dihapus bersama, lalu saldo dompet diperiksa sekali.
    await deleteEntries(db, userId, [...payments.map((p) => p.entry_id), debt.entry_id]);
    await allocateUnmatched(db, userId, debt.account_id);
  });
}

export async function deleteDebt(db, userId, id) {
  const debt = await getDebt(db, userId, id);
  if (debt.invoice_id) throw bad(`Piutang ini adalah faktur ${debt.invoice_number}. Hapus lewat menu Faktur.`);
  if (debt.entry_kind !== 'debt') throw bad('Utang/piutang ini berasal dari jurnal manual. Ubah atau hapus lewat menu Jurnal Umum.');
  await removeDebt(db, userId, debt);
}

export async function deleteDebtPayment(db, userId, debtId, paymentId) {
  const debt = await getDebt(db, userId, debtId);
  const pay = await db.get('SELECT p.*, e.kind AS entry_kind FROM debt_payments p JOIN entries e ON e.id = p.entry_id WHERE p.id = ? AND p.debt_id = ?', v.id(paymentId), debt.id);
  if (!pay) throw notFound('Pembayaran tidak ditemukan.');
  if (pay.entry_kind !== 'debt_payment') throw bad('Pembayaran ini berasal dari jurnal manual. Ubah atau hapus jurnalnya di menu Jurnal Umum.');
  await db.tx(() => deleteEntries(db, userId, [pay.entry_id]));
}

// ───────────────────────────── Anggaran ─────────────────────────────

export async function budgetStatus(db, userId, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw bad('Bulan tidak valid.');
  const rows = await db.all(
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

export async function setBudget(db, userId, accountId, amount) {
  const acc = await getAccount(db, userId, accountId, 'Kategori');
  if (acc.type !== 'expense') throw bad('Anggaran hanya bisa dipasang pada kategori pengeluaran.');
  const value = v.amount(amount, 'Anggaran', { allowZero: true });
  if (value === 0) await db.run('DELETE FROM budgets WHERE user_id = ? AND account_id = ?', userId, acc.id);
  else await db.run('INSERT INTO budgets (user_id, account_id, amount) VALUES (?,?,?) ON CONFLICT(user_id, account_id) DO UPDATE SET amount = excluded.amount', userId, acc.id, value);
}

// ───────────────────────────── Laporan ─────────────────────────────

export async function journalReport(db, userId, { from, to }) {
  const res = await listEntries(db, userId, { from, to, limit: 2000, order: 'ASC' });
  const total = res.items.reduce((s, e) => s + e.amount, 0);
  return { from, to, entries: res.items, totalDebit: total, totalCredit: total, truncated: res.total > res.items.length };
}

export async function ledgerReport(db, userId, { from, to, accountId }) {
  const accounts = await db.all(`SELECT * FROM accounts WHERE user_id = ? ${accountId ? 'AND id = ?' : ''} ORDER BY code`, ...(accountId ? [userId, accountId] : [userId]));
  if (accountId && !accounts.length) throw notFound('Akun tidak ditemukan.');
  const opening = new Map((await sums(db, userId, { before: from })).map((r) => [r.id, r]));
  const out = [];
  for (const acc of accounts) {
    const rows = await db.all(
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

export async function trialBalance(db, userId, { to }) {
  const rows = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const r of await sums(db, userId, { to })) {
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

export async function incomeStatement(db, userId, { from, to }) {
  const rows = await sums(db, userId, { from, to });
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

export async function balanceSheet(db, userId, { to }) {
  const rows = await sums(db, userId, { to });
  const yearStart = `${to.slice(0, 4)}-01-01`;
  const earlier = netIncome(await sums(db, userId, { before: yearStart }));
  const current = netIncome(await sums(db, userId, { from: yearStart, to }));
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

export async function equityStatement(db, userId, { from, to }) {
  const equityOf = (rows) => rows.filter((r) => r.type === 'equity').reduce((s, r) => s + (r.c - r.d), 0) + netIncome(rows);
  const period = await sums(db, userId, { from, to });
  const opening = equityOf(await sums(db, userId, { before: from }));
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

export async function cashFlow(db, userId, { from, to }) {
  const cashBalance = (rows) => rows.filter(isCash).reduce((s, r) => s + (r.d - r.c), 0);
  const opening = cashBalance(await sums(db, userId, { before: from }));
  const closing = cashBalance(await sums(db, userId, { to }));
  // Untuk tiap jurnal yang menyentuh kas, sisi "lawannya" menjelaskan
  // uang itu datang dari mana / dipakai untuk apa.
  const rows = await db.all(
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

export async function debtReport(db, userId, { today }) {
  const debts = await listDebts(db, userId, { today, status: 'open' });
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

export async function dashboard(db, userId, { from, to, pfrom, pto, today }) {
  const periodRows = await sums(db, userId, { from, to });
  const period = periodTotals(periodRows);
  const previous = pfrom && pto ? periodTotals(await sums(db, userId, { from: pfrom, to: pto })) : null;

  const asOf = await sums(db, userId, { to });
  const wallets = asOf.filter((r) => isCash(r) && (!r.archived || r.d - r.c !== 0)).map((r) => ({ id: r.id, name: r.name, balance: r.d - r.c }));
  const cashBalance = wallets.reduce((s, w) => s + w.balance, 0);

  // Pemasukan vs pengeluaran 6 bulan terakhir (berakhir di bulan "to").
  const endMonth = to.slice(0, 7);
  const months = Array.from({ length: 6 }, (_, i) => monthAdd(endMonth, i - 5));
  const monthlyRows = await db.all(
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
  const first = (await db.get('SELECT MIN(date) AS d FROM entries WHERE user_id = ?', userId)).d;
  let start = from;
  if (first && start < first) start = first;
  const end = today && to > today ? today : to;
  const cashTrend = [];
  if (first && start <= end) {
    const before = (await sums(db, userId, { before: start })).filter(isCash).reduce((s, r) => s + (r.d - r.c), 0);
    const deltaRows = await db.all(
      `SELECT e.date, SUM(l.debit - l.credit) AS delta
       FROM lines l JOIN entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
       WHERE e.user_id = ? AND e.date >= ? AND e.date <= ? AND a.type = 'asset' AND a.subtype = 'cash'
       GROUP BY e.date`,
      userId, start, end,
    );
    const deltas = new Map(deltaRows.map((r) => [r.date, r.delta]));
    const days = dayDiff(start, end) + 1;
    const step = Math.max(1, Math.ceil(days / 62));
    let balance = before;
    for (let i = 0; i < days; i += 1) {
      const date = dayAdd(start, i);
      balance += deltas.get(date) || 0;
      if ((days - 1 - i) % step === 0) cashTrend.push({ date, balance });
    }
  }

  const recent = (await listEntries(db, userId, { from, to, limit: 6 })).items.map(({ lines, ...rest }) => rest);
  const openDebts = await listDebts(db, userId, { today, status: 'open' });
  const debtSum = (kind) => openDebts.filter((d) => d.kind === kind).reduce((s, d) => s + d.remaining, 0);

  return {
    from, to,
    kpis: { cashBalance, ...period },
    previous,
    wallets,
    monthly,
    expenseByCategory: byCategory('expense'),
    incomeByCategory: byCategory('income'),
    budget: await budgetStatus(db, userId, endMonth),
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
