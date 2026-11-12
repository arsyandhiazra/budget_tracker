import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

test('alur akun: daftar → verifikasi → pengaturan awal → keluar → masuk', async () => {
  const s = await startServer();
  try {
    const c = s.client();
    const email = 'budi@contoh.test';

    let r = await c.post('/api/auth/register', { name: 'Budi', email, password: 'pendek' });
    assert.equal(r.status, 400, 'kata sandi pendek ditolak');

    r = await c.post('/api/auth/register', { name: 'Budi', email: 'bukan-email', password: 'rahasia-123' });
    assert.equal(r.status, 400, 'email salah format ditolak');

    r = await c.post('/api/auth/register', { name: 'Budi', email, password: 'rahasia-123' });
    assert.equal(r.status, 201);
    assert.equal(r.data.devCode, undefined, 'kode tidak boleh bocor ke browser saat email aktif');
    assert.equal(s.mails.length, 1, 'email verifikasi terkirim');

    // Belum verifikasi: tidak bisa masuk.
    r = await c.post('/api/auth/login', { email, password: 'rahasia-123' });
    assert.equal(r.status, 403);
    assert.equal(r.data.error.code, 'EMAIL_NOT_VERIFIED');

    r = await c.post('/api/auth/verify', { email, code: '000000' === s.lastCode(email) ? '111111' : '000000' });
    assert.equal(r.status, 400);
    assert.equal(r.data.error.code, 'CODE_WRONG');

    r = await c.post('/api/auth/verify', { email, code: s.lastCode(email) });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.onboarded, false);
    assert.match(c.cookie, /^bt_session=/);
    assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);

    // Kode yang sama tidak bisa dipakai dua kali.
    r = await s.client().post('/api/auth/verify', { email, code: s.lastCode(email) });
    assert.equal(r.status, 400);

    // Sebelum pengaturan awal, fitur pembukuan belum terbuka.
    r = await c.get('/api/accounts');
    assert.equal(r.status, 409);
    assert.equal(r.data.error.code, 'ONBOARDING_REQUIRED');

    r = await c.post('/api/auth/onboarding', { usage: 'pribadi', openingCash: 500000, openingBank: 2500000, date: '2026-01-01' });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.onboarded, true);
    r = await c.post('/api/auth/onboarding', { usage: 'pribadi', date: '2026-01-01' });
    assert.equal(r.status, 400, 'pengaturan awal hanya sekali');

    r = await c.get('/api/accounts');
    assert.equal(r.status, 200);
    const kas = r.data.accounts.find((a) => a.name === 'Kas');
    const bank = r.data.accounts.find((a) => a.name === 'Bank');
    assert.equal(kas.balance, 500000);
    assert.equal(bank.balance, 2500000);
    assert.ok(r.data.accounts.some((a) => a.name === 'Makanan & Minuman'), 'kategori bawaan tersedia');

    r = await c.post('/api/auth/logout');
    assert.equal(r.status, 200);
    r = await c.get('/api/accounts');
    assert.equal(r.status, 401);

    r = await c.post('/api/auth/login', { email, password: 'salah-banget' });
    assert.equal(r.status, 401);
    r = await c.post('/api/auth/login', { email: 'tidak-ada@contoh.test', password: 'rahasia-123' });
    assert.equal(r.status, 401);
    assert.equal(r.data.error.message, 'Email atau kata sandi salah.', 'pesan sama untuk email tak terdaftar');

    r = await c.post('/api/auth/login', { email: 'BUDI@contoh.test', password: 'rahasia-123' });
    assert.equal(r.status, 200, 'email tidak peka huruf besar/kecil');
    r = await c.get('/api/auth/me');
    assert.equal(r.data.user.email, email);

    // Email yang sudah aktif tidak bisa didaftarkan ulang.
    r = await s.client().post('/api/auth/register', { name: 'Orang Lain', email, password: 'rahasia-456' });
    assert.equal(r.status, 409);
  } finally {
    await s.close();
  }
});

