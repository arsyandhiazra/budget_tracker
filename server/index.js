// Titik mulai server. Jalankan dengan: npm start
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createMailer } from './mailer.js';
import { createApp } from './app.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const mailer = createMailer(config);
const app = createApp({ db, config, mailer });

const server = app.listen(config.port, config.host, () => {
  console.log(`\n  Budget Tracker jalan di ${config.appUrl}\n`);
  console.log(`  • Email   : ${mailer.configured ? `terkirim lewat ${config.smtp.host}` : 'mode percobaan (kode verifikasi muncul di layar & terminal ini)'}`);
  console.log(`  • Chatbot : ${config.ai.enabled ? `AI aktif (${config.ai.provider}, model ${config.ai.model})` : 'mode dasar (isi AI_PROVIDER & AI_API_KEY di .env untuk mengaktifkan AI)'}`);
  console.log(`  • Data    : ${config.dbPath}\n`);
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
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
