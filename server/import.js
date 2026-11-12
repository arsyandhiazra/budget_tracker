// Impor transaksi dari Excel (.xlsx) atau CSV. Dua tahap supaya aman:
//   1) analyzeImport  → pratinjau: tiap baris dicek (tanggal, jenis, jumlah, kategori, dompet), tanpa menyimpan apa pun.
//   2) commitImport   → menyimpan baris yang sah dalam SATU transaksi database (semua atau tidak sama sekali).
// Yang diimpor: pemasukan dan pengeluaran (pola paling umum, mis. mutasi rekening).
import { bad, isDate, MAX_AMOUNT } from './http.js';
import { nowIso } from './db.js';
import * as acc from './accounting.js';
import { parseTable } from './table.js';
import { buildXlsx } from './xlsx.js';

export const MAX_IMPORT_ROWS = 2000;
const CHUNK = 200;

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const HEADERS = {
  date: ['tanggal', 'tgl', 'date', 'tanggaltransaksi', 'tgltransaksi'],
  kind: ['jenis', 'tipe', 'type', 'jenistransaksi', 'kind'],
  amount: ['jumlah', 'nominal', 'amount', 'nilai', 'rp', 'total'],
  income: ['pemasukan', 'masuk', 'income', 'uangmasuk', 'penerimaan'],
  expense: ['pengeluaran', 'keluar', 'expense', 'uangkeluar'],
  category: ['kategori', 'category', 'pos'],
  wallet: ['dompet', 'wallet', 'rekening', 'sumberdana', 'metodepembayaran'],
  description: ['keterangan', 'deskripsi', 'description', 'uraian', 'catatan', 'memo', 'note', 'notes'],
};
const FIELD_OF = new Map(Object.entries(HEADERS).flatMap(([field, names]) => names.map((n) => [n, field])));

const KIND_VALUES = {
  income: new Set(['pemasukan', 'masuk', 'uangmasuk', 'income', 'in', 'pendapatan', 'penerimaan', 'cr']),
  expense: new Set(['pengeluaran', 'keluar', 'uangkeluar', 'expense', 'out', 'beban', 'biaya', 'belanja', 'db']),
};

// Mencari baris judul kolom (boleh ada beberapa baris judul/keterangan di atasnya).
function findHeader(rows) {
  let best = null;
  for (let i = 0; i < Math.min(rows.length, 15); i += 1) {
    const map = {};
    for (const [col, cell] of rows[i].entries()) {
      const field = typeof cell === 'string' ? FIELD_OF.get(norm(cell)) : undefined;
      if (field && map[field] === undefined) map[field] = col;
    }
    const hasAmount = map.amount !== undefined || (map.income !== undefined && map.expense !== undefined);
    const score = Object.keys(map).length;
    if (map.date !== undefined && hasAmount && (!best || score > best.score)) best = { index: i, map, score };
  }
  if (!best) {
    throw bad('Baris judul kolom tidak ditemukan. File harus punya kolom Tanggal dan Jumlah (atau Pemasukan dan Pengeluaran). Unduh template untuk contohnya.');
  }
  return best;
}

const MONTHS = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mar: 3, maret: 3, march: 3, apr: 4, april: 4, mei: 5, may: 5,
  jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, agu: 8, agt: 8, agustus: 8, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11, des: 12, desember: 12, dec: 12, december: 12,
};

const iso = (y, m, d) => {
  if (y < 1990 || y > 2100) return null;
  const text = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isDate(text) ? text : null;
};

/** Tanggal dari sel Excel (angka serial) atau teks: 2026-01-31, 31/01/2026, 31-01-26, 31 Jan 2026, 31 Januari 2026. */
export function parseDateCell(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!(value >= 1 && value < 2_958_466)) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const t = String(value).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(t);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:\s.*)?$/.exec(t); // hari-bulan-tahun (kebiasaan di Indonesia)
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[\s-]+([A-Za-z]+)\.?,?[\s-]+(\d{2}|\d{4})$/.exec(t);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}

/** Jumlah rupiah dari angka atau teks: 1250000, "1.250.000", "Rp 1,250,000", "(50.000)", "-75000". Mengembalikan bilangan bulat bertanda, atau null. */
export function parseAmountCell(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return NaN;
    const whole = Math.round(value);
    return Math.abs(value - whole) < 1e-6 ? whole : NaN;
  }
  let t = String(value).replace(/[\s ]/g, '').replace(/^rp\.?/i, '');
  if (t === '') return null;
  let sign = 1;
  if (/^\(.*\)$/.test(t)) { sign = -1; t = t.slice(1, -1); }
  if (t.startsWith('-')) { sign = -sign; t = t.slice(1); } else if (t.startsWith('+')) t = t.slice(1);
  let digits;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) digits = t.replace(/\./g, '').replace(',', '.'); // 1.250.000 atau 1.250.000,50
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) digits = t.replace(/,/g, ''); // 1,250,000 atau 1,250,000.50
  else if (/^\d+([.,]\d+)?$/.test(t)) digits = t.replace(',', '.');
  else return NaN;
  const n = Number(digits);
  if (!Number.isFinite(n) || Math.abs(n - Math.round(n)) > 1e-6) return NaN;
  return sign * Math.round(n);
}