test('lupa kata sandi, ganti kata sandi, dan hapus akun', async () => {
  const s = await startServer();
  try {
    const c = s.client();
    const email = 'sari@contoh.test';
    await s.signUp(c, { email, password: 'sandi-lama-1' });
    const other = s.client();
    await other.post('/api/auth/login', { email, password: 'sandi-lama-1' });

    // Lupa kata sandi: jawaban sama walau email tidak terdaftar.
    let r = await s.client().post('/api/auth/forgot', { email: 'hantu@contoh.test' });
    assert.deepEqual(r.data, { ok: true });
    const before = s.mails.length;
    r = await s.client().post('/api/auth/forgot', { email });
    assert.deepEqual(r.data, { ok: true });
    assert.equal(s.mails.length, before + 1);

    r = await s.client().post('/api/auth/reset', { email, code: s.lastCode(email), password: 'sandi-baru-2' });
    assert.equal(r.status, 200);
    r = await c.get('/api/accounts');
    assert.equal(r.status, 401, 'semua sesi lama dikeluarkan setelah reset');
    r = await c.post('/api/auth/login', { email, password: 'sandi-lama-1' });
    assert.equal(r.status, 401);
    r = await c.post('/api/auth/login', { email, password: 'sandi-baru-2' });
    assert.equal(r.status, 200);

    // Ganti kata sandi dari dalam.
    await other.post('/api/auth/login', { email, password: 'sandi-baru-2' });
    r = await c.post('/api/auth/change-password', { current: 'ngawur', next: 'sandi-ketiga-3' });
    assert.equal(r.status, 400);
    r = await c.post('/api/auth/change-password', { current: 'sandi-baru-2', next: 'sandi-ketiga-3' });
    assert.equal(r.status, 200);
    assert.equal((await c.get('/api/accounts')).status, 200, 'perangkat ini tetap masuk');
    assert.equal((await other.get('/api/accounts')).status, 401, 'perangkat lain dikeluarkan');

    r = await c.patch('/api/auth/profile', { name: 'Sari Dewi', businessName: 'Toko Sari' });
    assert.equal(r.data.user.businessName, 'Toko Sari');

    r = await c.del('/api/auth/account', { password: 'salah' });
    assert.equal(r.status, 400);
    r = await c.del('/api/auth/account', { password: 'sandi-ketiga-3' });
    assert.equal(r.status, 200);
    assert.equal((await s.db.get('SELECT COUNT(*) AS n FROM users')).n, 0);
    assert.equal((await s.db.get('SELECT COUNT(*) AS n FROM accounts')).n, 0);
    assert.equal((await s.db.get('SELECT COUNT(*) AS n FROM lines')).n, 0);
  } finally {
    await s.close();
  }
});

test('pengaman: CSRF, batas percobaan login, kode kedaluwarsa & terkunci', async () => {
  const s = await startServer();
  try {
    const c = s.client();
    const email = 'tono@contoh.test';
    await s.signUp(c, { email });

    // Tanpa header khusus, permintaan yang mengubah data ditolak.
    const res = await fetch(`${s.base}/api/auth/logout`, { method: 'POST', headers: { cookie: c.cookie } });
    assert.equal(res.status, 403);
    assert.equal((await c.get('/api/accounts')).status, 200, 'sesi tidak ikut terhapus');

    // Tebak kata sandi berkali-kali → diblokir sementara.
    const attacker = s.client();
    let last;
    for (let i = 0; i < 9; i += 1) last = await attacker.post('/api/auth/login', { email, password: `tebakan-${i}` });
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get('retry-after')) > 0);

    // Kode verifikasi: 5x salah → terkunci.
    const email2 = 'wati@contoh.test';
    const c2 = s.client();
    await c2.post('/api/auth/register', { name: 'Wati', email: email2, password: 'rahasia-123' });
    const real = s.lastCode(email2);
    const wrong = real === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i += 1) assert.equal((await c2.post('/api/auth/verify', { email: email2, code: wrong })).data.error.code, 'CODE_WRONG');
    const locked = await c2.post('/api/auth/verify', { email: email2, code: real });
    assert.equal(locked.status, 429);
    assert.equal(locked.data.error.code, 'CODE_LOCKED');

    // Minta kode baru terlalu cepat ditolak; setelah jeda, kode baru berlaku.
    assert.equal((await c2.post('/api/auth/resend', { email: email2 })).status, 429);
    await s.db.run("UPDATE email_codes SET created_at = '2020-01-01T00:00:00.000Z'");
    assert.equal((await c2.post('/api/auth/resend', { email: email2 })).status, 200);
    const fresh = s.lastCode(email2);
    await s.db.run("UPDATE email_codes SET expires_at = '2020-01-01T00:00:00.000Z' WHERE used_at IS NULL");
    assert.equal((await c2.post('/api/auth/verify', { email: email2, code: fresh })).data.error.code, 'CODE_EXPIRED');

    // Kata sandi tidak tersimpan apa adanya.
    const row = await s.db.get('SELECT password_hash FROM users WHERE email = ?', email);
    assert.match(row.password_hash, /^scrypt\$/);
    assert.ok(!row.password_hash.includes('rahasia-123'));
  } finally {
    await s.close();
  }
});

test('mode percobaan: tanpa SMTP kode dikembalikan, tapi tidak pernah di production', async () => {
  const { loadConfig } = await import('../config.js');
  const { createApp } = await import('../app.js');
  const { createMailer } = await import('../mailer.js');
  const { testDb } = await import('./helpers.js');
  for (const production of [false, true]) {
    const config = loadConfig({ skipEnvFile: true, quiet: true, env: { NODE_ENV: production ? 'production' : 'development', SMTP_HOST: '', AI_PROVIDER: '' } });
    config.distDir = '/nonexistent';
    const db = await testDb();
    const mailer = createMailer(config);
    const log = console.log;
    console.log = () => {};
    const app = createApp({ db, config, mailer });
    const server = await new Promise((resolve) => { const x = app.listen(0, '127.0.0.1', () => resolve(x)); });
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'BudgetTracker' },
        body: JSON.stringify({ name: 'Coba', email: 'coba@contoh.test', password: 'rahasia-123' }),
      });
      const data = await res.json();
      if (production) assert.equal(data.devCode, undefined);
      else assert.match(data.devCode, /^\d{6}$/);
    } finally {
      console.log = log;
      await new Promise((resolve) => server.close(resolve));
      await db.close();
    }
  }
});
