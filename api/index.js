// Pintu masuk untuk Vercel (serverless). Semua alamat /api/* diarahkan ke sini
// oleh vercel.json. Tampilan (folder dist) disajikan langsung oleh Vercel.
import { loadConfig } from '../server/config.js';
import { openDbFromConfig } from '../server/db.js';
import { createMailer } from '../server/mailer.js';
import { createApp } from '../server/app.js';

// Database dibuka sekali per server sementara, lalu dipakai ulang oleh permintaan berikutnya.
// Kalau gagal (mis. DATABASE_URL belum diisi), percobaan berikutnya mengulang dari awal.
let ready;
function init() {
  const config = loadConfig({ quiet: true });
  return openDbFromConfig(config, { max: 3 }).then((db) => createApp({ db, config, mailer: createMailer(config) }));
}

export default async function handler(req, res) {
  try {
    ready ??= init();
    const app = await ready;
    return app(req, res);
  } catch (err) {
    ready = undefined;
    console.error('Gagal menyalakan aplikasi:', err.message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'SERVER_NOT_READY', message: 'Server belum siap (database belum tersambung). Coba lagi sebentar lagi.' } }));
  }
}
