// Satu pembukuan dipakai beberapa orang: undangan, peran, dan batas akses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const OWNER = 'pemilik@contoh.test';
const WIN = 'win@contoh.test';

async function setup(s, { inviteeOnboarded = false } = {}) {
  const owner = s.client();
  await s.signUp(owner, { email: OWNER, name: 'Sari Pemilik', usage: 'usaha', openingCash: 1_000_000, openingBank: 4_000_000, date: '2026-01-01' });
  const A = Object.fromEntries((await owner.get('/api/accounts')).data.accounts.map((a) => [a.name, a.id]));
  const guest = s.client();
  if (inviteeOnboarded) await s.signUp(guest, { email: WIN, name: 'Win Tamu', usage: 'pribadi', openingCash: 77_000, date: '2026-01-01' });
  else await s.register(guest, { email: WIN, name: 'Win Tamu' });
  return { owner, guest, A };
}

const invite = (owner, email = WIN, role = 'editor') => owner.post('/api/team/invitations', { email, role });
async function join(owner, guest, role = 'editor') {
  const inv = await invite(owner, WIN, role);
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const me = (await guest.get('/api/auth/me')).data;
  assert.equal(me.invitations.length, 1);
  const r = await guest.post(`/api/auth/invitations/${me.invitations[0].id}/accept`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

test('mengundang, menerima, lalu bekerja di data yang sama dengan pemilik', async () => {
  const s = await startServer();
  try {
    const { owner, guest, A } = await setup(s);

    // Belum jadi anggota: tidak bisa melihat data pemilik, dan belum punya pembukuan sendiri.
    assert.equal((await guest.get('/api/accounts')).status, 409);

    const inv = await invite(owner);
    assert.equal(inv.status, 201);
    assert.equal(inv.data.emailSent, true);
    const mail = s.mails.find((m) => m.to === WIN && /mengundangmu/.test(m.subject));
    assert.match(mail.subject, /Sari Pemilik/);
    assert.match(mail.text, /Pencatat/);
    assert.match(mail.text, /http:\/\/127\.0\.0\.1:\d+/, 'tautan memakai alamat yang sedang dipakai');

    let me = (await guest.get('/api/auth/me')).data;
    assert.equal(me.invitations.length, 1);
    assert.equal(me.invitations[0].role, 'editor');
    assert.equal(me.invitations[0].ownerName, 'Sari Pemilik');

    const r = await guest.post(`/api/auth/invitations/${me.invitations[0].id}/accept`);
    assert.equal(r.status, 200);
    assert.equal(r.data.user.role, 'editor');
    assert.equal(r.data.user.onboarded, true, 'pembukuan yang dibuka sudah siap walau pembukuan sendiri belum diatur');
    assert.equal(r.data.user.bookId, (await owner.get('/api/auth/me')).data.user.id);
    assert.equal(r.data.invitations.length, 0);
    assert.equal(r.data.books.length, 2);

    // Pencatat melihat data pemilik dan boleh mencatat.
    const accounts = (await guest.get('/api/accounts')).data.accounts;
    assert.equal(accounts.find((a) => a.name === 'Kas').balance, 1_000_000);
    const tx = await guest.post('/api/transactions', { kind: 'income', date: '2026-01-05', amount: 250_000, description: 'Dicatat tamu', categoryId: A['Pendapatan Penjualan'], cashAccountId: A.Kas });
    assert.equal(tx.status, 201, JSON.stringify(tx.data));

    // Pemilik langsung melihatnya, lengkap dengan siapa yang mencatat.
    const list = (await owner.get('/api/transactions')).data.items;
    const row = list.find((e) => e.description === 'Dicatat tamu');
    assert.equal(row.createdBy.name, 'Win Tamu');
    assert.equal((await owner.get('/api/accounts')).data.accounts.find((a) => a.name === 'Kas').balance, 1_250_000);

    // Pencatat tidak bisa mengelola anggota, mengubah profil pembukuan, atau mengunduh cadangan.
    for (const [method, path, body] of [['get', '/api/team'], ['post', '/api/team/invitations', { email: 'x@contoh.test', role: 'viewer' }], ['patch', '/api/book', { name: 'Ganti' }], ['get', '/api/backup']]) {
      const x = await guest[method](path, body);
      assert.equal(x.status, 403, `${method} ${path}`);
      assert.equal(x.data.error.code, 'OWNER_ONLY');
    }
    // ...dan tidak bisa mengganti nama pembukuan lewat profil.
    assert.equal((await guest.patch('/api/auth/profile', { name: 'Win Baru', businessName: 'Curang' })).status, 403);
    const named = await guest.patch('/api/auth/profile', { name: 'Win Baru' });
    assert.equal(named.status, 200);
    assert.equal(named.data.user.name, 'Win Baru');
    assert.equal(named.data.user.role, 'editor', 'tetap membuka pembukuan pemilik');
  } finally {
    await s.close();
  }
});

test('Pelihat hanya bisa melihat, tetapi masih boleh bertanya ke asisten', async () => {
  const s = await startServer();
  try {
    const { owner, guest, A } = await setup(s);
    await join(owner, guest, 'viewer');

    assert.equal((await guest.get('/api/accounts')).status, 200);
    assert.equal((await guest.get('/api/reports/balance-sheet?to=2026-12-31')).status, 200);
    assert.equal((await guest.get('/api/dashboard')).status, 200);
    for (const [method, path, body] of [
      ['post', '/api/transactions', { kind: 'income', date: '2026-01-05', amount: 1, description: 'x', categoryId: A['Pendapatan Penjualan'], cashAccountId: A.Kas }],
      ['post', '/api/contacts', { name: 'X' }],
      ['post', '/api/journal', { date: '2026-01-05', description: 'x', lines: [] }],
      ['put', `/api/budgets/${A.Sewa}`, { amount: 5 }],
      ['post', '/api/accounts', { name: 'Baru', type: 'expense' }],
      ['del', `/api/entries/1`],
    ]) {
      const x = await guest[method](path, body);
      assert.equal(x.status, 403, `${method} ${path}`);
      assert.equal(x.data.error.code, 'READ_ONLY');
    }
    const chat = await guest.post('/api/chat', { message: 'berapa saldo saya?', today: '2026-01-31' });
    assert.equal(chat.status, 200);
    assert.match(chat.data.reply, /5\.000\.000/, 'asisten menjawab dari data pembukuan pemilik');

    // Riwayat obrolan milik masing-masing orang.
    assert.equal((await owner.get('/api/chat')).data.messages.length, 0);
    assert.equal((await guest.get('/api/chat')).data.messages.length, 2);
  } finally {
    await s.close();
  }
});

test('ubah peran berlaku seketika; mengeluarkan anggota mencabut aksesnya', async () => {
  const s = await startServer();
  try {
    const { owner, guest } = await setup(s);
    const payload = await join(owner, guest, 'viewer');
    const guestId = payload.user.id;
    const write = () => guest.post('/api/contacts', { name: 'Kontak tamu' });

    assert.equal((await write()).status, 403);
    assert.equal((await owner.patch(`/api/team/members/${guestId}`, { role: 'editor' })).status, 200);
    assert.equal((await write()).status, 201, 'jadi Pencatat tanpa perlu masuk ulang');
    assert.equal((await owner.patch(`/api/team/members/${guestId}`, { role: 'pemilik' })).status, 400);

    const team = (await owner.get('/api/team')).data;
    assert.equal(team.members.length, 1);
    assert.equal(team.members[0].email, WIN);
    assert.equal(team.members[0].role, 'editor');

    assert.equal((await owner.del(`/api/team/members/${guestId}`)).status, 200);
    // Akses langsung hilang. Pembukuan miliknya sendiri belum diatur, jadi diminta mengatur dulu.
    const after = await guest.get('/api/accounts');
    assert.equal(after.status, 409);
    assert.equal(after.data.error.code, 'ONBOARDING_REQUIRED');
    const me = (await guest.get('/api/auth/me')).data;
    assert.equal(me.user.onboarded, false);
    assert.equal(me.books.length, 1);
    assert.equal((await owner.del(`/api/team/members/${guestId}`)).status, 404);
    // Data yang dicatatnya tetap ada di pembukuan pemilik.
    assert.ok((await owner.get('/api/contacts')).data.contacts.some((c) => c.name === 'Kontak tamu'));
  } finally {
    await s.close();
  }
});

test('pindah antara pembukuan sendiri dan pembukuan yang dibagikan', async () => {
  const s = await startServer();
  try {
    const { owner, guest } = await setup(s, { inviteeOnboarded: true });
    await join(owner, guest, 'editor');
    const ownerId = (await owner.get('/api/auth/me')).data.user.id;
    const guestId = (await owner.get('/api/team')).data.members[0].userId;
    const kas = async () => (await guest.get('/api/accounts')).data.accounts.find((a) => a.name === 'Kas').balance;

    assert.equal(await kas(), 1_000_000, 'setelah menerima, yang terbuka pembukuan pemilik');
    let r = await guest.post('/api/auth/book', { bookId: guestId });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.role, 'owner');
    assert.equal(await kas(), 77_000, 'pembukuan sendiri terpisah dari pembukuan pemilik');
    r = await guest.post('/api/auth/book', { bookId: ownerId });
    assert.equal(r.data.user.role, 'editor');
    assert.equal(await kas(), 1_000_000);

    // Tidak bisa membuka pembukuan orang yang bukan mengundangnya.
    const stranger = s.client();
    await s.signUp(stranger, { email: 'asing@contoh.test', usage: 'pribadi', date: '2026-01-01' });
    assert.equal((await stranger.post('/api/auth/book', { bookId: ownerId })).status, 403);
    assert.equal((await stranger.get('/api/accounts')).data.accounts.find((a) => a.name === 'Kas').balance, 0);

    // Keluar sendiri dari pembukuan yang dibagikan.
    assert.equal((await guest.del(`/api/auth/books/${ownerId}`)).status, 200);
    assert.equal(await kas(), 77_000, 'kembali ke pembukuan sendiri');
    assert.equal((await guest.del(`/api/auth/books/${ownerId}`)).status, 404);
  } finally {
    await s.close();
  }
});

test('undangan hanya untuk pemilik emailnya, bisa ditolak, dan punya masa berlaku', async () => {
  const s = await startServer();
  try {
    const { owner, guest } = await setup(s);
    assert.equal((await invite(owner, OWNER)).status, 400, 'tidak bisa mengundang diri sendiri');
    assert.equal((await invite(owner, 'bukan-email')).status, 400);
    assert.equal((await owner.post('/api/team/invitations', { email: WIN, role: 'pemilik' })).status, 400);

    const first = await invite(owner, WIN, 'viewer');
    const again = await invite(owner, WIN.toUpperCase(), 'editor'); // sama, huruf besar
    assert.equal(again.status, 201);
    assert.equal(again.data.id, first.data.id, 'mengundang ulang memperbarui undangan yang sama');
    let team = (await owner.get('/api/team')).data;
    assert.equal(team.invitations.length, 1);
    assert.equal(team.invitations[0].role, 'editor');

    const id = (await guest.get('/api/auth/me')).data.invitations[0].id;
    // Orang lain tidak bisa menerima/menolak undangan ini.
    const other = s.client();
    await s.register(other, { email: 'lain@contoh.test' });
    assert.equal((await other.post(`/api/auth/invitations/${id}/accept`)).status, 404);
    assert.equal((await other.post(`/api/auth/invitations/${id}/decline`)).status, 404);

    // Kedaluwarsa
    await s.db.run("UPDATE invitations SET expires_at = '2020-01-01T00:00:00.000Z'");
    assert.equal((await guest.post(`/api/auth/invitations/${id}/accept`)).status, 404);
    assert.equal((await guest.get('/api/auth/me')).data.invitations.length, 0);
    team = (await owner.get('/api/team')).data;
    assert.equal(team.invitations[0].expired, true);

    // Undang ulang → berlaku lagi, lalu ditolak oleh yang diundang.
    await invite(owner, WIN, 'viewer');
    const id2 = (await guest.get('/api/auth/me')).data.invitations[0].id;
    assert.equal((await guest.post(`/api/auth/invitations/${id2}/decline`)).status, 200);
    assert.equal((await guest.get('/api/auth/me')).data.invitations.length, 0);
    assert.equal((await owner.get('/api/team')).data.invitations.length, 0);

    // Pemilik bisa membatalkan undangan.
    const third = await invite(owner, WIN, 'viewer');
    assert.equal((await owner.del(`/api/team/invitations/${third.data.id}`)).status, 200);
    assert.equal((await owner.del(`/api/team/invitations/${third.data.id}`)).status, 404);
  } finally {
    await s.close();
  }
});

test('diundang sebelum punya akun: setelah daftar langsung melihat undangan, dan masuk ke pembukuan itu', async () => {
  const s = await startServer();
  try {
    const owner = s.client();
    await s.signUp(owner, { email: OWNER, name: 'Sari Pemilik', usage: 'usaha', openingCash: 500_000, date: '2026-01-01' });
    assert.equal((await invite(owner, 'baru@contoh.test', 'viewer')).status, 201);

    const newcomer = s.client();
    await s.register(newcomer, { email: 'baru@contoh.test', name: 'Orang Baru' });
    let me = (await newcomer.get('/api/auth/me')).data;
    assert.equal(me.invitations.length, 1);
    await newcomer.post(`/api/auth/invitations/${me.invitations[0].id}/accept`);
    await newcomer.post('/api/auth/logout');

    // Masuk lagi: belum punya pembukuan sendiri, jadi langsung dibawa ke pembukuan yang dibagikan.
    const again = s.client();
    const login = await again.post('/api/auth/login', { email: 'baru@contoh.test', password: 'rahasia-123' });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.onboarded, true);
    assert.equal(login.data.user.role, 'viewer');
    assert.equal((await again.get('/api/accounts')).data.accounts.find((a) => a.name === 'Kas').balance, 500_000);
  } finally {
    await s.close();
  }
});

