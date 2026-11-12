// Titik mulai server. Jalankan dengan: npm start
// (Di Vercel yang dipakai api/index.js, bukan file ini.)
import { loadConfig } from './config.js';
import { openDbFromConfig, describeDb } from './db.js';
import { createMailer } from './mailer.js';
import { createApp } from './app.js';

const config = loadConfig();
let db;
try {
  db = await openDbFromConfig(config);
} catch (err) {
  console.error(`\nDatabase tidak bisa dibuka: ${err.message}\n`);
  process.exit(1);
}
const mailer = createMailer(config);
const app = createApp({ db, config, mailer });

const server = app.listen(config.port, config.host, () => {
  console.log(`\n  Budget Tracker jalan di ${config.appUrl}\n`);
  console.log(`  • Email   : ${mailer.configured ? `terkirim lewat ${config.smtp.host}` : 'mode percobaan (kode verifikasi muncul di layar & terminal ini)'}`);
  console.log(`  • Chatbot : ${config.ai.enabled ? `AI aktif (${config.ai.provider}, model ${config.ai.model})` : 'mode dasar (isi AI_PROVIDER & AI_API_KEY di .env untuk mengaktifkan AI)'}`);
  console.log(`  • Data    : ${describeDb(config)}\n`);
  if (config.production && !mailer.configured) {
    console.warn('  PERINGATAN: mode production tapi SMTP belum diatur. Pengguna baru tidak akan menerima kode verifikasi.\n');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${config.port} sedang dipakai program lain. Ganti PORT di file .env, atau tutup program itu dulu.`);
  else console.error(err);
  process.exit(1);
});

function shutdown() {
  server.close(async () => {
    await db.close().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
