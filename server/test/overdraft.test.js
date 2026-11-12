// Aturan: transaksi yang melebihi uang di dompet ditolak. Saldo dompet tidak boleh minus pada tanggal mana pun.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { firstOverdraft } from '../accounting.js';

// Kas 1.000.000 dan Bank 5.000.000 per 1 Januari 2026.
async function setup(s) {
  const c = s.client();
  await s.signUp(c, { email: `od-${Math.random().toString(36).slice(2)}@contoh.test`, usage: 'usaha', openingCash: 1_000_000, openingBank: 5_000_000, date: '2026-01-01' });
  const A = Object.fromEntries((await c.get('/api/accounts')).data.accounts.map((a) => [a.name, a.id]));
  const balance = async (name) => (await c.get('/api/accounts')).data.accounts.find((a) => a.name === name).balance;
  const count = async () => (await c.get('/api/transactions?limit=1')).data.total;
  const spend = (amount, { wallet = 'Kas', date = '2026-01-10', category = 'Sewa' } = {}) =>
    c.post('/api/transactions', { kind: 'expense', date, amount, description: 'Uji', categoryId: A[category], cashAccountId: A[wallet] });
  const earn = (amount, { wallet = 'Kas', date = '2026-01-05' } = {}) =>
    c.post('/api/transactions', { kind: 'income', date, amount, description: 'Masuk', categoryId: A['Pendapatan Penjualan'], cashAccountId: A[wallet] });
  return { c, A, balance, count, spend, earn };
}
const refused = (r, pattern) => {
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.error.code, 'INSUFFICIENT_FUNDS', JSON.stringify(r.data));
  if (pattern) assert.match(r.data.error.message, pattern);
  return r.data.error;
};
const dr = (accountId, debit) => ({ accountId, debit, credit: 0 });
const cr = (accountId, credit) => ({ accountId, debit: 0, credit });

test('pengeluaran yang melebihi saldo dompet ditolak, sebesar saldo diterima, dan tidak ada yang tersimpan', async () => {
  const s = await startServer();
  try {
    const { balance, count, spend } = await setup(s);
    const before = await count();
    const e = refused(await spend(1_000_001), /Saldo Kas tidak cukup\. Pada 10 Jan 2026 saldonya hanya Rp 1\.000\.000.*kurang Rp 1/);
    assert.deepEqual([e.wallet, e.date, e.shortage, e.available], ['Kas', '2026-01-10', 1, 1_000_000]);
    assert.equal(await count(), before, 'tidak ada catatan baru');
    assert.equal(await balance('Kas'), 1_000_000, 'saldo tidak berubah');

    assert.equal((await spend(1_000_000)).status, 201, 'tepat sebesar saldo boleh');
    assert.equal(await balance('Kas'), 0);
    refused(await spend(1), /Saldo Kas tidak cukup.*hanya Rp 0/);
    // Dompet lain yang uangnya cukup tetap bisa dipakai.
    assert.equal((await spend(2_000_000, { wallet: 'Bank' })).status, 201);
  } finally {
    await s.close();
  }
});

test('pemasukan, setor modal, dan menerima utang tidak pernah ditolak', async () => {
  const s = await startServer();
  try {
    const { c, A, balance, earn } = await setup(s);
    assert.equal((await earn(10_000_000)).status, 201);
    assert.equal((await c.post('/api/transactions', { kind: 'capital_in', date: '2026-01-06', amount: 1_000_000, description: 'Modal', cashAccountId: A.Kas })).status, 201);
    assert.equal((await c.post('/api/debts', { kind: 'payable', mode: 'cash', amount: 3_000_000, date: '2026-01-07', description: 'Pinjam', cashAccountId: A.Kas })).status, 201);
    assert.equal(await balance('Kas'), 15_000_000);
  } finally {
    await s.close();
  }
});

test('transfer dan prive: dompet asal harus cukup', async () => {
  const s = await startServer();
  try {
    const { c, A, balance } = await setup(s);
    const transfer = (amount, from, to) => c.post('/api/transactions', { kind: 'transfer', date: '2026-01-10', amount, description: 'Pindah', cashAccountId: A[from], toAccountId: A[to] });
    refused(await transfer(1_500_000, 'Kas', 'Bank'), /Saldo Kas tidak cukup/);
    assert.equal((await transfer(1_000_000, 'Kas', 'Bank')).status, 201);
    assert.equal(await balance('Bank'), 6_000_000);
    assert.equal(await balance('Kas'), 0);
    const drawing = (amount, wallet) => c.post('/api/transactions', { kind: 'drawing', date: '2026-01-11', amount, description: 'Prive', cashAccountId: A[wallet] });
    refused(await drawing(1, 'Kas'), /Saldo Kas tidak cukup/);
    assert.equal((await drawing(500_000, 'Bank')).status, 201);
  } finally {
    await s.close();
  }
});

