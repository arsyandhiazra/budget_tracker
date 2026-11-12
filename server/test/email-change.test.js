// Ganti alamat email akun: kode dikirim ke email BARU, email lama diberi tahu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const OLD = 'lama@contoh.test';
const NEW = 'baru@contoh.test';
const PASS = 'rahasia-123';

async function setup(s) {
  const c = s.client();
  await s.signUp(c, { email: OLD, name: 'Ratna', usage: 'pribadi', date: '2026-01-01' });
  return c;
}
const request = (c, email = NEW, password = PASS) => c.post('/api/auth/email/request', { email, password });
const lastMail = (s, to) => [...s.mails].reverse().find((m) => m.to === to);

test('ganti email: kode ke alamat baru, lalu semua jalan masuk memakai alamat baru', async () => {
  const s = await startServer();
  try {
    const c = await setup(s);
    const other = s.client(); // perangkat lain
    assert.equal((await other.post('/api/auth/login', { email: OLD, password: PASS })).status, 200);

    // Syarat: kata sandi benar, bukan alamat yang sama, belum dipakai akun lain.
    assert.equal((await request(c, NEW, 'salah-salah')).status, 400);
    assert.equal((await request(c, OLD)).status, 400);
    assert.equal((await request(c, 'ngawur')).status, 400);
    const rival = s.client();
    await s.signUp(rival, { email: 'terpakai@contoh.test', usage: 'pribadi', date: '2026-01-01' });
    const taken = await request(c, 'TERPAKAI@contoh.test');
    assert.equal(taken.status, 409);
    assert.equal(taken.data.error.code, 'EMAIL_TAKEN');

    const r = await request(c, 'Baru@Contoh.Test'); // huruf besar dinormalkan
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.email, NEW);
    assert.equal(r.data.devCode, undefined, 'kode tidak bocor ke browser');
    const mail = lastMail(s, NEW);
    assert.ok(mail, 'kode dikirim ke alamat BARU');
    assert.match(mail.subject, /memakai email ini/);
    assert.equal(s.mails.some((m) => m.to === OLD && /memakai email ini/.test(m.subject)), false, 'bukan ke alamat lama');
    const code = mail.text.match(/\b(\d{6})\b/)[1];

    // Selama belum dikonfirmasi, tidak ada yang berubah.
    assert.equal((await c.get('/api/auth/me')).data.user.email, OLD);

    // Kode salah ditolak; kode benar mengganti email.
    let x = await c.post('/api/auth/email/confirm', { code: code === '000000' ? '111111' : '000000' });
    assert.equal(x.status, 400);
    assert.equal(x.data.error.code, 'CODE_WRONG');
    x = await c.post('/api/auth/email/confirm', { code });
    assert.equal(x.status, 200, JSON.stringify(x.data));
    assert.equal(x.data.user.email, NEW);
    assert.equal(x.data.user.onboarded, true);
    assert.equal((await c.get('/api/auth/me')).data.user.email, NEW);
    assert.equal((await c.post('/api/auth/email/confirm', { code })).status, 400, 'kode sekali pakai');

    // Alamat lama diberi tahu (alamat baru disamarkan), perangkat lain keluar.
    const notice = lastMail(s, OLD);
    assert.match(notice.subject, /diganti/);
    assert.ok(notice.text.includes('b***@contoh.test') && !notice.text.includes(NEW), 'alamat baru disamarkan');
    assert.equal((await other.get('/api/accounts')).status, 401);
    // Perangkat yang dipakai tetap masuk.
    assert.equal((await c.get('/api/accounts')).status, 200);

    // Masuk: email lama tidak lagi berlaku.
    const fresh = s.client();
    assert.equal((await fresh.post('/api/auth/login', { email: OLD, password: PASS })).status, 401);
    const ok = await fresh.post('/api/auth/login', { email: NEW, password: PASS });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.user.email, NEW);
    // Alamat lama bebas dipakai orang lain.
    const reuse = s.client();
    await s.register(reuse, { email: OLD, name: 'Orang Lain' });
  } finally {
    await s.close();
  }
});

