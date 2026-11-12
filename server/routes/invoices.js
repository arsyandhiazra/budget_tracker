// Alamat (endpoint) untuk faktur. Pembayarannya memakai pelunasan piutang di menu Utang & Piutang.
import express from 'express';
import { v, todayIn } from '../http.js';
import * as inv from '../invoices.js';

export function createInvoices({ db, config }) {
  const router = express.Router();
  const uid = (req) => req.book.id;
  const today = (req) => (req.query.today && /^\d{4}-\d{2}-\d{2}$/.test(req.query.today) ? v.date(req.query.today) : todayIn(config.timezone));

  router.get('/invoices', async (req, res) => {
    const status = req.query.status ? v.oneOf(req.query.status, ['all', 'open', 'unpaid', 'partial', 'overdue', 'paid'], 'Status') : 'all';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
    res.json(await inv.listInvoices(db, uid(req), { today: today(req), status, q }));
  });

  router.get('/invoices/next-number', async (req, res) => {
    res.json({ number: await inv.nextNumberFor(db, uid(req), req.query.date || today(req)) });
  });

  // Satu faktur lengkap, termasuk data penjual (kop) untuk dicetak.
  router.get('/invoices/:id', async (req, res) => {
    const b = req.book;
    res.json({
      invoice: await inv.getInvoice(db, uid(req), req.params.id, today(req)),
      seller: { name: b.name || `Pembukuan ${b.ownerName}`, address: b.address, phone: b.phone, paymentInfo: b.paymentInfo },
    });
  });

  router.post('/invoices', async (req, res) => res.status(201).json({ id: await inv.createInvoice(db, uid(req), req.body, req.user.id) }));
  router.patch('/invoices/:id', async (req, res) => { await inv.updateInvoice(db, uid(req), req.params.id, req.body); res.json({ ok: true }); });
  router.delete('/invoices/:id', async (req, res) => { await inv.deleteInvoice(db, uid(req), req.params.id); res.json({ ok: true }); });
  router.post('/invoices/:id/payments', async (req, res) => res.status(201).json({ id: await inv.payInvoice(db, uid(req), req.params.id, req.body, req.user.id) }));

  return router;
}
