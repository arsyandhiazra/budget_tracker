// Faktur (invoice). Satu faktur = satu piutang di menu Utang & Piutang, ditambah rincian barang/jasa.
// Saat faktur dibuat, jurnalnya otomatis ditulis:
//   Piutang (debit) = total   |   Pendapatan (kredit) = subtotal − diskon   |   Utang Pajak (kredit) = pajak
// Pembayaran faktur memakai mekanisme pelunasan piutang yang sudah ada.
import { bad, notFound, v } from './http.js';
import { nowIso } from './db.js';
import * as acc from './accounting.js';

const MAX_ITEMS = 100;
const NUMBER_RE = /^[A-Za-z0-9._/ -]{1,40}$/;

function readQuantity(value, label) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value.trim().replace(',', '.')) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) throw bad(`${label} harus lebih dari 0.`);
  if (n > 1_000_000) throw bad(`${label} terlalu besar.`);
  if (Number(n.toFixed(3)) !== n) throw bad(`${label} maksimal 3 angka di belakang koma.`);
  return n;
}

function cleanItems(items) {
  if (!Array.isArray(items) || !items.length) throw bad('Faktur butuh minimal satu barang atau jasa.');
  if (items.length > MAX_ITEMS) throw bad(`Faktur maksimal ${MAX_ITEMS} baris.`);
  return items.map((it, i) => {
    const n = i + 1;
    const description = v.str(it?.description, `Uraian baris ${n}`, { max: 200 });
    const quantity = readQuantity(it?.quantity ?? 1, `Jumlah baris ${n}`);
    const unitPrice = v.amount(it?.unitPrice, `Harga baris ${n}`);
    const amount = Math.round(quantity * unitPrice);
    if (amount <= 0) throw bad(`Nilai baris ${n} terlalu kecil.`);
    return { description, quantity, unitPrice, amount };
  });
}

// Pajak dalam persen (mis. 11 untuk PPN 11%), disimpan sebagai basis point (1100).
function readTaxBp(value) {
  if (value === undefined || value === null || value === '') return 0;
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100) throw bad('Pajak harus antara 0 dan 100 persen.');
  if (Number(n.toFixed(2)) !== n) throw bad('Pajak maksimal 2 angka di belakang koma.');
  return Math.round(n * 100);
}

export function computeTotals(items, discount, taxBp) {
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  if (discount > subtotal) throw bad('Diskon tidak boleh lebih besar dari subtotal.');
  const net = subtotal - discount;
  const tax = Math.round((net * taxBp) / 10_000);
  return { subtotal, discount, net, tax, total: net + tax };
}

function readInput(body) {
  const issueDate = v.date(body.issueDate, 'Tanggal faktur');
  const dueDate = v.date(body.dueDate || null, 'Jatuh tempo', { optional: true });
  if (dueDate && dueDate < issueDate) throw bad('Jatuh tempo tidak boleh sebelum tanggal faktur.');
  const items = cleanItems(body.items);
  const discount = v.amount(body.discount ?? 0, 'Diskon', { allowZero: true });
  const taxBp = readTaxBp(body.taxRate);
  const totals = computeTotals(items, discount, taxBp);
  if (totals.total <= 0) throw bad('Total faktur harus lebih dari 0.');
  let number = null;
  if (body.number !== undefined && body.number !== null && String(body.number).trim() !== '') {
    number = String(body.number).trim();
    if (!NUMBER_RE.test(number)) throw bad('Nomor faktur hanya boleh huruf, angka, spasi, titik, garis miring, atau strip (maksimal 40).');
  }
  return {
    issueDate, dueDate, items, taxBp, totals, number,
    notes: v.str(body.notes, 'Catatan', { max: 500, optional: true }),
    customerAddress: v.str(body.customerAddress, 'Alamat pelanggan', { max: 300, optional: true }),
    contactId: body.contactId ? v.id(body.contactId, 'Pelanggan') : null,
    customerName: v.str(body.customerName, 'Nama pelanggan', { max: 80, optional: true }),
  };
}