test('utang & piutang: meminjamkan uang dan membayar utang juga memeriksa saldo', async () => {
  const s = await startServer();
  try {
    const { c, A, balance } = await setup(s);
    const lend = (amount) => c.post('/api/debts', { kind: 'receivable', mode: 'cash', amount, date: '2026-01-10', description: 'Pinjamkan', contactName: 'Andi', cashAccountId: A.Kas });
    refused(await lend(1_000_001), /Saldo Kas tidak cukup/);
    assert.equal((await lend(400_000)).status, 201);
    assert.equal(await balance('Kas'), 600_000);

    // Utang usaha Rp2.000.000 (belum bayar). Bayar dari Kas yang hanya Rp600.000 → ditolak; dari Bank → boleh.
    const debt = await c.post('/api/debts', { kind: 'payable', mode: 'credit', amount: 2_000_000, date: '2026-01-11', description: 'Beli bahan', contactName: 'Toko', categoryId: A['Pembelian Barang (HPP)'] });
    assert.equal(debt.status, 201, JSON.stringify(debt.data));
    const pay = (amount, wallet) => c.post(`/api/debts/${debt.data.id}/payments`, { amount, date: '2026-01-12', cashAccountId: A[wallet] });
    refused(await pay(700_000, 'Kas'), /Saldo Kas tidak cukup/);
    assert.equal((await pay(700_000, 'Bank')).status, 201);
    // Menerima pembayaran piutang selalu boleh.
    const receivable = (await c.get('/api/debts?today=2026-02-01')).data.debts.find((d) => d.kind === 'receivable');
    assert.equal((await c.post(`/api/debts/${receivable.id}/payments`, { amount: 100_000, date: '2026-01-13', cashAccountId: A.Kas })).status, 201);
  } finally {
    await s.close();
  }
});

test('jurnal manual: baris kredit pada dompet yang tidak cukup ditolak', async () => {
  const s = await startServer();
  try {
    const { c, A, balance } = await setup(s);
    const journal = (amount, wallet) => c.post('/api/journal', { date: '2026-01-10', description: 'Beli peralatan', lines: [dr(A.Peralatan, amount), cr(A[wallet], amount)] });
    refused(await journal(1_200_000, 'Kas'), /Saldo Kas tidak cukup/);
    assert.equal((await journal(1_200_000, 'Bank')).status, 201);
    assert.equal(await balance('Bank'), 3_800_000);
    // Jurnal yang menambah dompet (debit) tidak dibatasi.
    assert.equal((await c.post('/api/journal', { date: '2026-01-11', description: 'Setoran', lines: [dr(A.Kas, 9_000_000), cr(A.Modal, 9_000_000)] })).status, 201);
  } finally {
    await s.close();
  }
});

test('mengubah transaksi: tidak boleh melewati saldo, memperkecil boleh', async () => {
  const s = await startServer();
  try {
    const { c, A, balance, spend } = await setup(s);
    const id = (await spend(600_000)).data.id;
    const edit = (body) => c.patch(`/api/transactions/${id}`, { kind: 'expense', date: '2026-01-10', amount: 600_000, description: 'Uji', categoryId: A.Sewa, cashAccountId: A.Kas, ...body });

    refused(await edit({ amount: 1_000_001 }), /perubahan ini membuatnya kurang Rp 1\b/);
    assert.equal(await balance('Kas'), 400_000, 'tidak berubah setelah ditolak');
    assert.equal((await edit({ amount: 1_000_000 })).status, 200, 'naik sampai tepat habis boleh (uang lamanya ikut dihitung)');
    assert.equal(await balance('Kas'), 0);
    assert.equal((await edit({ amount: 100_000 })).status, 200);
    assert.equal(await balance('Kas'), 900_000);

    // Pindah ke dompet yang uangnya lebih sedikit.
    assert.equal((await spend(4_900_000, { wallet: 'Bank' })).status, 201); // Bank tinggal 100.000
    refused(await edit({ amount: 500_000, cashAccountId: A.Bank }), /Saldo Bank tidak cukup/);
  } finally {
    await s.close();
  }
});

