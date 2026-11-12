// Alur akun: daftar → verifikasi email → masuk → pengaturan awal.
// Juga: lupa kata sandi, ganti kata sandi, ubah profil, hapus akun.
import express from 'express';
import { HttpError, bad, v } from '../http.js';
import { nowIso } from '../db.js';
import { hashPassword, verifyPassword, fakePasswordCheck, sha256, newToken, newCode, safeEqual, parseCookies } from '../security.js';
import { codeEmail, emailChangedEmail } from '../mailer.js';
import { seedAccounts, createEntry, roleAccount } from '../accounting.js';

export const COOKIE = 'bt_session';
const CODE_MINUTES = 15;
const RESEND_SECONDS = 60;
const MAX_CODE_TRIES = 5;

// "Pembukuan" (book) = sekumpulan data milik satu pemilik. id-nya selalu id si pemilik.
// role: 'owner' (pemilik), 'editor' (pencatat: boleh mencatat), 'viewer' (pelihat: hanya melihat).
const bookOf = (owner, role) => ({
  id: owner.id,
  role,
  name: owner.business_name,
  usage: owner.usage,
  onboarded: Boolean(owner.onboarded_at),
  ownerName: owner.name,
  address: owner.business_address,
  phone: owner.business_phone,
  paymentInfo: owner.payment_info,
});
export const ownBookOf = (u) => bookOf(u, 'owner');

// Yang dikirim ke tampilan. businessName/usage/onboarded mengikuti pembukuan yang sedang dibuka.
export const publicUser = (u, book = ownBookOf(u)) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  businessName: book.name,
  usage: book.usage,
  onboarded: book.onboarded,
  role: book.role,
  bookId: book.id,
  createdAt: u.created_at,
});

const INVITE_DAYS = 14;

export { INVITE_DAYS };