export async function nextInvoiceNumber(db, userId, date) {
  const prefix = `INV-${date.slice(0, 4)}-`;
  const rows = await db.all('SELECT number FROM invoices WHERE user_id = ? AND number LIKE ?', userId, `${prefix}%`);
  let max = 0;
  for (const r of rows) {
    const m = /^INV-\d{4}-(\d+)$/.exec(r.number);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

// Pelanggan: pilih dari kontak, atau ketik nama baru (otomatis dibuat sebagai kontak "pelanggan").
async function resolveCustomer(db, userId, input) {
  if (input.contactId) {
    const c = await db.get('SELECT id, name FROM contacts WHERE id = ? AND user_id = ?', input.contactId, userId);
    if (!c) throw bad('Pelanggan tidak ditemukan.');
    return { contactId: c.id, name: c.name };
  }
  if (!input.customerName) throw bad('Pelanggan belum dipilih atau diisi.');
  const existing = await db.get('SELECT id, name FROM contacts WHERE user_id = ? AND lower(name) = lower(?)', userId, input.customerName);
  if (existing) return { contactId: existing.id, name: existing.name };
  const id = await db.insert('INSERT INTO contacts (user_id, name, type, created_at) VALUES (?,?,?,?)', userId, input.customerName, 'customer', nowIso());
  return { contactId: id, name: input.customerName };
}

async function journalLines(db, userId, input, categoryId) {
  const { total, net, tax } = input.totals;
  const piutang = await acc.roleAccount(db, userId, 'receivable');
  const category = await acc.getAccount(db, userId, categoryId, 'Kategori pendapatan');
  if (category.type !== 'income') throw bad('Kategori faktur harus berupa pendapatan.');
  if (category.archived) throw bad(`Kategori "${category.name}" sudah diarsipkan.`);
  const lines = [{ accountId: piutang.id, debit: total, credit: 0 }];
  if (net > 0) lines.push({ accountId: category.id, debit: 0, credit: net });
  if (tax > 0) lines.push({ accountId: (await acc.ensureTaxAccount(db, userId)).id, debit: 0, credit: tax });
  return { lines, piutang, category };
}

async function assertNumberFree(db, userId, number, exceptId = null) {
  const dup = await db.get('SELECT id FROM invoices WHERE user_id = ? AND lower(number) = lower(?) AND id != ?', userId, number, exceptId ?? 0);
  if (dup) throw bad(`Nomor faktur ${number} sudah dipakai.`);
}

async function saveItems(db, invoiceId, items) {
  await db.run('DELETE FROM invoice_items WHERE invoice_id = ?', invoiceId);
  for (const [i, it] of items.entries()) {
    await db.run('INSERT INTO invoice_items (invoice_id, position, description, quantity, unit_price, amount) VALUES (?,?,?,?,?,?)', invoiceId, i, it.description, it.quantity, it.unitPrice, it.amount);
  }
}

export async function createInvoice(db, userId, body, createdBy) {
  const input = readInput(body);
  const categoryId = v.id(body.categoryId, 'Kategori pendapatan');
  return db.tx(async () => {
    const number = input.number ?? await nextInvoiceNumber(db, userId, input.issueDate);
    await assertNumberFree(db, userId, number);
    const customer = await resolveCustomer(db, userId, input);
    const { lines, piutang } = await journalLines(db, userId, input, categoryId);
    const entryId = await acc.createEntry(db, userId, {
      date: input.issueDate,
      description: `Faktur ${number} · ${customer.name}`.slice(0, 200),
      kind: 'debt', contactId: customer.contactId, lines, createdBy,
    });
    const debtId = await db.insert(
      'INSERT INTO debts (user_id, kind, account_id, contact_id, entry_id, amount, due_date, description, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      userId, 'receivable', piutang.id, customer.contactId, entryId, input.totals.total, input.dueDate, `Faktur ${number}`.slice(0, 200), nowIso(),
    );
    const id = await db.insert(
      `INSERT INTO invoices (user_id, number, contact_id, customer_name, customer_address, issue_date, due_date, category_id,
                             subtotal, discount, tax_bp, tax, total, notes, debt_id, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      userId, number, customer.contactId, customer.name, input.customerAddress, input.issueDate, input.dueDate, categoryId,
      input.totals.subtotal, input.totals.discount, input.taxBp, input.totals.tax, input.totals.total, input.notes, debtId, createdBy ?? null, nowIso(),
    );
    await saveItems(db, id, input.items);
    return id;
  });
}

const statusOf = (remaining, paid, dueDate, today) => (remaining <= 0 ? 'paid' : dueDate && today && dueDate < today ? 'overdue' : paid > 0 ? 'partial' : 'unpaid');

const BASE = `SELECT i.*, a.name AS category_name, c.phone AS customer_phone, c.email AS customer_email,
                     COALESCE((SELECT SUM(p.amount) FROM debt_payments p WHERE p.debt_id = i.debt_id), 0) AS paid
              FROM invoices i
              JOIN accounts a ON a.id = i.category_id
              LEFT JOIN contacts c ON c.id = i.contact_id`;

function shape(r, today) {
  const remaining = r.total - r.paid;
  return {
    id: r.id, number: r.number, issueDate: r.issue_date, dueDate: r.due_date,
    customer: { id: r.contact_id, name: r.customer_name, address: r.customer_address, phone: r.customer_phone, email: r.customer_email },
    category: { id: r.category_id, name: r.category_name },
    subtotal: r.subtotal, discount: r.discount, taxRate: r.tax_bp / 100, tax: r.tax, total: r.total,
    paid: r.paid, remaining, status: statusOf(remaining, r.paid, r.due_date, today),
    notes: r.notes, debtId: r.debt_id,
  };
}

export async function listInvoices(db, userId, { today, status, q } = {}) {
  const cond = ['i.user_id = ?'];
  const params = [userId];
  if (q) { cond.push("(i.number ILIKE ? ESCAPE '\\' OR i.customer_name ILIKE ? ESCAPE '\\')"); const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`; params.push(like, like); }
  let items = (await db.all(`${BASE} WHERE ${cond.join(' AND ')} ORDER BY i.issue_date DESC, i.id DESC LIMIT 1000`, ...params)).map((r) => shape(r, today));
  const totals = { unpaid: 0, overdue: 0, count: items.length };
  for (const i of items) {
    if (i.status !== 'paid') totals.unpaid += i.remaining;
    if (i.status === 'overdue') totals.overdue += i.remaining;
  }
  if (status && status !== 'all') items = items.filter((i) => (status === 'open' ? i.status !== 'paid' : i.status === status));
  return { items, totals };
}

export async function getInvoice(db, userId, id, today) {
  const r = await db.get(`${BASE} WHERE i.id = ? AND i.user_id = ?`, v.id(id), userId);
  if (!r) throw notFound('Faktur tidak ditemukan.');
  const items = await db.all('SELECT description, quantity, unit_price AS "unitPrice", amount FROM invoice_items WHERE invoice_id = ? ORDER BY position, id', r.id);
  const payments = r.debt_id
    ? await db.all('SELECT p.id, p.amount, p.date FROM debt_payments p WHERE p.debt_id = ? ORDER BY p.date, p.id', r.debt_id)
    : [];
  return { ...shape(r, today), items, payments };
}

export async function nextNumberFor(db, userId, date) {
  return nextInvoiceNumber(db, userId, v.date(date, 'Tanggal'));
}

async function debtOf(db, invoice) {
  const debt = invoice.debt_id ? await db.get('SELECT * FROM debts WHERE id = ?', invoice.debt_id) : null;
  if (!debt) throw bad('Data piutang untuk faktur ini tidak ditemukan.');
  return debt;
}

export async function updateInvoice(db, userId, id, body) {
  const inv = await db.get(`${BASE} WHERE i.id = ? AND i.user_id = ?`, v.id(id), userId);
  if (!inv) throw notFound('Faktur tidak ditemukan.');
  const input = readInput(body);
  const categoryId = v.id(body.categoryId, 'Kategori pendapatan');
  await db.tx(async () => {
    const debt = await debtOf(db, inv);
    // Kunci piutangnya lalu cek ulang, supaya pembayaran yang masuk bersamaan tidak terlewat.
    await db.get('SELECT id FROM debts WHERE id = ? FOR UPDATE', debt.id);
    const paid = (await db.get('SELECT COALESCE(SUM(amount), 0) AS n FROM debt_payments WHERE debt_id = ?', debt.id)).n;
    if (paid > 0) throw bad('Faktur ini sudah ada pembayarannya. Hapus dulu pembayarannya kalau mau mengubah isi faktur.');
    const number = input.number ?? inv.number;
    await assertNumberFree(db, userId, number, inv.id);
    const customer = await resolveCustomer(db, userId, input);
    const { lines } = await journalLines(db, userId, input, categoryId);
    await acc.updateEntry(db, userId, debt.entry_id, {
      date: input.issueDate,
      description: `Faktur ${number} · ${customer.name}`.slice(0, 200),
      contactId: customer.contactId, lines,
    }, ['debt']);
    await db.run('UPDATE debts SET amount = ?, contact_id = ?, due_date = ?, description = ? WHERE id = ?', input.totals.total, customer.contactId, input.dueDate, `Faktur ${number}`.slice(0, 200), debt.id);
    await db.run(
      `UPDATE invoices SET number = ?, contact_id = ?, customer_name = ?, customer_address = ?, issue_date = ?, due_date = ?, category_id = ?,
              subtotal = ?, discount = ?, tax_bp = ?, tax = ?, total = ?, notes = ? WHERE id = ?`,
      number, customer.contactId, customer.name, input.customerAddress, input.issueDate, input.dueDate, categoryId,
      input.totals.subtotal, input.totals.discount, input.taxBp, input.totals.tax, input.totals.total, input.notes, inv.id,
    );
    await saveItems(db, inv.id, input.items);
  });
}

// Menghapus faktur beserta piutang dan semua pembayarannya (saldo ikut menyesuaikan).
export async function deleteInvoice(db, userId, id) {
  const inv = await db.get('SELECT * FROM invoices WHERE id = ? AND user_id = ?', v.id(id), userId);
  if (!inv) throw notFound('Faktur tidak ditemukan.');
  await db.tx(async () => {
    const debt = inv.debt_id ? await db.get('SELECT * FROM debts WHERE id = ?', inv.debt_id) : null;
    await db.run('DELETE FROM invoices WHERE id = ?', inv.id);
    if (debt) await acc.removeDebt(db, userId, debt);
  });
}

export async function payInvoice(db, userId, id, body, createdBy) {
  const inv = await db.get('SELECT * FROM invoices WHERE id = ? AND user_id = ?', v.id(id), userId);
  if (!inv) throw notFound('Faktur tidak ditemukan.');
  await debtOf(db, inv);
  return acc.payDebt(db, userId, inv.debt_id, body, createdBy);
}