test('saldo dihitung per tanggal: transaksi bertanggal mundur tidak boleh membuat hari-hari sesudahnya minus', async () => {
  const s = await startServer();
  try {
    const { c, A, balance, spend, earn } = await setup(s);
    // 1 Jan saldo Kas 1.000.000; 10 Jan pengeluaran 900.000 (sisa 100.000); 20 Jan pemasukan 2.000.000.
    assert.equal((await spend(900_000, { date: '2026-01-10' })).status, 201);
    assert.equal((await earn(2_000_000, { date: '2026-01-20' })).status, 201);
    assert.equal(await balance('Kas'), 2_100_000, 'saldo hari ini besar');

    // 5 Jan Rp200.000 membuat 10 Jan minus (1.000.000 − 200.000 − 900.000 = −100.000) → ditolak, walau saldo hari ini besar.
    const e = refused(await spend(200_000, { date: '2026-01-05' }), /Pada 10 Jan 2026/);
    assert.equal(e.date, '2026-01-10');
    assert.equal(e.shortage, 100_000);
    // Rp100.000 pas → boleh.
    assert.equal((await spend(100_000, { date: '2026-01-05' })).status, 201);
    // Pengeluaran besar bertanggal SESUDAH pemasukan, boleh.
    assert.equal((await spend(2_000_000, { date: '2026-01-21' })).status, 201);
    // Sebelum saldo awal (1 Jan) tidak ada uang sama sekali.
    refused(await spend(1, { date: '2025-12-31' }), /Pada 31 Des 2025 saldonya hanya Rp 0/);
    // Pemasukan dan pengeluaran di hari yang sama dihitung bersih: yang penting saldo akhir hari tidak minus.
    refused(await spend(300_000, { date: '2026-01-26' }), /Saldo Kas tidak cukup/); // belum ada uang masuk hari itu
    assert.equal((await earn(300_000, { date: '2026-01-26' })).status, 201);
    assert.equal((await spend(300_000, { date: '2026-01-26' })).status, 201);
    assert.equal(await balance('Kas'), 0);
  } finally {
    await s.close();
  }
});

test('menghapus atau memperkecil pemasukan ditolak kalau uangnya sudah terpakai', async () => {
  const s = await startServer();
  try {
    const { c, A, balance, spend, earn } = await setup(s);
    const income = (await earn(3_000_000, { wallet: 'Bank', date: '2026-01-05' })).data.id; // Bank 8.000.000
    const spent = (await spend(7_500_000, { wallet: 'Bank', date: '2026-01-10' })).data.id; // sisa 500.000

    const del = await c.del(`/api/entries/${income}`);
    refused(del, /tidak bisa dihapus karena uang darinya sudah terpakai.*Bank/);
    assert.equal(await balance('Bank'), 500_000);

    // Memperkecil pemasukan sampai uangnya kurang untuk pengeluaran sesudahnya → ditolak.
    const shrink = (amount) => c.patch(`/api/transactions/${income}`, { kind: 'income', date: '2026-01-05', amount, description: 'Masuk', categoryId: A['Pendapatan Penjualan'], cashAccountId: A.Bank });
    refused(await shrink(2_000_000), /perubahan ini/);
    assert.equal((await shrink(2_600_000)).status, 200, 'masih cukup (kurang 400.000 dari semula)');

    // Menghapus pengeluarannya dulu → barulah pemasukan boleh dihapus.
    assert.equal((await c.del(`/api/entries/${spent}`)).status, 200);
    assert.equal((await c.del(`/api/entries/${income}`)).status, 200);
    assert.equal(await balance('Bank'), 5_000_000);
  } finally {
    await s.close();
  }
});

test('saldo awal: tidak boleh diperkecil di bawah yang sudah terpakai', async () => {
  const s = await startServer();
  try {
    const { c, A, balance, spend } = await setup(s);
    assert.equal((await spend(900_000)).status, 201);
    const opening = (await c.get('/api/reports/journal?from=2026-01-01&to=2026-01-01')).data.entries.find((e) => e.kind === 'opening');
    const edit = (cash) => c.patch(`/api/journal/${opening.id}`, {
      date: '2026-01-01', description: 'Saldo awal',
      lines: [dr(A.Kas, cash), dr(A.Bank, 5_000_000), cr(A.Modal, cash + 5_000_000)],
    });
    refused(await edit(500_000), /Saldo Kas tidak cukup/);
    assert.equal((await edit(900_000)).status, 200);
    assert.equal((await edit(2_000_000)).status, 200, 'diperbesar selalu boleh');
    assert.equal(await balance('Kas'), 1_100_000);
  } finally {
    await s.close();
  }
});