export function createAuth({ db, config, mailer, limiter }) {
  const router = express.Router();
  const clientIp = (req) => req.ip || 'unknown';

  async function limit(key, max, windowMs) {
    const r = await limiter.hit(key, max, windowMs);
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

  // Mengembalikan pembukuan yang dibuka sesi ini. Orang yang belum mengatur pembukuan sendiri
  // tapi sudah diundang ke pembukuan lain langsung dibawa ke pembukuan itu.
  async function startSession(req, res, user) {
    const token = newToken();
    const expires = new Date(Date.now() + config.sessionDays * 86_400_000).toISOString();
    let bookId = null;
    if (!user.onboarded_at) {
      const first = await db.get('SELECT m.book_id FROM memberships m JOIN users o ON o.id = m.book_id WHERE m.user_id = ? AND o.onboarded_at IS NOT NULL ORDER BY m.created_at LIMIT 1', user.id);
      bookId = first?.book_id ?? null;
    }
    await db.run('INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, created_at, book_id) VALUES (?,?,?,?,?,?)', user.id, sha256(token), expires, String(req.headers['user-agent'] || '').slice(0, 200), nowIso(), bookId);
    await db.run('DELETE FROM sessions WHERE expires_at < ?', nowIso());
    res.setHeader('Set-Cookie', cookieString(req, token, config.sessionDays * 86_400));
    return resolveBook({ ...user, active_book_id: bookId });
  }

  async function currentSession(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const row = await db.get('SELECT s.id AS session_id, s.expires_at, s.book_id AS active_book_id, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?', sha256(token));
    if (!row || row.expires_at < nowIso()) return null;
    return row;
  }

  // Pembukuan yang aktif untuk sesi ini. Kalau keanggotaannya sudah dicabut, kembali ke pembukuan sendiri.
  async function resolveBook(row) {
    if (row.active_book_id && row.active_book_id !== row.id) {
      const owner = await db.get('SELECT o.*, m.role AS member_role FROM memberships m JOIN users o ON o.id = m.book_id WHERE m.book_id = ? AND m.user_id = ?', row.active_book_id, row.id);
      if (owner?.onboarded_at) return bookOf(owner, owner.member_role);
    }
    return ownBookOf(row);
  }

  // Isi jawaban "siapa saya": akun, pembukuan yang bisa dibuka, dan undangan yang menunggu.
  async function sessionPayload(row) {
    const book = await resolveBook(row);
    const shared = await db.all(
      `SELECT o.id, o.name, o.business_name, m.role FROM memberships m JOIN users o ON o.id = m.book_id
       WHERE m.user_id = ? AND o.onboarded_at IS NOT NULL ORDER BY lower(COALESCE(o.business_name, o.name))`,
      row.id,
    );
    const invites = await db.all(
      `SELECT i.id, i.role, i.expires_at, o.name AS owner_name, o.business_name
       FROM invitations i JOIN users o ON o.id = i.book_id
       WHERE lower(i.email) = lower(?) AND i.expires_at > ? ORDER BY i.created_at DESC`,
      row.email, nowIso(),
    );
    return {
      user: publicUser(row, book),
      books: [
        { id: row.id, name: row.business_name || 'Pembukuan saya', role: 'owner', own: true, ready: Boolean(row.onboarded_at) },
        ...shared.map((o) => ({ id: o.id, name: o.business_name || `Pembukuan ${o.name}`, ownerName: o.name, role: o.role, own: false, ready: true })),
      ],
      invitations: invites.map((i) => ({ id: i.id, role: i.role, bookName: i.business_name || `Pembukuan ${i.owner_name}`, ownerName: i.owner_name, expiresAt: i.expires_at })),
    };
  }

  async function requireAuth(req, _res, next) {
    const user = await currentSession(req);
    if (!user) throw new HttpError(401, 'Sesi kamu sudah habis. Silakan masuk lagi.', 'UNAUTHENTICATED');
    req.user = user; // orang yang sedang masuk
    req.book = await resolveBook(user); // pembukuan yang sedang dibuka (bisa milik orang lain)
    next();
  }

  function requireOnboarded(req, _res, next) {
    if (!req.book.onboarded) throw new HttpError(409, 'Selesaikan pengaturan awal dulu ya.', 'ONBOARDING_REQUIRED');
    next();
  }

  // Pelihat hanya boleh membaca.
  function requireWritable(req, _res, next) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.book.role === 'viewer') {
      throw new HttpError(403, 'Kamu hanya bisa melihat pembukuan ini, tidak bisa mengubahnya.', 'READ_ONLY');
    }
    next();
  }

  function requireOwner(req, _res, next) {
    if (req.book.role !== 'owner') throw new HttpError(403, 'Hanya pemilik pembukuan yang bisa melakukan ini.', 'OWNER_ONLY');
    next();
  }

  // ── Kode lewat email ──
  const codeHash = (user, purpose, code) => sha256(`${user.id}:${purpose}:${code}`);

  async function secondsSinceLastCode(user, purpose) {
    const last = await db.get('SELECT created_at FROM email_codes WHERE user_id = ? AND purpose = ? ORDER BY id DESC LIMIT 1', user.id, purpose);
    return last ? (Date.now() - Date.parse(last.created_at)) / 1000 : Infinity;
  }

  // newEmail: khusus ganti email, kode dikirim ke alamat BARU (membuktikan alamat itu milik orangnya).
  async function issueCode(user, purpose, { newEmail } = {}) {
    const code = newCode();
    const now = nowIso();
    await db.run('UPDATE email_codes SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL', now, user.id, purpose);
    await db.run('INSERT INTO email_codes (user_id, purpose, code_hash, expires_at, created_at, new_email) VALUES (?,?,?,?,?,?)', user.id, purpose, codeHash(user, purpose, code), new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(), now, newEmail ?? null);
    try {
      await mailer.send({ to: newEmail ?? user.email, ...codeEmail({ name: user.name, code, purpose, minutes: CODE_MINUTES }) });
    } catch (err) {
      console.error('Gagal mengirim email:', err.message);
      throw new HttpError(502, 'Email tidak berhasil dikirim. Coba lagi sebentar lagi.', 'MAIL_FAILED');
    }
    // Mode percobaan (belum ada SMTP & bukan production): kode ikut dikembalikan
    // supaya aplikasi bisa dicoba di laptop tanpa email sungguhan.
    return !mailer.configured && !config.production ? code : undefined;
  }

  async function consumeCode(user, purpose, code) {
    const row = await db.get('SELECT * FROM email_codes WHERE user_id = ? AND purpose = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1', user.id, purpose);
    if (!row || row.expires_at < nowIso()) throw new HttpError(400, 'Kode sudah tidak berlaku. Minta kode baru ya.', 'CODE_EXPIRED');
    if (row.attempts >= MAX_CODE_TRIES) throw new HttpError(429, 'Kode ini sudah terlalu sering dicoba. Minta kode baru ya.', 'CODE_LOCKED');
    if (!safeEqual(row.code_hash, codeHash(user, purpose, code))) {
      await db.run('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
      throw new HttpError(400, 'Kode belum cocok. Coba periksa lagi.', 'CODE_WRONG');
    }
    await db.run('UPDATE email_codes SET used_at = ? WHERE id = ?', nowIso(), row.id);
    return row;
  }

  const readCode = (value) => {
    const code = String(value ?? '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) throw bad('Kode terdiri dari 6 angka.');
    return code;
  };
  const findUser = (email) => db.get('SELECT * FROM users WHERE lower(email) = ?', email);

  // ── Daftar ──
  router.post('/register', async (req, res) => {
    await limit(`register:${clientIp(req)}`, 10, 60 * 60_000);
    const name = v.str(req.body.name, 'Nama', { min: 2, max: 80 });
    const email = v.email(req.body.email);
    const password = v.password(req.body.password);
    const existing = await findUser(email);
    if (existing?.email_verified_at) throw new HttpError(409, 'Email ini sudah terdaftar. Silakan masuk.', 'EMAIL_TAKEN');

    const hash = await hashPassword(password);
    let user;
    if (existing) {
      await db.run('UPDATE users SET name = ?, password_hash = ? WHERE id = ?', name, hash, existing.id);
      user = { ...existing, name };
    } else {
      const id = await db.insert('INSERT INTO users (email, name, password_hash, created_at) VALUES (?,?,?,?)', email, name, hash, nowIso());
      user = { id, email, name };
    }
    let devCode;
    if (await secondsSinceLastCode(user, 'verify') >= RESEND_SECONDS) devCode = await issueCode(user, 'verify');
    res.status(201).json({ ok: true, email, devCode });
  });

  // ── Verifikasi email ──
  router.post('/verify', async (req, res) => {
    await limit(`verify:${clientIp(req)}`, 30, 10 * 60_000);
    const email = v.email(req.body.email);
    const code = readCode(req.body.code);
    const user = await findUser(email);
    if (!user) throw new HttpError(400, 'Kode belum cocok. Coba periksa lagi.', 'CODE_WRONG');
    if (user.email_verified_at) throw new HttpError(400, 'Akun ini sudah aktif. Silakan masuk.', 'ALREADY_VERIFIED');
    await consumeCode(user, 'verify', code);
    await db.run('UPDATE users SET email_verified_at = ? WHERE id = ?', nowIso(), user.id);
    const book = await startSession(req, res, user);
    res.json({ user: publicUser(await findUser(email), book) });
  });

  router.post('/resend', async (req, res) => {
    await limit(`resend:${clientIp(req)}`, 10, 60 * 60_000);
    const email = v.email(req.body.email);
    const user = await findUser(email);
    let devCode;
    if (user && !user.email_verified_at) {
      const wait = RESEND_SECONDS - await secondsSinceLastCode(user, 'verify');
      if (wait > 0) throw new HttpError(429, `Tunggu ${Math.ceil(wait)} detik lagi sebelum minta kode baru.`, 'RATE_LIMITED', { retryAfter: Math.ceil(wait) });
      devCode = await issueCode(user, 'verify');
    }
    res.json({ ok: true, devCode });
  });

  // ── Masuk & keluar ──
  router.post('/login', async (req, res) => {
    const email = v.email(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : '';
    await limit(`login-ip:${clientIp(req)}`, 40, 15 * 60_000);
    const key = `login:${email}`;
    await limit(key, 8, 15 * 60_000);

    const user = await findUser(email);
    const wrong = new HttpError(401, 'Email atau kata sandi salah.', 'BAD_CREDENTIALS');
    if (!user) {
      await fakePasswordCheck(password);
      throw wrong;
    }
    if (!(await verifyPassword(password, user.password_hash))) throw wrong;
    if (!user.email_verified_at) {
      let devCode;
      if (await secondsSinceLastCode(user, 'verify') >= RESEND_SECONDS) devCode = await issueCode(user, 'verify');
      throw new HttpError(403, 'Email kamu belum diverifikasi. Masukkan kode yang kami kirim ke emailmu.', 'EMAIL_NOT_VERIFIED', { email, devCode });
    }
    await limiter.reset(key);
    const book = await startSession(req, res, user);
    res.json({ user: publicUser(user, book) });
  });

  router.post('/logout', async (req, res) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    res.setHeader('Set-Cookie', cookieString(req, '', 0));
    res.json({ ok: true });
  });

  router.get('/me', async (req, res) => {
    const user = await currentSession(req);
    const mailMode = mailer.configured ? 'smtp' : 'console';
    res.json(user ? { ...(await sessionPayload(user)), mailMode } : { user: null, books: [], invitations: [], mailMode });
  });

  // ── Pindah pembukuan, undangan, dan keluar dari pembukuan orang lain ──
  router.post('/book', requireAuth, async (req, res) => {
    const target = v.id(req.body.bookId, 'Pembukuan');
    if (target === req.user.id) {
      await db.run('UPDATE sessions SET book_id = NULL WHERE id = ?', req.user.session_id);
    } else {
      const m = await db.get('SELECT 1 AS x FROM memberships m JOIN users o ON o.id = m.book_id WHERE m.book_id = ? AND m.user_id = ? AND o.onboarded_at IS NOT NULL', target, req.user.id);
      if (!m) throw new HttpError(403, 'Kamu tidak punya akses ke pembukuan itu.', 'FORBIDDEN');
      await db.run('UPDATE sessions SET book_id = ? WHERE id = ?', target, req.user.session_id);
    }
    res.json({ ...(await sessionPayload(await currentSession(req))), mailMode: mailer.configured ? 'smtp' : 'console' });
  });

  async function myInvitation(req) {
    const inv = await db.get('SELECT * FROM invitations WHERE id = ?', v.id(req.params.id));
    // Undangan hanya berlaku untuk pemilik email yang diundang (emailnya sudah diverifikasi saat daftar).
    if (!inv || inv.email.toLowerCase() !== req.user.email.toLowerCase() || inv.expires_at < nowIso()) {
      throw new HttpError(404, 'Undangan tidak ditemukan atau sudah kedaluwarsa.', 'NOT_FOUND');
    }
    return inv;
  }

  router.post('/invitations/:id/accept', requireAuth, async (req, res) => {
    const inv = await myInvitation(req);
    await db.tx(async () => {
      await db.run(
        'INSERT INTO memberships (book_id, user_id, role, invited_by, created_at) VALUES (?,?,?,?,?) ON CONFLICT (book_id, user_id) DO UPDATE SET role = excluded.role',
        inv.book_id, req.user.id, inv.role, inv.invited_by, nowIso(),
      );
      await db.run('DELETE FROM invitations WHERE id = ?', inv.id);
      await db.run('UPDATE sessions SET book_id = ? WHERE id = ?', inv.book_id, req.user.session_id);
    });
    res.json({ ...(await sessionPayload(await currentSession(req))), mailMode: mailer.configured ? 'smtp' : 'console' });
  });

  router.post('/invitations/:id/decline', requireAuth, async (req, res) => {
    const inv = await myInvitation(req);
    await db.run('DELETE FROM invitations WHERE id = ?', inv.id);
    res.json({ ok: true });
  });

  // Keluar sendiri dari pembukuan orang lain.
  router.delete('/books/:id', requireAuth, async (req, res) => {
    const bookId = v.id(req.params.id);
    const r = await db.run('DELETE FROM memberships WHERE book_id = ? AND user_id = ?', bookId, req.user.id);
    if (!r.changes) throw new HttpError(404, 'Kamu bukan anggota pembukuan itu.', 'NOT_FOUND');
    await db.run('UPDATE sessions SET book_id = NULL WHERE user_id = ? AND book_id = ?', req.user.id, bookId);
    res.json({ ok: true });
  });

  // ── Ganti alamat email ──
  // 1) Masukkan email baru + kata sandi → kode dikirim ke email BARU.
  // 2) Masukkan kode → email diganti, email lama diberi tahu, perangkat lain keluar.
  router.post('/email/request', requireAuth, async (req, res) => {
    await limit(`emailchg:${req.user.id}`, 6, 60 * 60_000);
    await limit(`emailchg-ip:${clientIp(req)}`, 30, 60 * 60_000);
    const newEmail = v.email(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : '';
    if (!(await verifyPassword(password, req.user.password_hash))) throw new HttpError(400, 'Kata sandi salah.', 'BAD_CREDENTIALS');
    if (newEmail === req.user.email.toLowerCase()) throw bad('Itu sudah menjadi alamat emailmu sekarang.');
    const taken = await db.get('SELECT 1 AS x FROM users WHERE lower(email) = ? AND email_verified_at IS NOT NULL AND id != ?', newEmail, req.user.id);
    if (taken) throw new HttpError(409, 'Alamat email itu sudah dipakai akun lain.', 'EMAIL_TAKEN');
    const wait = RESEND_SECONDS - await secondsSinceLastCode(req.user, 'email_change');
    if (wait > 0) throw new HttpError(429, `Tunggu ${Math.ceil(wait)} detik lagi sebelum minta kode baru.`, 'RATE_LIMITED', { retryAfter: Math.ceil(wait) });
    const devCode = await issueCode(req.user, 'email_change', { newEmail });
    res.json({ ok: true, email: newEmail, devCode });
  });

  router.post('/email/confirm', requireAuth, async (req, res) => {
    await limit(`emailcfm:${req.user.id}`, 20, 10 * 60_000);
    const code = readCode(req.body.code);
    const row = await consumeCode(req.user, 'email_change', code);
    const newEmail = row.new_email;
    const oldEmail = req.user.email;
    try {
      await db.tx(async () => {
        // Alamat itu mungkin dipegang pendaftar yang tidak pernah memverifikasi. Kamu sudah
        // membuktikan alamat itu milikmu lewat kode tadi, jadi pendaftaran yang menggantung itu dibuang.
        await db.run('DELETE FROM users WHERE lower(email) = ? AND email_verified_at IS NULL AND id != ?', newEmail, req.user.id);
        const taken = await db.get('SELECT 1 AS x FROM users WHERE lower(email) = ? AND id != ?', newEmail, req.user.id);
        if (taken) throw new HttpError(409, 'Alamat email itu sudah dipakai akun lain.', 'EMAIL_TAKEN');
        await db.run('UPDATE users SET email = ? WHERE id = ?', newEmail, req.user.id);
        await db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', req.user.id, req.user.session_id); // perangkat lain keluar
      });
    } catch (err) {
      if (err?.code === '23505') throw new HttpError(409, 'Alamat email itu sudah dipakai akun lain.', 'EMAIL_TAKEN');
      throw err;
    }
    // Kabari alamat lama (tidak menggagalkan penggantian kalau email gagal terkirim).
    try {
      await mailer.send({ to: oldEmail, ...emailChangedEmail({ name: req.user.name, newEmail }) });
    } catch (err) {
      console.error('Gagal mengirim pemberitahuan ke email lama:', err.message);
    }
    const fresh = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    res.json({ user: publicUser(fresh, await resolveBook({ ...fresh, active_book_id: req.user.active_book_id })) });
  });

  // ── Lupa kata sandi ──
  router.post('/forgot', async (req, res) => {
    await limit(`forgot:${clientIp(req)}`, 8, 60 * 60_000);
    const email = v.email(req.body.email);
    const user = await findUser(email);
    let devCode;
    // Jawaban selalu sama, terdaftar atau tidak, supaya tidak membocorkan siapa yang punya akun.
    if (user?.email_verified_at && await secondsSinceLastCode(user, 'reset') >= RESEND_SECONDS) {
      devCode = await issueCode(user, 'reset');
    }
    res.json({ ok: true, devCode });
  });

  router.post('/reset', async (req, res) => {
    await limit(`reset:${clientIp(req)}`, 30, 10 * 60_000);
    const email = v.email(req.body.email);
    const code = readCode(req.body.code);
    const password = v.password(req.body.password, 'Kata sandi baru');
    const user = await findUser(email);
    if (!user) throw new HttpError(400, 'Kode belum cocok. Coba periksa lagi.', 'CODE_WRONG');
    await consumeCode(user, 'reset', code);
    const hash = await hashPassword(password);
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, user.id);
    await db.run('DELETE FROM sessions WHERE user_id = ?', user.id); // semua perangkat dikeluarkan
    res.json({ ok: true });
  });

  // ── Pengaturan awal (sekali saja setelah akun aktif) ──
  router.post('/onboarding', requireAuth, async (req, res) => {
    const user = req.user;
    if (user.onboarded_at) throw bad('Pengaturan awal sudah pernah diselesaikan.');
    const usage = v.oneOf(req.body.usage, ['pribadi', 'usaha'], 'Pilihan penggunaan');
    const businessName = v.str(req.body.businessName, 'Nama pembukuan', { max: 80, optional: true }) || (usage === 'usaha' ? `Usaha ${user.name}` : `Keuangan ${user.name}`);
    const openingCash = v.amount(req.body.openingCash ?? 0, 'Saldo kas', { allowZero: true });
    const openingBank = v.amount(req.body.openingBank ?? 0, 'Saldo bank', { allowZero: true });
    const date = v.date(req.body.date);

    await db.tx(async () => {
      await seedAccounts(db, user.id, usage);
      const lines = [];
      if (openingCash > 0) lines.push({ accountId: (await roleAccount(db, user.id, 'cash')).id, debit: openingCash, credit: 0 });
      if (openingBank > 0) lines.push({ accountId: (await roleAccount(db, user.id, 'bank')).id, debit: openingBank, credit: 0 });
      if (lines.length) {
        lines.push({ accountId: (await roleAccount(db, user.id, 'capital')).id, debit: 0, credit: openingCash + openingBank });
        await createEntry(db, user.id, { date, description: 'Saldo awal', kind: 'opening', lines });
      }
      await db.run('UPDATE users SET usage = ?, business_name = ?, onboarded_at = ? WHERE id = ?', usage, businessName, nowIso(), user.id);
    });
    const fresh = await db.get('SELECT * FROM users WHERE id = ?', user.id);
    res.json({ user: publicUser(fresh, ownBookOf(fresh)) });
  });

  // ── Profil & keamanan akun ──
  // Nama adalah milik orangnya. Nama pembukuan milik pembukuan, jadi hanya pemilik yang boleh mengubahnya.
  router.patch('/profile', requireAuth, async (req, res) => {
    const name = v.str(req.body.name, 'Nama', { min: 2, max: 80 });
    await db.run('UPDATE users SET name = ? WHERE id = ?', name, req.user.id);
    if (req.body.businessName !== undefined) {
      if (req.book.role !== 'owner') throw new HttpError(403, 'Hanya pemilik pembukuan yang bisa mengubah nama pembukuan.', 'OWNER_ONLY');
      const businessName = v.str(req.body.businessName, 'Nama pembukuan', { max: 80, optional: true });
      await db.run('UPDATE users SET business_name = ? WHERE id = ?', businessName ?? req.user.business_name, req.user.id);
    }
    const fresh = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    res.json({ user: publicUser(fresh, await resolveBook({ ...fresh, active_book_id: req.user.active_book_id })) });
  });

  router.post('/change-password', requireAuth, async (req, res) => {
    await limit(`chpass:${req.user.id}`, 10, 15 * 60_000);
    const current = typeof req.body.current === 'string' ? req.body.current : '';
    const next = v.password(req.body.next, 'Kata sandi baru');
    if (!(await verifyPassword(current, req.user.password_hash))) throw new HttpError(400, 'Kata sandi saat ini salah.', 'BAD_CREDENTIALS');
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(next), req.user.id);
    await db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', req.user.id, req.user.session_id); // perangkat lain dikeluarkan
    res.json({ ok: true });
  });

  router.delete('/account', requireAuth, async (req, res) => {
    await limit(`delacc:${req.user.id}`, 10, 15 * 60_000);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!(await verifyPassword(password, req.user.password_hash))) throw new HttpError(400, 'Kata sandi salah.', 'BAD_CREDENTIALS');
    const id = req.user.id;
    const shared = (await db.get('SELECT COUNT(*) AS n FROM memberships WHERE book_id = ?', id)).n;
    if (shared > 0) {
      throw bad(`Pembukuanmu masih dibagikan ke ${shared} orang. Keluarkan semua anggota dulu di Pengaturan → Anggota, lalu hapus akun.`, 'BOOK_SHARED');
    }
    await db.tx(async () => {
      await db.run('DELETE FROM entries WHERE user_id = ?', id); // baris jurnal, utang, pembayaran ikut terhapus
      await db.run('DELETE FROM invoices WHERE user_id = ?', id);
      await db.run('DELETE FROM budgets WHERE user_id = ?', id);
      await db.run('DELETE FROM accounts WHERE user_id = ?', id);
      await db.run('DELETE FROM users WHERE id = ?', id); // sesi, kode, kontak, chat ikut terhapus
    });
    res.setHeader('Set-Cookie', cookieString(req, '', 0));
    res.json({ ok: true });
  });

  return { router, requireAuth, requireOnboarded, requireWritable, requireOwner };
}
