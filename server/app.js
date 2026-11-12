// Merakit server: pengaman, rute API, dan penyajian tampilan (folder dist).
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { HttpError } from './http.js';
import { RateLimiter } from './security.js';
import { createAuth } from './routes/auth.js';
import { createApi } from './routes/api.js';
import { createChat } from './routes/chat.js';

export function createApp({ db, config, mailer, fetchImpl = fetch }) {
  const app = express();
  const limiter = new RateLimiter(db);
  app.locals.limiter = limiter;
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  // Header pengaman dasar untuk setiap jawaban.
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  });

  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));
  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    // Permintaan tanpa isi (atau isinya bukan objek) diperlakukan sebagai objek kosong,
    // supaya ditolak dengan pesan "wajib diisi" yang jelas, bukan error server.
    if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
    // Penangkal CSRF: permintaan yang mengubah data wajib membawa header khusus.
    // Situs lain tidak bisa menambahkan header ini ke permintaan lintas-situs.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'BudgetTracker') {
      throw new HttpError(403, 'Permintaan ditolak.', 'CSRF');
    }
    next();
  });

  const auth = createAuth({ db, config, mailer, limiter });
  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.use('/auth', auth.router);
  api.use(auth.requireAuth, auth.requireOnboarded);
  api.use(createApi({ db, config }));
  api.use(createChat({ db, config, limiter, fetchImpl }));
  api.use((_req, _res) => { throw new HttpError(404, 'Alamat tidak ditemukan.', 'NOT_FOUND'); });
  app.use('/api', api);

  // Tampilan (hasil "npm run build").
  const indexFile = path.join(config.distDir, 'index.html');
  if (fs.existsSync(indexFile)) {
    app.use('/assets', express.static(path.join(config.distDir, 'assets'), { immutable: true, maxAge: '365d', fallthrough: false }));
    app.use(express.static(config.distDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexFile);
    });
  } else {
    app.get('/', (_req, res) => res.type('text/plain').send('Server API jalan, tapi tampilan belum dibuat. Jalankan "npm run build" lalu mulai ulang server.'));
  }

  // Penanganan error terpusat.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) {
      if (err.extra?.retryAfter) res.setHeader('Retry-After', String(err.extra.retryAfter));
      return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.extra || {}) } });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'INVALID', message: 'Data yang dikirim tidak bisa dibaca.' } });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Data yang dikirim terlalu besar.' } });
    // Dua permintaan yang bentrok (mis. daftar dengan email yang sama bersamaan).
    if (err?.code === '23505') return res.status(409).json({ error: { code: 'CONFLICT', message: 'Data ini sudah ada atau baru saja diubah. Muat ulang lalu coba lagi.' } });
    if (err?.status === 404) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tidak ditemukan.' } });
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
    return res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Terjadi kesalahan di server. Coba lagi sebentar lagi.' } });
  });

  return app;
}
