// Pengirim email. Kalau SMTP belum diatur di .env, email tidak benar-benar
// dikirim: isinya ditampilkan di terminal supaya tetap bisa dicoba di laptop.
import nodemailer from 'nodemailer';

export function createMailer(config) {
  const { smtp } = config;
  if (!smtp.host && config.production) {
    // Di production, kode verifikasi tidak boleh ditulis ke log server. Lebih baik gagal
    // dengan jelas daripada pengguna menunggu email yang tidak pernah datang.
    return {
      configured: false,
      async send() {
        throw new Error('SMTP belum diatur di server (isi SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM).');
      },
    };
  }
  if (!smtp.host) {
    return {
      configured: false,
      async send({ to, subject, text }) {
        console.log(`\n──────── EMAIL (mode percobaan, tidak dikirim) ────────\nUntuk  : ${to}\nJudul  : ${subject}\n\n${text}\n────────────────────────────────────────────────────────\n`);
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  return {
    configured: true,
    async send({ to, subject, text, html }) {
      await transport.sendMail({ from: smtp.from, to, subject, text, html });
    },
  };
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function codeEmail({ name, code, purpose, minutes }) {
  const verify = purpose === 'verify';
  const subject = verify ? `${code} adalah kode verifikasi Budget Tracker kamu` : `${code} adalah kode atur ulang kata sandi`;
  const intro = verify
    ? 'Terima kasih sudah mendaftar di Budget Tracker. Masukkan kode ini untuk mengaktifkan akunmu:'
    : 'Kami menerima permintaan untuk mengatur ulang kata sandi akunmu. Masukkan kode ini:';
  const outro = verify
    ? 'Kalau kamu tidak merasa mendaftar, abaikan saja email ini.'
    : 'Kalau kamu tidak meminta ini, abaikan saja email ini. Kata sandimu tidak berubah.';
  const text = `Halo ${name},\n\n${intro}\n\n    ${code}\n\nKode berlaku ${minutes} menit. Jangan bagikan kode ini ke siapa pun.\n\n${outro}\n\n— Budget Tracker`;
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#1a1a19">
  <p>Halo ${escapeHtml(name)},</p>
  <p>${intro}</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f5f4ef;padding:16px;border-radius:12px;text-align:center">${code}</p>
  <p>Kode berlaku ${minutes} menit. Jangan bagikan kode ini ke siapa pun.</p>
  <p style="color:#6b6a65">${outro}</p>
  <p style="color:#6b6a65">— Budget Tracker</p>
</div>`;
  return { subject, text, html };
}