test('email undangan gagal terkirim: undangan tetap tersimpan', async () => {
  const s = await startServer();
  try {
    const { owner, guest } = await setup(s);
    s.failMailTo = WIN; // mailer tes melempar error untuk alamat ini
    const r = await invite(owner);
    assert.equal(r.status, 201);
    assert.equal(r.data.emailSent, false);
    assert.equal((await guest.get('/api/auth/me')).data.invitations.length, 1, 'orangnya tetap melihat undangan setelah masuk');
  } finally {
    await s.close();
  }
});

test('hapus akun: ditolak selagi pembukuan masih dibagikan', async () => {
  const s = await startServer();
  try {
    const { owner, guest } = await setup(s);
    await join(owner, guest, 'viewer');
    const guestId = (await owner.get('/api/team')).data.members[0].userId;

    let r = await owner.del('/api/auth/account', { password: 'rahasia-123' });
    assert.equal(r.status, 400);
    assert.equal(r.data.error.code, 'BOOK_SHARED');
    assert.equal((await owner.del(`/api/team/members/${guestId}`)).status, 200);
    r = await owner.del('/api/auth/account', { password: 'rahasia-123' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await s.db.get('SELECT COUNT(*) AS n FROM memberships')).n, 0);
  } finally {
    await s.close();
  }
});

test('batas jumlah undangan, dan profil pembukuan (kop faktur) hanya diubah pemilik', async () => {
  const s = await startServer();
  try {
    const { owner, guest } = await setup(s);
    // Batas per jam: 20 undangan.
    let last;
    for (let i = 0; i < 21; i += 1) last = await invite(owner, `orang${i}@contoh.test`, 'viewer');
    assert.equal(last.status, 429);

    await join(owner, guest, 'editor').catch(() => {});
    const set = await owner.patch('/api/book', { name: 'Toko Sari', address: 'Jl. Melati 1, Bandung', phone: '0812-3456', paymentInfo: 'BCA 123 a.n. Sari' });
    assert.equal(set.status, 200, JSON.stringify(set.data));
    const book = (await owner.get('/api/book')).data;
    assert.equal(book.name, 'Toko Sari');
    assert.equal(book.paymentInfo, 'BCA 123 a.n. Sari');
  } finally {
    await s.close();
  }
});
