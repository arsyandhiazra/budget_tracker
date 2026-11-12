// Postgres melayani banyak permintaan sekaligus. Tes ini memastikan permintaan yang
// masuk bersamaan tidak merusak data (utang kelebihan bayar, akun ganda).
// Paling bermakna kalau dijalankan dengan TEST_DATABASE_URL (Postgres sungguhan).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

test('pelunasan utang yang masuk bersamaan tidak pernah melebihi sisa utang', async () => {
  const s = await startServer();
  try {
    const c = s.client();
    await s.signUp(c, { email: 'balap@contoh.test', openingBank: 10_000_000, date: '2026-01-01' });
    const A = Object.fromEntries((await c.get('/api/accounts')).data.accounts.map((a) => [a.name, a.id]));
    const debt = await c.post('/api/debts', { kind: 'payable', mode: 'cash', amount: 3000, date: '2026-01-05', description: 'Pinjaman', cashAccountId: A.Bank });
    assert.equal(debt.status, 201);

    const results = await Promise.all(
      Array.from({ length: 6 }, () => c.post(`/api/debts/${debt.data.id}/payments`, { amount: 1000, date: '2026-01-06', cashAccountId: A.Bank })),
    );
    const ok = results.filter((r) => r.status === 201).length;
    assert.equal(ok, 3, `hanya 3 pelunasan yang boleh berhasil, tetapi ${ok} berhasil`);
    assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 400), 'sisanya ditolak dengan pesan biasa, bukan error server');

    const { debts } = (await c.get('/api/debts?today=2026-01-31')).data;
    assert.equal(debts[0].remaining, 0);
    assert.equal(debts[0].paid, 3000);
  } finally {
    await s.close();
  }
});

test('daftar dengan email yang sama bersamaan hanya membuat satu akun', async () => {
  const s = await startServer();
  try {
    const email = 'kembar@contoh.test';
    const results = await Promise.all(
      Array.from({ length: 4 }, () => s.client().post('/api/auth/register', { name: 'Kembar', email, password: 'rahasia-123' })),
    );
    assert.ok(results.every((r) => r.status === 201 || r.status === 409), `status tak terduga: ${results.map((r) => r.status)}`);
    assert.ok(results.some((r) => r.status === 201));
    assert.equal((await s.db.get('SELECT COUNT(*) AS n FROM users WHERE lower(email) = ?', email)).n, 1);
  } finally {
    await s.close();
  }
});
