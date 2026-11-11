// Alur akun: daftar → verifikasi email → masuk → pengaturan awal.
// Juga: lupa kata sandi, ganti kata sandi, ubah profil, hapus akun.
import express from 'express';
import { HttpError, bad, v } from '../http.js';
import { nowIso } from '../db.js';
import { hashPassword, verifyPassword, fakePasswordCheck, sha256, newToken, newCode, safeEqual, parseCookies } from '../security.js';
import { codeEmail } from '../mailer.js';
import { seedAccounts, createEntry, roleAccount } from '../accounting.js';

export const COOKIE = 'bt_session';
const CODE_MINUTES = 15;
const RESEND_SECONDS = 60;
const MAX_CODE_TRIES = 5;

export const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  businessName: u.business_name,
  usage: u.usage,
  onboarded: Boolean(u.onboarded_at),
  createdAt: u.created_at,
});

export function createAuth({ db, config, mailer, limiter }) {
  const router = express.Router();
  const clientIp = (req) => req.ip || 'unknown';

  function limit(key, max, windowMs) {
    const r = limiter.hit(key, max, windowMs);
    if (!r.ok) {
      const minutes = Math.ceil(r.retryAfter / 60);
      throw new HttpError(429, `Terlalu banyak percobaan. Coba lagi ${r.retryAfter < 90 ? `dalam ${r.retryAfter} detik` : `sekitar ${minutes} menit lagi`}.`, 'RATE_LIMITED', { retryAfter: r.retryAfter });
    }
  }

  // ── Sesi login ──
  function cookieString(req, value, maxAge) {
    const secure = req.secure || process.env.COOKIE_SECURE === '1';
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }

  function startSession(req, res, user) {
    const token = newToken();
    const expires = new Date(Date.now() + config.sessionDays * 86_400_000).toISOString();
    db.run('INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, created_at) VALUES (?,?,?,?,?)', user.id, sha256(token), expires, String(req.headers['user-agent'] || '').slice(0, 200), nowIso());
    db.run('DELETE FROM sessions WHERE expires_at < ?', nowIso());
    res.setHeader('Set-Cookie', cookieString(req, token, config.sessionDays * 86_400));
  }

  function currentSession(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const row = db.get('SELECT s.id AS session_id, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?', sha256(token));
    if (!row || row.expires_at < nowIso()) return null;
    return row;
  }

  function requireAuth(req, _res, next) {
    const user = currentSession(req);
    if (!user) throw new HttpError(401, 'Sesi kamu sudah habis. Silakan masuk lagi.', 'UNAUTHENTICATED');
    req.user = user;
    next();
  }

  function requireOnboarded(req, _res, next) {
    if (!req.user.onboarded_at) throw new HttpError(409, 'Selesaikan pengaturan awal dulu ya.', 'ONBOARDING_REQUIRED');
    next();
  }

  // ── Kode lewat email ──
  const codeHash = (user, purpose, code) => sha256(`${user.id}:${purpose}:${code}`);

  function secondsSinceLastCode(user, purpose) {
    const last = db.get('SELECT created_at FROM email_codes WHERE user_id = ? AND purpose = ? ORDER BY id DESC LIMIT 1', user.id, purpose);
    return last ? (Date.now() - Date.parse(last.created_at)) / 1000 : Infinity;
  }

  async function issueCode(user, purpose) {
    const code = newCode();
    const now = nowIso();
    db.run('UPDATE email_codes SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL', now, user.id, purpose);
    db.run('INSERT INTO email_codes (user_id, purpose, code_hash, expires_at, created_at) VALUES (?,?,?,?,?)', user.id, purpose, codeHash(user, purpose, code), new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(), now);
    try {
      await mailer.send({ to: user.email, ...codeEmail({ name: user.name, code, purpose, minutes: CODE_MINUTES }) });
    } catch (err) {
      console.error('Gagal mengirim email:', err.message);
      throw new HttpError(502, 'Email tidak berhasil dikirim. Coba lagi sebentar lagi.', 'MAIL_FAILED');
    }
    // Mode percobaan (belum ada SMTP & bukan production): kode ikut dikembalikan
    // supaya aplikasi bisa dicoba di laptop tanpa email sungguhan.
    return !mailer.configured && !config.production ? code : undefined;
  }

  function consumeCode(user, purpose, code) {
    const row = db.get('SELECT * FROM email_codes WHERE user_id = ? AND purpose = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1', user.id, purpose);
    if (!row || row.expires_at < nowIso()) throw new HttpError(400, 'Kode sudah tidak berlaku. Minta kode baru ya.', 'CODE_EXPIRED');
    if (row.attempts >= MAX_CODE_TRIES) throw new HttpError(429, 'Kode ini sudah terlalu sering dicoba. Minta kode baru ya.', 'CODE_LOCKED');
    if (!safeEqual(row.code_hash, codeHash(user, purpose, code))) {
      db.run('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
      throw new HttpError(400, 'Kode belum cocok. Coba periksa lagi.', 'CODE_WRONG');
    }
    db.run('UPDATE email_codes SET used_at = ? WHERE id = ?', nowIso(), row.id);
  }

  const readCode = (value) => {
    const code = String(value ?? '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) throw bad('Kode terdiri dari 6 angka.');
    return code;
  };
  const findUser = (email) => db.get('SELECT * FROM users WHERE email = ?', email);

  // ── Daftar ──
  router.post('/register', async (req, res) => {
    limit(`register:${clientIp(req)}`, 10, 60 * 60_000);
    const name = v.str(req.body.name, 'Nama', { min: 2, max: 80 });
    const email = v.email(req.body.email);
    const password = v.password(req.body.password);
    const existing = findUser(email);
    if (existing?.email_verified_at) throw new HttpError(409, 'Email ini sudah terdaftar. Silakan masuk.', 'EMAIL_TAKEN');

    const hash = await hashPassword(password);
    let user;
    if (existing) {
      db.run('UPDATE users SET name = ?, password_hash = ? WHERE id = ?', name, hash, existing.id);
      user = { ...existing, name };
    } else {
      const r = db.run('INSERT INTO users (email, name, password_hash, created_at) VALUES (?,?,?,?)', email, name, hash, nowIso());
      user = { id: Number(r.lastInsertRowid), email, name };
    }
    let devCode;
    if (secondsSinceLastCode(user, 'verify') >= RESEND_SECONDS) devCode = await issueCode(user, 'verify');
    res.status(201).json({ ok: true, email, devCode });
  });

  // ── Verifikasi email ──
  router.post('/verify', async (req, res) => {
    limit(`verify:${clientIp(req)}`, 30, 10 * 60_000);
    const email = v.email(req.body.email);
    const code = readCode(req.body.code);
    const user = findUser(email);
    if (!user) throw new HttpError(400, 'Kode belum cocok. Coba periksa lagi.', 'CODE_WRONG');
    if (user.email_verified_at) throw new HttpError(400, 'Akun ini sudah aktif. Silakan masuk.', 'ALREADY_VERIFIED');
    consumeCode(user, 'verify', code);
    db.run('UPDATE users SET email_verified_at = ? WHERE id = ?', nowIso(), user.id);
    startSession(req, res, user);
    res.json({ user: publicUser(findUser(email)) });
  });

  router.post('/resend', async (req, res) => {
    limit(`resend:${clientIp(req)}`, 10, 60 * 60_000);
    const email = v.email(req.body.email);
    const user = findUser(email);
    let devCode;
    if (user && !user.email_verified_at) {
      const wait = RESEND_SECONDS - secondsSinceLastCode(user, 'verify');
      if (wait > 0) throw new HttpError(429, `Tunggu ${Math.ceil(wait)} detik lagi sebelum minta kode baru.`, 'RATE_LIMITED', { retryAfter: Math.ceil(wait) });
      devCode = await issueCode(user, 'verify');
    }
    res.json({ ok: true, devCode });
  });

  // ── Masuk & keluar ──
  router.post('/login', async (req, res) => {
    const email = v.email(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : '';
    limit(`login-ip:${clientIp(req)}`, 40, 15 * 60_000);
    const key = `login:${email}`;
    limit(key, 8, 15 * 60_000);

    const user = findUser(email);
    const wrong = new HttpError(401, 'Email atau kata sandi salah.', 'BAD_CREDENTIALS');
    if (!user) {
      await fakePasswordCheck(password);
      throw wrong;
    }
    if (!(await verifyPassword(password, user.password_hash))) throw wrong;
    if (!user.email_verified_at) {
      let devCode;
      if (secondsSinceLastCode(user, 'verify') >= RESEND_SECONDS) devCode = await issueCode(user, 'verify');
      throw new HttpError(403, 'Email kamu belum diverifikasi. Masukkan kode yang kami kirim ke emailmu.', 'EMAIL_NOT_VERIFIED', { email, devCode });
    }
    limiter.reset(key);
    startSession(req, res, user);
    res.json({ user: publicUser(user) });
  });

  router.post('/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    res.setHeader('Set-Cookie', cookieString(req, '', 0));
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    const user = currentSession(req);
    res.json({ user: user ? publicUser(user) : null, mailMode: mailer.configured ? 'smtp' : 'console' });
  });

  // ── Lupa kata sandi ──
  router.post('/forgot', async (req, res) => {
    limit(`forgot:${clientIp(req)}`, 8, 60 * 60_000);
    const email = v.email(req.body.email);
    const user = findUser(email);
    let devCode;
    // Jawaban selalu sama, terdaftar atau tidak, supaya tidak membocorkan siapa yang punya akun.
    if (user?.email_verified_at && secondsSinceLastCode(user, 'reset') >= RESEND_SECONDS) {
      devCode = await issueCode(user, 'reset');
    }
    res.json({ ok: true, devCode });
  });

  router.post('/reset', async (req, res) => {
    limit(`reset:${clientIp(req)}`, 30, 10 * 60_000);
    const email = v.email(req.body.email);
    const code = readCode(req.body.code);
    const password = v.password(req.body.password, 'Kata sandi baru');
    const user = findUser(email);
    if (!user) throw new HttpError(400, 'Kode belum cocok. Coba periksa lagi.', 'CODE_WRONG');
    consumeCode(user, 'reset', code);
    const hash = await hashPassword(password);
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, user.id);
    db.run('DELETE FROM sessions WHERE user_id = ?', user.id); // semua perangkat dikeluarkan
    res.json({ ok: true });
  });

  // ── Pengaturan awal (sekali saja setelah akun aktif) ──
  router.post('/onboarding', requireAuth, (req, res) => {
    const user = req.user;
    if (user.onboarded_at) throw bad('Pengaturan awal sudah pernah diselesaikan.');
    const usage = v.oneOf(req.body.usage, ['pribadi', 'usaha'], 'Pilihan penggunaan');
    const businessName = v.str(req.body.businessName, 'Nama pembukuan', { max: 80, optional: true }) || (usage === 'usaha' ? `Usaha ${user.name}` : `Keuangan ${user.name}`);
    const openingCash = v.amount(req.body.openingCash ?? 0, 'Saldo kas', { allowZero: true });
    const openingBank = v.amount(req.body.openingBank ?? 0, 'Saldo bank', { allowZero: true });
    const date = v.date(req.body.date);

    db.tx(() => {
      seedAccounts(db, user.id, usage);
      const lines = [];
      if (openingCash > 0) lines.push({ accountId: roleAccount(db, user.id, 'cash').id, debit: openingCash, credit: 0 });
      if (openingBank > 0) lines.push({ accountId: roleAccount(db, user.id, 'bank').id, debit: openingBank, credit: 0 });
      if (lines.length) {
        lines.push({ accountId: roleAccount(db, user.id, 'capital').id, debit: 0, credit: openingCash + openingBank });
        createEntry(db, user.id, { date, description: 'Saldo awal', kind: 'opening', lines });
      }
      db.run('UPDATE users SET usage = ?, business_name = ?, onboarded_at = ? WHERE id = ?', usage, businessName, nowIso(), user.id);
    });
    res.json({ user: publicUser(db.get('SELECT * FROM users WHERE id = ?', user.id)) });
  });

  // ── Profil & keamanan akun ──
  router.patch('/profile', requireAuth, (req, res) => {
    const name = v.str(req.body.name, 'Nama', { min: 2, max: 80 });
    const businessName = v.str(req.body.businessName, 'Nama pembukuan', { max: 80, optional: true });
    db.run('UPDATE users SET name = ?, business_name = ? WHERE id = ?', name, businessName ?? req.user.business_name, req.user.id);
    res.json({ user: publicUser(db.get('SELECT * FROM users WHERE id = ?', req.user.id)) });
  });

  router.post('/change-password', requireAuth, async (req, res) => {
    limit(`chpass:${req.user.id}`, 10, 15 * 60_000);
    const current = typeof req.body.current === 'string' ? req.body.current : '';
    const next = v.password(req.body.next, 'Kata sandi baru');
    if (!(await verifyPassword(current, req.user.password_hash))) throw new HttpError(400, 'Kata sandi saat ini salah.', 'BAD_CREDENTIALS');
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(next), req.user.id);
    db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', req.user.id, req.user.session_id); // perangkat lain dikeluarkan
    res.json({ ok: true });
  });

  router.delete('/account', requireAuth, async (req, res) => {
    limit(`delacc:${req.user.id}`, 10, 15 * 60_000);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!(await verifyPassword(password, req.user.password_hash))) throw new HttpError(400, 'Kata sandi salah.', 'BAD_CREDENTIALS');
    const id = req.user.id;
    db.tx(() => {
      db.run('DELETE FROM entries WHERE user_id = ?', id); // baris jurnal, utang, pembayaran ikut terhapus
      db.run('DELETE FROM budgets WHERE user_id = ?', id);
      db.run('DELETE FROM accounts WHERE user_id = ?', id);
      db.run('DELETE FROM users WHERE id = ?', id); // sesi, kode, kontak, chat ikut terhapus
    });
    res.setHeader('Set-Cookie', cookieString(req, '', 0));
    res.json({ ok: true });
  });

  return { router, requireAuth, requireOnboarded };
}
