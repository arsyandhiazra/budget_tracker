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

const CODE_COPY = {
  verify: {
    subject: (code) => `${code} adalah kode verifikasi Budget Tracker kamu`,
    intro: 'Terima kasih sudah mendaftar di Budget Tracker. Masukkan kode ini untuk mengaktifkan akunmu:',
    outro: 'Kalau kamu tidak merasa mendaftar, abaikan saja email ini.',
  },
  reset: {
    subject: (code) => `${code} adalah kode atur ulang kata sandi`,
    intro: 'Kami menerima permintaan untuk mengatur ulang kata sandi akunmu. Masukkan kode ini:',
    outro: 'Kalau kamu tidak meminta ini, abaikan saja email ini. Kata sandimu tidak berubah.',
  },
  email_change: {
    subject: (code) => `${code} adalah kode untuk memakai email ini di Budget Tracker`,
    intro: 'Ada permintaan untuk memakai alamat email ini sebagai email akun Budget Tracker. Masukkan kode ini untuk memastikan alamat ini milikmu:',
    outro: 'Kalau kamu tidak meminta ini, abaikan saja email ini. Tidak ada yang berubah sebelum kode dimasukkan.',
  },
};

const maskEmail = (email) => {
  const [local, domain] = String(email).split('@');
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(local.length - 1, 2))}@${domain}`;
};

// Dikirim ke alamat LAMA setelah email akun diganti.
export function emailChangedEmail({ name, newEmail }) {
  const masked = maskEmail(newEmail);
  const subject = 'Alamat email akun Budget Tracker kamu diganti';
  const text = `Halo ${name},\n\nAlamat email akun Budget Tracker kamu baru saja diganti menjadi ${masked}. Mulai sekarang, masuk dan kode verifikasi memakai alamat baru itu.\n\nKalau kamu yang melakukannya, tidak perlu berbuat apa-apa.\nKalau BUKAN kamu, segera hubungi pengelola aplikasi ini.\n\n— Budget Tracker`;
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#1a1a19">
  <p>Halo ${escapeHtml(name)},</p>
  <p>Alamat email akun Budget Tracker kamu baru saja diganti menjadi <strong>${escapeHtml(masked)}</strong>. Mulai sekarang, masuk dan kode verifikasi memakai alamat baru itu.</p>
  <p>Kalau kamu yang melakukannya, tidak perlu berbuat apa-apa. Kalau <strong>bukan</strong> kamu, segera hubungi pengelola aplikasi ini.</p>
  <p style="color:#6b6a65">— Budget Tracker</p>
</div>`;
  return { subject, text, html };
}

export function codeEmail({ name, code, purpose, minutes }) {
  const copy = CODE_COPY[purpose] || CODE_COPY.verify;
  const subject = copy.subject(code);
  const intro = copy.intro;
  const outro = copy.outro;
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

const ROLE_TEXT = { editor: 'Pencatat (bisa mencatat dan mengubah data)', viewer: 'Pelihat (hanya bisa melihat)' };

export function inviteEmail({ inviterName, bookName, role, url, days }) {
  const subject = `${inviterName} mengundangmu ke pembukuan "${bookName}"`;
  const text = `Halo,\n\n${inviterName} mengundangmu untuk bergabung di pembukuan "${bookName}" di Budget Tracker.\nPeranmu: ${ROLE_TEXT[role] || role}.\n\nCara bergabung:\n1. Buka ${url}\n2. Masuk, atau daftar dulu memakai alamat email ini.\n3. Terima undangannya di bagian atas halaman.\n\nUndangan berlaku ${days} hari. Kalau kamu tidak mengenal pengirimnya, abaikan saja email ini.\n\n— Budget Tracker`;
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#1a1a19">
  <p>Halo,</p>
  <p><strong>${escapeHtml(inviterName)}</strong> mengundangmu untuk bergabung di pembukuan <strong>${escapeHtml(bookName)}</strong>.</p>
  <p>Peranmu: <strong>${escapeHtml(ROLE_TEXT[role] || role)}</strong></p>
  <p><a href="${escapeHtml(url)}" style="display:inline-block;background:#171716;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:600">Buka Budget Tracker</a></p>
  <p style="color:#6b6a65">Masuk (atau daftar dulu) memakai alamat email ini, lalu terima undangannya di bagian atas halaman. Berlaku ${days} hari.</p>
  <p style="color:#6b6a65">Kalau kamu tidak mengenal pengirimnya, abaikan saja email ini.</p>
</div>`;
  return { subject, text, html };
}
