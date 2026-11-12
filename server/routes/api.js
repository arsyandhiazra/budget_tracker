// Semua alamat (endpoint) untuk fitur pembukuan. Setiap permintaan sudah pasti
// dari pengguna yang login (dicek di app.js), dan semua data selalu disaring
// berdasarkan pemilik akunnya (req.user.id) supaya data antar pengguna tidak tercampur.
import express from 'express';
import { bad, notFound, v, range, todayIn } from '../http.js';
import { nowIso } from '../db.js';
import * as acc from '../accounting.js';
import { buildXlsx } from '../xlsx.js';
import { reportSheet, REPORT_NAMES } from '../report-sheets.js';

const CONTACT_TYPES = ['customer', 'supplier', 'employee', 'other'];

export function createApi({ db, config }) {
  const router = express.Router();
  const uid = (req) => req.user.id;
  const today = (req) => (req.query.today && /^\d{4}-\d{2}-\d{2}$/.test(req.query.today) ? v.date(req.query.today) : todayIn(config.timezone));

  // ── Daftar akun (kategori, dompet, dll.) ──
  router.get('/accounts', async (req, res) => res.json({ accounts: await acc.listAccounts(db, uid(req)) }));
  router.post('/accounts', async (req, res) => res.status(201).json({ id: await acc.createAccount(db, uid(req), req.body) }));
  router.patch('/accounts/:id', async (req, res) => { await acc.updateAccount(db, uid(req), req.params.id, req.body); res.json({ ok: true }); });
  router.delete('/accounts/:id', async (req, res) => { await acc.deleteAccount(db, uid(req), req.params.id); res.json({ ok: true }); });

  // ── Transaksi sederhana: pemasukan, pengeluaran, transfer, setor modal, prive ──
  router.get('/transactions', async (req, res) => {
    const { from, to } = range(req.query);
    const kind = req.query.kind ? v.oneOf(req.query.kind, [...acc.SIMPLE_KINDS, 'debt', 'debt_payment', 'manual', 'opening'], 'Jenis') : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    res.json(await acc.listEntries(db, uid(req), {
      from, to,
      kinds: kind ? [kind] : null,
      accountId: v.id(req.query.accountId, 'Akun', { optional: true }),
      contactId: v.id(req.query.contactId, 'Kontak', { optional: true }),
      q: typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '',
      limit, offset,
    }));
  });

  router.post('/transactions', async (req, res) => {
    const lines = await acc.simpleLines(db, uid(req), req.body);
    const id = await acc.createEntry(db, uid(req), { date: req.body.date, description: req.body.description, kind: req.body.kind, contactId: req.body.contactId, lines });
    res.status(201).json({ id });
  });

  router.patch('/transactions/:id', async (req, res) => {
    const entry = await acc.getEntry(db, uid(req), req.params.id);
    if (!acc.SIMPLE_KINDS.includes(entry.kind)) throw bad('Catatan ini tidak bisa diubah dari halaman Transaksi.');
    if (req.body.kind !== entry.kind) throw bad('Jenis transaksi tidak bisa diganti. Hapus lalu buat yang baru.');
    const lines = await acc.simpleLines(db, uid(req), req.body);
    await acc.updateEntry(db, uid(req), entry.id, { date: req.body.date, description: req.body.description, contactId: req.body.contactId, lines }, acc.SIMPLE_KINDS);
    res.json({ ok: true });
  });

  // Menghapus catatan apa pun (kecuali yang terhubung ke utang/piutang).
  router.delete('/entries/:id', async (req, res) => { await acc.deleteEntry(db, uid(req), req.params.id); res.json({ ok: true }); });

  // ── Jurnal umum manual (untuk yang paham debit-kredit) ──
  router.post('/journal', async (req, res) => {
    const id = await acc.createEntry(db, uid(req), { date: req.body.date, description: req.body.description, kind: 'manual', contactId: req.body.contactId, lines: req.body.lines });
    res.status(201).json({ id });
  });
  router.patch('/journal/:id', async (req, res) => {
    await acc.updateEntry(db, uid(req), req.params.id, req.body, ['manual', 'opening']);
    res.json({ ok: true });
  });

  // ── Kontak ──
  const contactBody = (body) => ({
    name: v.str(body.name, 'Nama', { max: 80 }),
    type: v.oneOf(body.type || 'other', CONTACT_TYPES, 'Jenis kontak'),
    email: body.email ? v.email(body.email) : null,
    phone: v.str(body.phone, 'Nomor telepon', { max: 30, optional: true }),
    note: v.str(body.note, 'Catatan', { max: 300, optional: true }),
  });
  const getContact = async (req) => {
    const row = await db.get('SELECT * FROM contacts WHERE id = ? AND user_id = ?', v.id(req.params.id), uid(req));
    if (!row) throw notFound('Kontak tidak ditemukan.');
    return row;
  };

  router.get('/contacts', async (req, res) => {
    const rows = await db.all(
      `SELECT c.id, c.name, c.type, c.email, c.phone, c.note,
              (SELECT COUNT(*) FROM entries e WHERE e.contact_id = c.id) AS entries
       FROM contacts c WHERE c.user_id = ? ORDER BY lower(c.name)`,
      uid(req),
    );
    const owed = new Map();
    for (const d of await acc.listDebts(db, uid(req), { status: 'open' })) {
      if (!d.contact) continue;
      const cur = owed.get(d.contact.id) || { payable: 0, receivable: 0 };
      cur[d.kind] += d.remaining;
      owed.set(d.contact.id, cur);
    }
    res.json({ contacts: rows.map((c) => ({ ...c, ...(owed.get(c.id) || { payable: 0, receivable: 0 }) })) });
  });
  router.post('/contacts', async (req, res) => {
    const c = contactBody(req.body);
    const id = await db.insert('INSERT INTO contacts (user_id, name, type, email, phone, note, created_at) VALUES (?,?,?,?,?,?,?)', uid(req), c.name, c.type, c.email, c.phone, c.note, nowIso());
    res.status(201).json({ id });
  });
  router.patch('/contacts/:id', async (req, res) => {
    const row = await getContact(req);
    const c = contactBody(req.body);
    await db.run('UPDATE contacts SET name = ?, type = ?, email = ?, phone = ?, note = ? WHERE id = ?', c.name, c.type, c.email, c.phone, c.note, row.id);
    res.json({ ok: true });
  });
  router.delete('/contacts/:id', async (req, res) => {
    const row = await getContact(req);
    const open = (await acc.listDebts(db, uid(req), { status: 'open' })).some((d) => d.contact?.id === row.id);
    if (open) throw bad('Kontak ini masih punya utang/piutang yang belum lunas.');
    await db.run('DELETE FROM contacts WHERE id = ?', row.id);
    res.json({ ok: true });
  });

  // ── Utang & piutang ──
  router.get('/debts', async (req, res) => {
    const kind = req.query.kind ? v.oneOf(req.query.kind, ['payable', 'receivable'], 'Jenis') : undefined;
    const status = req.query.status ? v.oneOf(req.query.status, ['open', 'paid', 'all'], 'Status') : 'all';
    res.json({ debts: await acc.listDebts(db, uid(req), { today: today(req), kind, status }), totals: await acc.debtTotals(db, uid(req)) });
  });
  router.post('/debts', async (req, res) => res.status(201).json({ id: await acc.createDebt(db, uid(req), req.body) }));
  router.post('/debts/:id/payments', async (req, res) => res.status(201).json({ id: await acc.payDebt(db, uid(req), req.params.id, req.body) }));
  router.delete('/debts/:id', async (req, res) => { await acc.deleteDebt(db, uid(req), req.params.id); res.json({ ok: true }); });
  router.delete('/debts/:id/payments/:paymentId', async (req, res) => { await acc.deleteDebtPayment(db, uid(req), req.params.id, req.params.paymentId); res.json({ ok: true }); });

  // ── Anggaran bulanan ──
  router.get('/budgets', async (req, res) => res.json(await acc.budgetStatus(db, uid(req), String(req.query.month || today(req).slice(0, 7)))));
  router.put('/budgets/:accountId', async (req, res) => { await acc.setBudget(db, uid(req), req.params.accountId, req.body.amount); res.json({ ok: true }); });

  // ── Dasbor ──
  router.get('/dashboard', async (req, res) => {
    const t = today(req);
    const from = req.query.from ? v.date(req.query.from, 'Tanggal awal') : `${t.slice(0, 7)}-01`;
    const to = req.query.to ? v.date(req.query.to, 'Tanggal akhir') : t;
    if (from > to) throw bad('Tanggal awal tidak boleh setelah tanggal akhir.');
    const pfrom = v.date(req.query.pfrom, 'Tanggal pembanding', { optional: true });
    const pto = v.date(req.query.pto, 'Tanggal pembanding', { optional: true });
    res.json(await acc.dashboard(db, uid(req), { from, to, pfrom, pto, today: t }));
  });

  // ── Laporan keuangan ──
  async function buildReport(name, req) {
    const t = today(req);
    const to = req.query.to ? v.date(req.query.to, 'Tanggal akhir') : t;
    const from = req.query.from ? v.date(req.query.from, 'Tanggal awal') : `${to.slice(0, 4)}-01-01`;
    if (from > to) throw bad('Tanggal awal tidak boleh setelah tanggal akhir.');
    const id = uid(req);
    switch (name) {
      case 'journal': return await acc.journalReport(db, id, { from, to });
      case 'ledger': return await acc.ledgerReport(db, id, { from, to, accountId: v.id(req.query.accountId, 'Akun', { optional: true }) });
      case 'trial-balance': return await acc.trialBalance(db, id, { to });
      case 'income-statement': return await acc.incomeStatement(db, id, { from, to });
      case 'balance-sheet': return await acc.balanceSheet(db, id, { to });
      case 'equity': return await acc.equityStatement(db, id, { from, to });
      case 'cash-flow': return await acc.cashFlow(db, id, { from, to });
      case 'debts': return await acc.debtReport(db, id, { today: t });
      default: throw notFound('Laporan tidak ditemukan.');
    }
  }

  router.get('/reports/:name', async (req, res) => res.json(await buildReport(req.params.name, req)));

  router.get('/reports/:name/export', async (req, res) => {
    const name = req.params.name;
    if (!REPORT_NAMES[name]) throw notFound('Laporan tidak ditemukan.');
    const sheet = reportSheet(name, await buildReport(name, req), { owner: req.user.business_name || req.user.name });
    const file = buildXlsx(sheet);
    const stamp = (req.query.to || today(req)).replace(/[^0-9-]/g, '');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${stamp}.xlsx"`);
    res.send(file);
  });

  // ── Cadangan data (unduh semua data milik sendiri) ──
  router.get('/backup', async (req, res) => {
    const id = uid(req);
    const data = {
      exportedAt: nowIso(),
      profile: { name: req.user.name, email: req.user.email, businessName: req.user.business_name, usage: req.user.usage },
      accounts: await db.all('SELECT id, code, name, type, subtype, archived FROM accounts WHERE user_id = ? ORDER BY code', id),
      contacts: await db.all('SELECT id, name, type, email, phone, note FROM contacts WHERE user_id = ?', id),
      entries: (await acc.listEntries(db, id, { limit: 100000, order: 'ASC' })).items,
      debts: await acc.listDebts(db, id, {}),
      budgets: await db.all('SELECT account_id AS "accountId", amount FROM budgets WHERE user_id = ?', id),
    };
    res.setHeader('Content-Disposition', `attachment; filename="budget-tracker-cadangan-${today(req)}.json"`);
    res.json(data);
  });

  return router;
}