test('menghapus utang/faktur beserta pelunasannya diperiksa sekali, bukan satu per satu', async () => {
  const s = await startServer();
  try {
    const { c, A, balance, spend } = await setup(s);
    // Meminjamkan 1.000.000 lalu menerima kembali 1.000.000 → bersih nol. Uang dihabiskan sesudahnya.
    const lent = (await c.post('/api/debts', { kind: 'receivable', mode: 'cash', amount: 1_000_000, date: '2026-01-02', description: 'Pinjamkan', contactName: 'Budi', cashAccountId: A.Kas })).data.id;
    assert.equal((await c.post(`/api/debts/${lent}/payments`, { amount: 1_000_000, date: '2026-01-03', cashAccountId: A.Kas })).status, 201);
    assert.equal((await spend(1_000_000, { date: '2026-01-10' })).status, 201); // Kas 0
    // Menghapus utang itu (pinjaman + pelunasan) berselisih nol bagi dompet, jadi harus boleh.
    assert.equal((await c.del(`/api/debts/${lent}`)).status, 200);
    assert.equal(await balance('Kas'), 0);

    // Pinjaman uang yang sudah dihabiskan tidak bisa dihapus.
    const loan = (await c.post('/api/debts', { kind: 'payable', mode: 'cash', amount: 500_000, date: '2026-01-11', description: 'Pinjam', cashAccountId: A.Kas })).data.id;
    assert.equal((await spend(500_000, { date: '2026-01-12' })).status, 201);
    refused(await c.del(`/api/debts/${loan}`), /tidak bisa dihapus/);

    // Faktur yang pembayarannya sudah dipakai belanja: menghapus faktur ditolak.
    const inv = (await c.post('/api/invoices', { issueDate: '2026-01-15', customerName: 'PT X', categoryId: A['Pendapatan Jasa'], items: [{ description: 'Jasa', quantity: 1, unitPrice: 800_000 }] })).data.id;
    assert.equal((await c.post(`/api/invoices/${inv}/payments`, { amount: 800_000, date: '2026-01-16', cashAccountId: A.Bank })).status, 201);
    assert.equal((await spend(5_700_000, { wallet: 'Bank', date: '2026-01-17' })).status, 201);
    refused(await c.del(`/api/invoices/${inv}`), /tidak bisa dihapus/);
    // Pembayaran faktur dihapus dulu pun sama: uangnya sudah terpakai.
    const debt = (await c.get('/api/debts?today=2026-02-01')).data.debts.find((d) => d.invoice);
    refused(await c.del(`/api/debts/${debt.id}/payments/${debt.payments[0].id}`), /tidak bisa dihapus/);
  } finally {
    await s.close();
  }
});

test('saldo yang sudah minus dari data lama boleh diperbaiki, tapi tidak boleh makin dalam', async () => {
  const s = await startServer();
  try {
    const { c, A, balance, spend, earn } = await setup(s);
    assert.equal((await spend(800_000, { date: '2026-01-10' })).status, 201);
    // Meniru data lama (dibuat sebelum aturan ada): saldo awal Kas diturunkan langsung di database → Kas −700.000.
    await s.db.run('UPDATE lines SET debit = 100000 WHERE account_id = ? AND debit = 1000000', A.Kas);
    await s.db.run('UPDATE lines SET credit = 5100000 WHERE account_id = ? AND credit = 6000000', A.Modal);
    assert.equal(await balance('Kas'), -700_000);

    refused(await spend(1, { date: '2026-01-15' }), /Saldo Kas tidak cukup/);
    assert.equal((await earn(300_000, { date: '2026-01-15' })).status, 201, 'menambah uang selalu boleh');
    assert.equal(await balance('Kas'), -400_000);
    assert.equal((await earn(1_000_000, { date: '2026-01-16' })).status, 201);
    assert.equal(await balance('Kas'), 600_000);
    assert.equal((await spend(600_000, { date: '2026-01-20' })).status, 201);
  } finally {
    await s.close();
  }
});

test('dua pengeluaran yang masuk bersamaan tidak bisa sama-sama lolos melewati saldo', async () => {
  const s = await startServer();
  try {
    const { balance, count, spend } = await setup(s);
    const before = await count();
    const results = await Promise.all(Array.from({ length: 6 }, () => spend(400_000)));
    const ok = results.filter((r) => r.status === 201).length;
    assert.equal(ok, 2, `hanya 2 × 400.000 yang muat di saldo 1.000.000, tetapi ${ok} berhasil`);
    assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 400 && r.data.error.code === 'INSUFFICIENT_FUNDS'), 'sisanya ditolak rapi, bukan error server');
    assert.equal(await balance('Kas'), 200_000);
    assert.equal(await count(), before + 2);
  } finally {
    await s.close();
  }
});