const cellText = (v) => (v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : String(v).trim());

// Kategori bawaan untuk baris yang kolom kategorinya kosong.
function fallbackCategory(accounts, kind) {
  const type = kind === 'income' ? 'income' : 'expense';
  const pool = accounts.filter((a) => a.type === type && !a.archived);
  return pool.find((a) => a.subtype === (kind === 'income' ? 'other_income' : 'other_expense')) ?? pool[0] ?? null;
}

/**
 * Pratinjau impor. opts: { createCategories, defaultWalletId }
 * Mengembalikan { rows, summary, plan } — "plan" dipakai commit, tidak dikirim ke tampilan.
 */
export async function analyzeRows(db, userId, rows, opts = {}) {
  const { index, map } = findHeader(rows);
  const accounts = await db.all('SELECT id, name, type, subtype, archived FROM accounts WHERE user_id = ?', userId);
  const categories = { income: new Map(), expense: new Map() };
  const wallets = new Map();
  for (const a of accounts) {
    if (a.archived) continue;
    if (a.type === 'income' || a.type === 'expense') categories[a.type].set(a.name.trim().toLowerCase(), a);
    else if (a.type === 'asset' && a.subtype === 'cash') wallets.set(a.name.trim().toLowerCase(), a);
  }
  const defaultWallet = opts.defaultWalletId ? accounts.find((a) => a.id === Number(opts.defaultWalletId) && a.type === 'asset' && a.subtype === 'cash' && !a.archived) : null;

  const data = rows.slice(index + 1).map((cells, i) => ({ cells, line: index + 2 + i })).filter(({ cells }) => cells.some((c) => c !== null && String(c).trim() !== ''));
  if (!data.length) throw bad('Tidak ada baris transaksi di bawah judul kolom.');
  if (data.length > MAX_IMPORT_ROWS) throw bad(`Maksimal ${MAX_IMPORT_ROWS.toLocaleString('id-ID')} baris per impor (file ini ${data.length.toLocaleString('id-ID')}). Bagi menjadi beberapa file.`);

  const newCategories = new Map();
  const out = [];
  for (const { cells, line } of data) {
    const get = (field) => (map[field] === undefined ? null : cells[map[field]] ?? null);
    const r = { row: line, status: 'ok', message: '', date: null, kind: null, amount: 0, category: '', wallet: '', description: '', newCategory: false };
    const fail = (message) => { if (r.status === 'ok') { r.status = 'error'; r.message = message; } };

    r.date = parseDateCell(get('date'));
    if (!r.date) fail(get('date') === null ? 'Tanggal kosong.' : `Tanggal "${cellText(get('date'))}" tidak dikenali (contoh: 2026-01-31 atau 31/01/2026).`);

    // Jenis & jumlah: kolom Jenis, atau dua kolom Pemasukan/Pengeluaran, atau tanda plus/minus pada jumlah.
    if (map.kind !== undefined && map.amount !== undefined) {
      const k = norm(get('kind'));
      r.kind = KIND_VALUES.income.has(k) ? 'income' : KIND_VALUES.expense.has(k) ? 'expense' : null;
      if (!r.kind) fail(k ? `Jenis "${cellText(get('kind'))}" tidak dikenali (isi Pemasukan atau Pengeluaran).` : 'Jenis kosong (isi Pemasukan atau Pengeluaran).');
      const n = parseAmountCell(get('amount'));
      if (n === null) fail('Jumlah kosong.');
      else if (Number.isNaN(n)) fail(`Jumlah "${cellText(get('amount'))}" bukan angka bulat rupiah.`);
      else if (n < 0) fail('Jumlah tidak boleh negatif kalau kolom Jenis diisi.');
      else r.amount = n;
    } else if (map.income !== undefined && map.expense !== undefined) {
      const inc = parseAmountCell(get('income'));
      const exp = parseAmountCell(get('expense'));
      if (Number.isNaN(inc) || Number.isNaN(exp)) fail('Jumlah pemasukan/pengeluaran bukan angka bulat rupiah.');
      else if (inc && exp) fail('Pemasukan dan Pengeluaran sama-sama terisi di satu baris.');
      else if (!inc && !exp) fail('Jumlah kosong.');
      else { r.kind = inc ? 'income' : 'expense'; r.amount = Math.abs(inc || exp); }
    } else {
      const n = parseAmountCell(get('amount'));
      if (n === null) fail('Jumlah kosong.');
      else if (Number.isNaN(n)) fail(`Jumlah "${cellText(get('amount'))}" bukan angka bulat rupiah.`);
      else { r.kind = n < 0 ? 'expense' : 'income'; r.amount = Math.abs(n); }
    }
    if (r.status === 'ok' && r.amount <= 0) fail('Jumlah harus lebih dari 0.');
    if (r.status === 'ok' && r.amount > MAX_AMOUNT) fail('Jumlah terlalu besar.');

    r.description = cellText(get('description')).slice(0, 200);
    if (!r.description) r.description = 'Tanpa keterangan';

    // Kategori
    let category = null;
    if (r.kind) {
      const name = cellText(get('category'));
      if (!name) {
        category = fallbackCategory(accounts, r.kind);
        if (!category) fail('Kategori kosong dan tidak ada kategori bawaan.');
        else r.category = category.name;
      } else {
        r.category = name;
        category = categories[r.kind].get(name.toLowerCase()) ?? null;
        if (!category) {
          if (!opts.createCategories) fail(`Kategori "${name}" belum ada. Centang "buat kategori yang belum ada", atau tambahkan lebih dulu di Daftar Akun.`);
          else if (name.length > 80) fail('Nama kategori terlalu panjang (maksimal 80 karakter).');
          else { r.newCategory = true; newCategories.set(`${r.kind}:${name.toLowerCase()}`, { name, type: r.kind }); }
        }
      }
    }

    // Dompet
    const walletName = cellText(get('wallet'));
    let wallet = null;
    if (walletName) {
      r.wallet = walletName;
      wallet = wallets.get(walletName.toLowerCase()) ?? null;
      if (!wallet) fail(`Dompet "${walletName}" tidak ditemukan. Dompet yang ada: ${[...wallets.values()].map((w) => w.name).join(', ') || '-'}.`);
    } else if (defaultWallet) {
      wallet = defaultWallet;
      r.wallet = defaultWallet.name;
    } else {
      fail('Dompet kosong dan dompet bawaan belum dipilih.');
    }
    r._category = category;
    r._wallet = wallet;
    out.push(r);
  }

  // Deteksi duplikat terhadap transaksi yang sudah ada (tanggal, jenis, jumlah, keterangan, kategori, dompet sama persis).
  const sound = out.filter((r) => r.status === 'ok' && r._category && r._wallet);
  if (sound.length) {
    const dates = sound.map((r) => r.date).sort();
    const existing = await db.all(
      `SELECT e.date, e.kind, e.amount, lower(e.description) AS description,
              (SELECT l.account_id FROM lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = e.id AND a.type IN ('income','expense') LIMIT 1) AS category_id,
              (SELECT l.account_id FROM lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = e.id AND a.type = 'asset' AND a.subtype = 'cash' LIMIT 1) AS wallet_id
       FROM entries e WHERE e.user_id = ? AND e.kind IN ('income','expense') AND e.date >= ? AND e.date <= ?`,
      userId, dates[0], dates[dates.length - 1],
    );
    const seen = new Map();
    const keyOf = (date, kind, amount, desc, cat, wal) => `${date}|${kind}|${amount}|${desc}|${cat}|${wal}`;
    for (const e of existing) {
      const k = keyOf(e.date, e.kind, e.amount, e.description, e.category_id, e.wallet_id);
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    for (const r of sound) {
      const k = keyOf(r.date, r.kind, r.amount, r.description.toLowerCase(), r._category.id, r._wallet.id);
      if (seen.get(k) > 0) { seen.set(k, seen.get(k) - 1); r.status = 'duplicate'; r.message = 'Sudah ada transaksi yang sama persis.'; }
    }
  }

  const ok = out.filter((r) => r.status === 'ok');
  const sum = (kind) => ok.filter((r) => r.kind === kind).reduce((s, r) => s + r.amount, 0);
  const dates = ok.map((r) => r.date).sort();
  const summary = {
    total: out.length,
    ok: ok.length,
    errors: out.filter((r) => r.status === 'error').length,
    duplicates: out.filter((r) => r.status === 'duplicate').length,
    income: sum('income'),
    expense: sum('expense'),
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    newCategories: [...newCategories.values()],
  };
  return { rows: out, summary, newCategories: [...newCategories.values()] };
}

const publicRow = ({ _category, _wallet, ...rest }) => rest;
const PREVIEW_ROWS = 500;

export async function previewImport(db, userId, buffer, opts) {
  const { rows, summary } = await analyzeRows(db, userId, parseTable(buffer), opts);
  // Baris bermasalah ditampilkan lebih dulu supaya tidak terlewat.
  const shown = [...rows.filter((r) => r.status === 'error'), ...rows.filter((r) => r.status === 'duplicate'), ...rows.filter((r) => r.status === 'ok')].slice(0, PREVIEW_ROWS).sort((a, b) => a.row - b.row);
  return { summary, rows: shown.map(publicRow), truncated: rows.length > PREVIEW_ROWS };
}

async function bulkInsertEntries(db, userId, items, actorId) {
  const ids = [];
  const now = nowIso();
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const params = [];
    const values = chunk.map((r) => { params.push(userId, r.date, r.description, r.kind, r.amount, now, actorId ?? null); return '(?,?,?,?,?,NULL,?,?)'; });
    const got = await db.all(`INSERT INTO entries (user_id, date, description, kind, amount, contact_id, created_at, created_by) VALUES ${values.join(',')} RETURNING id`, ...params);
    // Nomor baru selalu naik sesuai urutan baris yang dimasukkan.
    ids.push(...got.map((x) => x.id).sort((a, b) => a - b));
  }
  for (let i = 0; i < items.length; i += CHUNK) {
    const params = [];
    const values = [];
    for (let j = i; j < Math.min(i + CHUNK, items.length); j += 1) {
      const r = items[j];
      const [debitAccount, creditAccount] = r.kind === 'income' ? [r._wallet.id, r._category.id] : [r._category.id, r._wallet.id];
      params.push(ids[j], debitAccount, r.amount, 0, 0, ids[j], creditAccount, 0, r.amount, 1);
      values.push('(?,?,?,?,?),(?,?,?,?,?)');
    }
    await db.run(`INSERT INTO lines (entry_id, account_id, debit, credit, position) VALUES ${values.join(',')}`, ...params);
  }
  return ids;
}

