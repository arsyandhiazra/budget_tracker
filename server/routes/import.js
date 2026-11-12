// Alamat (endpoint) impor transaksi dari Excel/CSV. File dikirim apa adanya (bukan JSON).
import express from 'express';
import { HttpError, bad } from '../http.js';
import { previewImport, commitImport, templateFile } from '../import.js';

export function createImport({ db, limiter }) {
  const router = express.Router();
  const uid = (req) => req.book.id;
  const upload = express.raw({ type: () => true, limit: '3mb' });
  const flag = (value) => value === '1' || value === 'true';
  const options = (req) => ({
    createCategories: flag(req.query.createCategories),
    defaultWalletId: req.query.defaultWalletId ? Number(req.query.defaultWalletId) : null,
    includeDuplicates: req.query.duplicates === 'include',
    skipErrors: flag(req.query.skipErrors),
  });
  const fileOf = (req) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('File belum dipilih.');
    return req.body;
  };
  async function limit(req) {
    const r = await limiter.hit(`import:${uid(req)}`, 60, 60 * 60_000);
    if (!r.ok) throw new HttpError(429, 'Terlalu banyak percobaan impor. Coba lagi nanti.', 'RATE_LIMITED', { retryAfter: r.retryAfter });
  }

  router.get('/import/template', async (req, res) => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="template-impor-transaksi.xlsx"');
    res.send(await templateFile(db, uid(req)));
  });

  router.post('/import/preview', upload, async (req, res) => {
    await limit(req);
    res.json(await previewImport(db, uid(req), fileOf(req), options(req)));
  });

  router.post('/import/commit', upload, async (req, res) => {
    await limit(req);
    res.status(201).json(await commitImport(db, uid(req), fileOf(req), options(req), req.user.id));
  });

  return router;
}