test('impor: pratinjau memperingatkan, dan penyimpanan menolak seluruh impor kalau saldo jadi minus', async () => {
  const s = await startServer();
  try {
    const c = s.client();
    await s.signUp(c, { email: 'od-impor@contoh.test', usage: 'usaha', openingCash: 100_000, openingBank: 0, date: '2026-01-01' });
    const csv = 'Tanggal,Jenis,Jumlah,Dompet,Keterangan\n2026-01-05,Pengeluaran,150000,Kas,Beli A\n2026-01-06,Pemasukan,500000,Kas,Jual B\n';
    const post = (action, body, query = '') => fetch(`${s.base}/api/import/${action}${query}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-requested-with': 'BudgetTracker', cookie: c.cookie }, body });

    // 5 Jan: Kas 100.000 − 150.000 → minus, walau 6 Jan ada pemasukan.
    const preview = await (await post('preview', csv)).json();
    assert.equal(preview.summary.overdraft.wallet, 'Kas');
    assert.equal(preview.summary.overdraft.date, '2026-01-05');
    assert.equal(preview.summary.overdraft.shortage, 50_000);
    const res = await post('commit', csv);
    assert.equal(res.status, 400);
    const err = (await res.json()).error;
    assert.equal(err.code, 'INSUFFICIENT_FUNDS');
    assert.match(err.message, /Impor ini membuat saldo Kas minus pada 5 Jan 2026/);
    assert.equal((await c.get('/api/transactions')).data.total, 1, 'tidak ada yang tersimpan (hanya saldo awal)');

    // Pemasukan lebih dulu (5 Jan) → lolos.
    const fixed = 'Tanggal,Jenis,Jumlah,Dompet,Keterangan\n2026-01-05,Pemasukan,500000,Kas,Jual B\n2026-01-06,Pengeluaran,150000,Kas,Beli A\n';
    assert.equal((await (await post('preview', fixed)).json()).summary.overdraft, null);
    assert.equal((await post('commit', fixed)).status, 201);
  } finally {
    await s.close();
  }
});

test('firstOverdraft: perhitungan per tanggal', () => {
  const rows = [{ date: '2026-01-01', net: 1000 }, { date: '2026-01-10', net: -900 }, { date: '2026-01-20', net: 2000 }];
  // Perubahan −200 di 5 Jan (belum tertulis): 10 Jan jadi 1000 − 200 − 900 = −100.
  assert.deepEqual(firstOverdraft(rows, new Map([['2026-01-05', -200]]), false), { date: '2026-01-10', shortage: 100, before: 100 });
  // Perubahan positif tidak pernah melanggar.
  assert.equal(firstOverdraft(rows, new Map([['2026-01-05', 200]]), false), null);
  // Sudah tertulis (applied): saldo di database sudah memuat perubahan.
  const written = [{ date: '2026-01-01', net: 1000 }, { date: '2026-01-05', net: -200 }, { date: '2026-01-10', net: -900 }];
  assert.deepEqual(firstOverdraft(written, new Map([['2026-01-05', -200]]), true), { date: '2026-01-10', shortage: 100, before: 100 });
  // Saldo yang sudah minus dari awal dan perubahan nol/positif: lolos. Perubahan negatif: ditolak.
  const legacy = [{ date: '2026-01-01', net: -500 }];
  assert.equal(firstOverdraft(legacy, new Map([['2026-01-03', 300]]), false), null);
  assert.equal(firstOverdraft(legacy, new Map([['2026-01-03', -1]]), false).shortage, 501);
  // Perubahan bersih nol tidak dipermasalahkan.
  assert.equal(firstOverdraft(legacy, new Map([['2026-01-03', 0]]), false), null);
  // Memindah pengeluaran 50 dari 10 Jan ke 2 Jan (−50 di tanggal baru, +50 di tanggal lama).
  const move = new Map([['2026-01-02', -50], ['2026-01-10', 50]]);
  assert.equal(firstOverdraft([{ date: '2026-01-01', net: 100 }, { date: '2026-01-10', net: -50 }], move, false), null, 'saldo 100 cukup');
  assert.deepEqual(firstOverdraft([{ date: '2026-01-01', net: 40 }, { date: '2026-01-05', net: 100 }, { date: '2026-01-10', net: -50 }], move, false), { date: '2026-01-02', shortage: 10, before: 40 }, 'baru 5 Jan ada uang masuk');
});