/** Menyimpan hasil impor. opts: { createCategories, defaultWalletId, includeDuplicates, skipErrors } */
export async function commitImport(db, userId, buffer, opts, actorId) {
  const table = parseTable(buffer);
  return db.tx(async () => {
    await db.get('SELECT id FROM users WHERE id = ? FOR UPDATE', userId); // satu impor sekali jalan per pembukuan
    const { rows, summary, newCategories } = await analyzeRows(db, userId, table, opts);
    if (summary.errors > 0 && !opts.skipErrors) {
      throw bad(`Masih ada ${summary.errors} baris bermasalah. Perbaiki di file, atau pilih "lewati baris bermasalah".`);
    }
    const chosen = rows.filter((r) => r.status === 'ok' || (opts.includeDuplicates && r.status === 'duplicate'));
    if (!chosen.length) throw bad('Tidak ada baris yang bisa diimpor.');

    // Kategori baru dibuat dulu, lalu dipakai oleh baris-barisnya.
    const created = new Map();
    const used = new Set(chosen.filter((r) => r.newCategory).map((r) => `${r.kind}:${r.category.toLowerCase()}`));
    for (const c of newCategories) {
      const key = `${c.type}:${c.name.toLowerCase()}`;
      if (!used.has(key)) continue;
      const id = await acc.createAccount(db, userId, { name: c.name, type: c.type });
      created.set(key, await db.get('SELECT id, name, type, subtype FROM accounts WHERE id = ?', id));
    }
    for (const r of chosen) if (r.newCategory) r._category = created.get(`${r.kind}:${r.category.toLowerCase()}`);

    await bulkInsertEntries(db, userId, chosen, actorId);
    return {
      imported: chosen.length,
      duplicatesSkipped: opts.includeDuplicates ? 0 : summary.duplicates,
      errorsSkipped: summary.errors,
      categoriesCreated: [...created.values()].map((c) => c.name),
    };
  });
}

/** File contoh (template) yang memakai nama kategori dan dompet milik pembukuan ini. */
export async function templateFile(db, userId) {
  const accounts = await db.all('SELECT name, type, subtype, archived FROM accounts WHERE user_id = ? ORDER BY code', userId);
  const live = accounts.filter((a) => !a.archived);
  const income = live.find((a) => a.type === 'income')?.name ?? 'Gaji';
  const expense = live.find((a) => a.type === 'expense')?.name ?? 'Belanja';
  const wallet = live.find((a) => a.type === 'asset' && a.subtype === 'cash')?.name ?? 'Kas';
  const b = (v) => ({ v, bold: true });
  return buildXlsx({
    name: 'Transaksi',
    widths: [14, 14, 16, 26, 18, 36],
    rows: [
      [b('Tanggal'), b('Jenis'), b('Jumlah'), b('Kategori'), b('Dompet'), b('Keterangan')],
      ['2026-01-15', 'Pemasukan', 1500000, income, wallet, 'Contoh pemasukan (hapus baris ini)'],
      ['2026-01-16', 'Pengeluaran', 45000, expense, wallet, 'Contoh pengeluaran (hapus baris ini)'],
    ],
  });
}