test('ganti email: jeda kirim ulang, kode kedaluwarsa, dan terkunci setelah salah berkali-kali', async () => {
  const s = await startServer();
  try {
    const c = await setup(s);
    assert.equal((await request(c)).status, 200);
    const again = await request(c);
    assert.equal(again.status, 429, 'minta kode terlalu cepat ditolak');

    // Setelah jeda, kode baru menggantikan yang lama.
    await s.db.run("UPDATE email_codes SET created_at = '2020-01-01T00:00:00.000Z'");
    assert.equal((await request(c)).status, 200);
    const [first, second] = s.mails.filter((m) => m.to === NEW).map((m) => m.text.match(/\b(\d{6})\b/)[1]);
    if (first !== second) assert.equal((await c.post('/api/auth/email/confirm', { code: first })).status, 400, 'kode lama tidak berlaku lagi');

    // Salah 5 kali → terkunci, walau akhirnya kode yang benar.
    const wrong = second === '999999' ? '111111' : '999999';
    for (let i = 0; i < 5; i += 1) await c.post('/api/auth/email/confirm', { code: wrong });
    const locked = await c.post('/api/auth/email/confirm', { code: second });
    assert.equal(locked.status, 429);
    assert.equal(locked.data.error.code, 'CODE_LOCKED');

    // Kedaluwarsa
    await s.db.run("UPDATE email_codes SET created_at = '2020-01-01T00:00:00.000Z'");
    assert.equal((await request(c)).status, 200);
    const code = lastMail(s, NEW).text.match(/\b(\d{6})\b/)[1];
    await s.db.run("UPDATE email_codes SET expires_at = '2020-01-01T00:00:00.000Z' WHERE used_at IS NULL");
    const expired = await c.post('/api/auth/email/confirm', { code });
    assert.equal(expired.data.error.code, 'CODE_EXPIRED');
    assert.equal((await c.get('/api/auth/me')).data.user.email, OLD, 'email tidak berubah');
  } finally {
    await s.close();
  }
});

test('ganti email: pendaftar yang tak pernah verifikasi tidak menghalangi; yang sudah verifikasi lebih dulu menang', async () => {
  const s = await startServer();
  try {
    const c = await setup(s);

    // Seseorang mendaftar dengan alamat itu tapi tidak pernah memverifikasi.
    const squatter = s.client();
    await squatter.post('/api/auth/register', { name: 'Iseng', email: NEW, password: 'iseng-12345' });
    assert.equal((await s.db.get('SELECT COUNT(*) AS n FROM users WHERE lower(email) = ?', NEW)).n, 1);
    assert.equal((await request(c)).status, 200, 'alamat yang belum diverifikasi orang lain boleh diminta');
    // Kodenya diambil dari email "memakai email ini" (bukan email verifikasi milik si pendaftar).
    const mine = [...s.mails].reverse().find((m) => m.to === NEW && /memakai email ini/.test(m.subject));
    const real = mine.text.match(/\b(\d{6})\b/)[1];
    const done = await c.post('/api/auth/email/confirm', { code: real });
    assert.equal(done.status, 200, JSON.stringify(done.data));
    assert.equal((await s.db.get('SELECT COUNT(*) AS n FROM users WHERE lower(email) = ?', NEW)).n, 1, 'pendaftaran yang menggantung dibuang');

    // Kalau orang lain keburu memverifikasi alamat itu, konfirmasi ditolak.
    const c2 = s.client();
    await s.signUp(c2, { email: 'dua@contoh.test', usage: 'pribadi', date: '2026-01-01' });
    assert.equal((await request(c2, 'rebutan@contoh.test')).status, 200);
    const pending = [...s.mails].reverse().find((m) => m.to === 'rebutan@contoh.test').text.match(/\b(\d{6})\b/)[1];
    const winner = s.client();
    await s.register(winner, { email: 'rebutan@contoh.test', name: 'Pemenang' });
    const lost = await c2.post('/api/auth/email/confirm', { code: pending });
    assert.equal(lost.status, 409);
    assert.equal(lost.data.error.code, 'EMAIL_TAKEN');
    assert.equal((await c2.get('/api/auth/me')).data.user.email, 'dua@contoh.test');
  } finally {
    await s.close();
  }
});

test('ganti email: wajib masuk, dan undangan pembukuan mengikuti email yang baru', async () => {
  const s = await startServer();
  try {
    const anon = s.client();
    assert.equal((await anon.post('/api/auth/email/request', { email: NEW, password: PASS })).status, 401);
    assert.equal((await anon.post('/api/auth/email/confirm', { code: '123456' })).status, 401);

    const owner = s.client();
    await s.signUp(owner, { email: 'pemilik@contoh.test', usage: 'usaha', date: '2026-01-01' });
    const c = await setup(s);
    await owner.post('/api/team/invitations', { email: NEW, role: 'viewer' });
    assert.equal((await c.get('/api/auth/me')).data.invitations.length, 0, 'undangan untuk alamat baru belum terlihat');
    await request(c);
    const code = [...s.mails].reverse().find((m) => m.to === NEW && /memakai email ini/.test(m.subject)).text.match(/\b(\d{6})\b/)[1];
    assert.equal((await c.post('/api/auth/email/confirm', { code })).status, 200);
    const me = (await c.get('/api/auth/me')).data;
    assert.equal(me.invitations.length, 1, 'undangan untuk alamat itu kini terlihat, karena alamatnya sudah terbukti milikmu');
  } finally {
    await s.close();
  }
});
