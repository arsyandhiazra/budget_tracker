import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

// Skenario lengkap dengan angka yang dihitung manual, supaya ketahuan
// kalau ada laporan yang angkanya meleset walau satu rupiah.
async function seedScenario(s, c) {
  await s.signUp(c, { email: `pemilik-${Math.random().toString(36).slice(2)}@contoh.test`, usage: 'usaha', openingCash: 1_000_000, openingBank: 5_000_000, date: '2026-01-01' });
  const accounts = (await c.get('/api/accounts')).data.accounts;
  const A = Object.fromEntries(accounts.map((a) => [a.name, a.id]));
  const ok = (r, status = 201) => { assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };
  const post = async (path, body, status = 201) => ok(await c.post(path, body), status);

  const ids = {};
  ids.t1 = (await post('/api/transactions', { kind: 'income', date: '2026-01-05', amount: 3_000_000, description: 'Jual barang', categoryId: A['Pendapatan Penjualan'], cashAccountId: A.Bank })).id;
  ids.t2 = (await post('/api/transactions', { kind: 'expense', date: '2026-01-06', amount: 1_200_000, description: 'Sewa kios', categoryId: A.Sewa, cashAccountId: A.Bank })).id;
  ids.t3 = (await post('/api/transactions', { kind: 'expense', date: '2026-01-07', amount: 150_000, description: 'Makan siang tim', categoryId: A['Makan & Minum'], cashAccountId: A.Kas })).id;
  ids.t4 = (await post('/api/transactions', { kind: 'transfer', date: '2026-01-08', amount: 500_000, description: 'Tarik tunai', cashAccountId: A.Bank, toAccountId: A.Kas })).id;
  ids.t5 = (await post('/api/transactions', { kind: 'capital_in', date: '2026-01-09', amount: 2_000_000, description: 'Tambah modal', cashAccountId: A.Bank })).id;
  ids.t6 = (await post('/api/transactions', { kind: 'drawing', date: '2026-01-10', amount: 300_000, description: 'Ambil untuk pribadi', cashAccountId: A.Kas })).id;
  ids.d7 = (await post('/api/debts', { kind: 'payable', mode: 'cash', amount: 4_000_000, date: '2026-01-11', dueDate: '2026-03-01', description: 'Pinjaman modal', contactName: 'Bank Maju', cashAccountId: A.Bank })).id;
  ids.d8 = (await post('/api/debts', { kind: 'payable', mode: 'credit', amount: 600_000, date: '2026-01-12', description: 'Beli ATK', contactName: 'Toko ATK', categoryId: A.Perlengkapan })).id;
  ids.d9 = (await post('/api/debts', { kind: 'receivable', mode: 'credit', amount: 2_500_000, date: '2026-01-13', dueDate: '2026-01-20', description: 'Jasa desain', contactName: 'PT Klien', categoryId: A['Pendapatan Jasa'] })).id;
  ids.d10 = (await post('/api/debts', { kind: 'receivable', mode: 'cash', amount: 200_000, date: '2026-01-14', description: 'Pinjaman ke teman', contactName: 'Andi', cashAccountId: A.Kas })).id;
  ids.p11 = (await post(`/api/debts/${ids.d7}/payments`, { amount: 1_000_000, date: '2026-01-15', cashAccountId: A.Bank })).id;
  ids.p12 = (await post(`/api/debts/${ids.d9}/payments`, { amount: 1_500_000, date: '2026-01-16', cashAccountId: A.Bank })).id;
  ids.j13 = (await post('/api/journal', {
    date: '2026-01-17', description: 'Beli etalase, sebagian dicicil',
    lines: [
      { accountId: A.Peralatan, debit: 5_000_000, credit: 0 },
      { accountId: A.Bank, debit: 0, credit: 2_000_000 },
      { accountId: A['Utang Usaha'], debit: 0, credit: 3_000_000 },
    ],
  })).id;
  ids.t14 = (await post('/api/transactions', { kind: 'expense', date: '2026-02-03', amount: 2_000_000, description: 'Gaji Februari', categoryId: A['Gaji Karyawan'], cashAccountId: A.Bank })).id;
  ids.t15 = (await post('/api/transactions', { kind: 'income', date: '2026-02-04', amount: 4_000_000, description: 'Jual barang', categoryId: A['Pendapatan Penjualan'], cashAccountId: A.Kas })).id;
  return { A, ids };
}

const JAN = 'from=2026-01-01&to=2026-01-31';
const FEB = 'from=2026-02-01&to=2026-02-28';
const ALL = 'from=2026-01-01&to=2026-02-28';

test('laporan keuangan cocok dengan hitungan manual dan selalu seimbang', async () => {
  const s = await startServer();
  try {
    const c = s.client();
    const { A } = await seedScenario(s, c);
    const get = async (path) => { const r = await c.get(path); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };

    // Saldo akun
    const bal = Object.fromEntries((await get('/api/accounts')).accounts.map((a) => [a.name, a.balance]));
    assert.equal(bal.Kas, 4_850_000);
    assert.equal(bal.Bank, 8_800_000);
    assert.equal(bal.Piutang, 1_200_000);
    assert.equal(bal.Peralatan, 5_000_000);
    assert.equal(bal['Utang Usaha'], 3_600_000);
    assert.equal(bal['Utang Pinjaman'], 3_000_000);
    assert.equal(bal.Modal, 8_000_000);
    assert.equal(bal['Prive (Tarik Modal)'], 300_000);

    // Neraca saldo
    const tb = await get('/api/reports/trial-balance?to=2026-02-28');
    assert.equal(tb.totalDebit, 24_100_000);
    assert.equal(tb.totalCredit, 24_100_000);
    assert.equal(tb.balanced, true);

    // Laba rugi
    const isJan = await get(`/api/reports/income-statement?${JAN}`);
    assert.equal(isJan.totalIncome, 5_500_000);
    assert.equal(isJan.totalExpense, 1_950_000);
    assert.equal(isJan.net, 3_550_000);
    const isAll = await get(`/api/reports/income-statement?${ALL}`);
    assert.equal(isAll.net, 5_550_000);
    assert.equal(isAll.sections.find((x) => x.key === 'operating').total, 3_950_000);

    // Neraca
    const bs = await get('/api/reports/balance-sheet?to=2026-02-28');
    assert.equal(bs.assets.total, 19_850_000);
    assert.equal(bs.assets.totalFixed, 5_000_000);
    assert.equal(bs.liabilities.total, 6_600_000);
    assert.equal(bs.equity.total, 13_250_000);
    assert.equal(bs.balanced, true);
    const bsJan = await get('/api/reports/balance-sheet?to=2026-01-31');
    assert.equal(bsJan.balanced, true);
    assert.equal(bsJan.equity.total, 11_250_000);

    // Perubahan modal
    const eqJan = await get(`/api/reports/equity?${JAN}`);
    assert.deepEqual([eqJan.opening, eqJan.contributions, eqJan.net, eqJan.drawings, eqJan.closing], [0, 8_000_000, 3_550_000, 300_000, 11_250_000]);
    const eqFeb = await get(`/api/reports/equity?${FEB}`);
    assert.deepEqual([eqFeb.opening, eqFeb.contributions, eqFeb.net, eqFeb.drawings, eqFeb.closing], [11_250_000, 0, 2_000_000, 0, 13_250_000]);
    assert.equal(eqFeb.closing, bs.equity.total, 'modal akhir = modal di neraca');

    // Arus kas
    const cfJan = await get(`/api/reports/cash-flow?${JAN}`);
    const sec = (cf, key) => cf.sections.find((x) => x.key === key).total;
    assert.equal(cfJan.opening, 0);
    assert.equal(sec(cfJan, 'operating'), 5_950_000);
    assert.equal(sec(cfJan, 'investing'), -5_000_000);
    assert.equal(sec(cfJan, 'financing'), 10_700_000);
    assert.equal(cfJan.netChange, 11_650_000);
    assert.equal(cfJan.closing, 11_650_000);
    assert.equal(cfJan.consistent, true);
    const cfFeb = await get(`/api/reports/cash-flow?${FEB}`);
    assert.deepEqual([cfFeb.opening, cfFeb.netChange, cfFeb.closing, cfFeb.consistent], [11_650_000, 2_000_000, 13_650_000, true]);

    // Buku besar
    const ledger = await get(`/api/reports/ledger?${FEB}&accountId=${A.Bank}`);
    assert.equal(ledger.accounts.length, 1);
    assert.equal(ledger.accounts[0].openingBalance, 10_800_000);
    assert.equal(ledger.accounts[0].closingBalance, 8_800_000);
    const ledgerAll = await get(`/api/reports/ledger?${ALL}`);
    const kas = ledgerAll.accounts.find((a) => a.name === 'Kas');
    assert.equal(kas.lines.at(-1).balance, 4_850_000);
    assert.equal(kas.lines.length, 6);

    // Jurnal umum
    const journal = await get(`/api/reports/journal?${ALL}`);
    assert.equal(journal.entries.length, 16);
    assert.equal(journal.totalDebit, journal.totalCredit);
    for (const e of journal.entries) {
      assert.equal(e.lines.reduce((x, l) => x + l.debit, 0), e.lines.reduce((x, l) => x + l.credit, 0), `jurnal #${e.id} seimbang`);
    }

    // Utang piutang
    const debts = await get('/api/debts?today=2026-02-28');
    assert.deepEqual(debts.totals, { payable: 3_600_000, receivable: 1_200_000 });
    const klien = debts.debts.find((d) => d.contact?.name === 'PT Klien');
    assert.equal(klien.remaining, 1_000_000);
    assert.equal(klien.status, 'overdue');
    assert.equal(debts.debts.find((d) => d.contact?.name === 'Bank Maju').status, 'open');
    const dr = await get('/api/reports/debts?today=2026-02-28');
    assert.equal(dr.receivable.overdue, 1_000_000);

    // Anggaran
    assert.equal((await c.put(`/api/budgets/${A['Makan & Minum']}`, { amount: 100_000 })).status, 200);
    assert.equal((await c.put(`/api/budgets/${A.Sewa}`, { amount: 1_500_000 })).status, 200);
    assert.equal((await c.put(`/api/budgets/${A.Bank}`, { amount: 1 })).status, 400, 'anggaran hanya untuk kategori pengeluaran');
    const budget = await get('/api/budgets?month=2026-01');
    assert.equal(budget.totalBudget, 1_600_000);
    assert.equal(budget.totalSpent, 1_350_000);
    assert.equal(budget.items.find((b) => b.name === 'Makan & Minum').spent, 150_000);

    // Dasbor
    const dash = await get(`/api/dashboard?${JAN}&pfrom=2025-12-01&pto=2025-12-31&today=2026-02-28`);
    assert.deepEqual(dash.kpis, { cashBalance: 11_650_000, income: 5_500_000, expense: 1_950_000, net: 3_550_000 });
    assert.deepEqual(dash.previous, { income: 0, expense: 0, net: 0 });
    assert.equal(dash.monthly.length, 6);
    assert.deepEqual(dash.monthly.at(-1), { month: '2026-01', income: 5_500_000, expense: 1_950_000 });
    assert.equal(dash.expenseByCategory[0].name, 'Sewa');
    assert.equal(dash.cashTrend.at(-1).balance, 11_650_000);
    assert.equal(dash.cashTrend[0].date, '2026-01-01');
    assert.equal(dash.cashTrend[0].balance, 6_000_000);
    assert.equal(dash.budget.month, '2026-01');
    const dashFeb = await get(`/api/dashboard?${FEB}&today=2026-02-28`);
    assert.equal(dashFeb.kpis.cashBalance, 13_650_000);
    assert.deepEqual(dashFeb.monthly.at(-1), { month: '2026-02', income: 4_000_000, expense: 2_000_000 });

    // Daftar transaksi + pencarian
    const list = await get(`/api/transactions?${ALL}&kind=expense`);
    assert.equal(list.total, 3);
    assert.equal(list.totals.expense, 3_350_000);
    assert.equal(list.items[0].category.name, 'Gaji Karyawan');
    assert.equal(list.items[0].cashAccount.name, 'Bank');
    assert.equal((await get(`/api/transactions?q=${encodeURIComponent('makan')}`)).total, 1);
    assert.equal((await get(`/api/transactions?q=${encodeURIComponent('100%')}`)).total, 0, 'tanda % dicari apa adanya');

    // Ekspor Excel untuk semua laporan
    for (const name of ['journal', 'ledger', 'trial-balance', 'income-statement', 'balance-sheet', 'equity', 'cash-flow', 'debts']) {
      const res = await c.get(`/api/reports/${name}/export?${ALL}`, { raw: true });
      assert.equal(res.status, 200, name);
      assert.match(res.headers.get('content-type'), /spreadsheetml/);
      const buf = Buffer.from(await res.arrayBuffer());
      assert.equal(buf.subarray(0, 2).toString(), 'PK', `${name} berupa file zip/xlsx`);
      assert.ok(buf.length > 800);
    }

    // Cadangan data
    const backup = await get('/api/backup');
    assert.equal(backup.entries.length, 16);
    assert.equal(backup.debts.length, 4);
  } finally {
    await s.close();
  }
});

test('ubah & hapus: angka ikut berubah, catatan terhubung terlindungi', async () => {
  const s = await startServer();
  try {
    const c = s.client();
    const { A, ids } = await seedScenario(s, c);
    const balance = async (name) => (await c.get('/api/accounts')).data.accounts.find((a) => a.name === name).balance;

    // Ubah jumlah pengeluaran
    let r = await c.patch(`/api/transactions/${ids.t3}`, { kind: 'expense', date: '2026-01-07', amount: 175_000, description: 'Makan siang tim (revisi)', categoryId: A['Makan & Minum'], cashAccountId: A.Kas });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(await balance('Kas'), 4_825_000);
    r = await c.patch(`/api/transactions/${ids.t3}`, { kind: 'income', date: '2026-01-07', amount: 175_000, description: 'x', categoryId: A['Pendapatan Jasa'], cashAccountId: A.Kas });
    assert.equal(r.status, 400, 'jenis transaksi tidak bisa diganti');

    // Hapus transaksi biasa
    assert.equal((await c.del(`/api/entries/${ids.t3}`)).status, 200);
    assert.equal(await balance('Kas'), 5_000_000);

    // Catatan utang tidak bisa dihapus/diubah lewat jalur umum
    const debtEntry = (await s.db.get('SELECT entry_id FROM debts WHERE id = ?', ids.d7)).entry_id;
    assert.equal((await c.del(`/api/entries/${debtEntry}`)).status, 400);
    assert.equal((await c.patch(`/api/journal/${debtEntry}`, { date: '2026-01-11', description: 'x', lines: [] })).status, 400);

    // Bayar melebihi sisa ditolak
    r = await c.post(`/api/debts/${ids.d7}/payments`, { amount: 3_000_001, date: '2026-02-10', cashAccountId: A.Bank });
    assert.equal(r.status, 400);
    r = await c.post(`/api/debts/${ids.d7}/payments`, { amount: 100, date: '2026-01-01', cashAccountId: A.Bank });
    assert.equal(r.status, 400, 'tanggal bayar sebelum tanggal utang ditolak');

    // Hapus pembayaran → sisa utang kembali
    assert.equal((await c.del(`/api/debts/${ids.d7}/payments/${ids.p11}`)).status, 200);
    assert.equal(await balance('Utang Pinjaman'), 4_000_000);
    assert.equal(await balance('Bank'), 9_800_000);

    // Lunasi lalu hapus utang beserta semua pembayarannya
    assert.equal((await c.post(`/api/debts/${ids.d7}/payments`, { amount: 4_000_000, date: '2026-02-10', cashAccountId: A.Bank })).status, 201);
    assert.equal((await c.get('/api/debts?today=2026-02-28')).data.debts.find((d) => d.id === ids.d7).status, 'paid');
    assert.equal((await c.del(`/api/debts/${ids.d7}`)).status, 200);
    assert.equal(await balance('Utang Pinjaman'), 0);
    assert.equal(await balance('Bank'), 5_800_000, 'uang pinjaman dan pelunasannya ikut terhapus');
    assert.equal((await s.db.get('SELECT COUNT(*) AS n FROM debt_payments WHERE debt_id = ?', ids.d7)).n, 0);

    // Ubah jurnal manual
    r = await c.patch(`/api/journal/${ids.j13}`, {
      date: '2026-01-17', description: 'Beli etalase tunai',
      lines: [{ accountId: A.Peralatan, debit: 5_000_000, credit: 0 }, { accountId: A.Bank, debit: 0, credit: 5_000_000 }],
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(await balance('Utang Usaha'), 600_000);

    // Setelah semua perubahan, pembukuan tetap seimbang.
    const bs = (await c.get('/api/reports/balance-sheet?to=2026-12-31')).data;
    assert.equal(bs.balanced, true);
    const cf = (await c.get('/api/reports/cash-flow?from=2026-01-01&to=2026-12-31')).data;
    assert.equal(cf.consistent, true);

    // Akun: yang sudah dipakai tidak bisa dihapus, yang baru bisa
    assert.equal((await c.del(`/api/accounts/${A.Sewa}`)).status, 400);
    assert.equal((await c.del(`/api/accounts/${A.Kas}`)).status, 400, 'akun bawaan terlindungi');
    r = await c.post('/api/accounts', { name: 'Ongkos Kirim', type: 'expense' });
    assert.equal(r.status, 201);
    assert.equal((await c.post('/api/accounts', { name: 'ongkos kirim', type: 'expense' })).status, 400, 'nama kembar ditolak');
    assert.equal((await c.patch(`/api/accounts/${r.data.id}`, { name: 'Ongkir', archived: true })).status, 200);
    r = await c.post('/api/transactions', { kind: 'expense', date: '2026-02-11', amount: 1000, description: 'tes', categoryId: r.data.id, cashAccountId: A.Kas });
    assert.equal(r.status, 400, 'akun arsip tidak bisa dipakai');

    // Kontak
    const contacts = (await c.get('/api/contacts')).data.contacts;
    const klien = contacts.find((k) => k.name === 'PT Klien');
    assert.equal(klien.receivable, 1_000_000);
    assert.equal((await c.del(`/api/contacts/${klien.id}`)).status, 400, 'kontak dengan piutang aktif terlindungi');
    r = await c.post('/api/contacts', { name: 'Bu Rina', type: 'customer', email: 'rina@contoh.test', phone: '0812' });
    assert.equal(r.status, 201);
    assert.equal((await c.patch(`/api/contacts/${r.data.id}`, { name: 'Ibu Rina', type: 'customer' })).status, 200);
    assert.equal((await c.del(`/api/contacts/${r.data.id}`)).status, 200);
  } finally {
    await s.close();
  }
});

test('data yang salah ditolak dengan pesan yang jelas', async () => {
  const s = await startServer();
  try {
    const c = s.client();
    await s.signUp(c, { email: 'validasi@contoh.test', openingCash: 100_000 });
    const A = Object.fromEntries((await c.get('/api/accounts')).data.accounts.map((a) => [a.name, a.id]));
    const base = { kind: 'expense', date: '2026-01-05', amount: 10_000, description: 'Tes', categoryId: A.Sewa, cashAccountId: A.Kas };
    const bad = async (body, path = '/api/transactions') => { const r = await c.post(path, body); assert.equal(r.status, 400, JSON.stringify(r.data)); return r.data.error.message; };

    await bad({ ...base, amount: 0 });
    await bad({ ...base, amount: -5 });
    await bad({ ...base, amount: 10.5 });
    await bad({ ...base, amount: 'banyak' });
    await bad({ ...base, amount: 1e18 });
    await bad({ ...base, date: '2026-02-30' });
    await bad({ ...base, date: 'kemarin' });
    await bad({ ...base, description: '' });
    await bad({ ...base, description: 'x'.repeat(201) });
    await bad({ ...base, categoryId: A.Kas }, '/api/transactions');
    await bad({ ...base, cashAccountId: A.Sewa });
    await bad({ ...base, categoryId: 999999 });
    await bad({ ...base, kind: 'ngawur' });
    await bad({ kind: 'transfer', date: '2026-01-05', amount: 1, description: 'x', cashAccountId: A.Kas, toAccountId: A.Kas });

    // Jurnal manual
    const j = (lines) => ({ date: '2026-01-05', description: 'Jurnal tes', lines });
    assert.match(await bad(j([{ accountId: A.Kas, debit: 100, credit: 0 }, { accountId: A.Bank, debit: 0, credit: 90 }]), '/api/journal'), /seimbang/);
    await bad(j([{ accountId: A.Kas, debit: 100, credit: 0 }]), '/api/journal');
    await bad(j([{ accountId: A.Kas, debit: 100, credit: 100 }, { accountId: A.Bank, debit: 0, credit: 0 }]), '/api/journal');
    await bad(j('bukan daftar'), '/api/journal');

    // Utang
    await bad({ kind: 'payable', mode: 'cash', amount: 1000, date: '2026-01-10', dueDate: '2026-01-01', description: 'x', cashAccountId: A.Kas }, '/api/debts');

    // JSON rusak & badan terlalu besar
    let res = await fetch(`${s.base}/api/transactions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'BudgetTracker', cookie: c.cookie }, body: '{rusak' });
    assert.equal(res.status, 400);
    res = await fetch(`${s.base}/api/transactions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'BudgetTracker', cookie: c.cookie }, body: JSON.stringify({ description: 'x'.repeat(200_000) }) });
    assert.equal(res.status, 413);

    // Permintaan tanpa isi sama sekali, atau isinya bukan objek → ditolak rapi (400), bukan error server.
    for (const path of ['/api/transactions', '/api/journal', '/api/debts', '/api/contacts', '/api/accounts', '/api/chat']) {
      res = await fetch(`${s.base}${path}`, { method: 'POST', headers: { 'x-requested-with': 'BudgetTracker', cookie: c.cookie } });
      assert.equal(res.status, 400, `${path} tanpa isi`);
      res = await fetch(`${s.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'BudgetTracker', cookie: c.cookie }, body: '[1,2,3]' });
      assert.equal(res.status, 400, `${path} dengan isi berupa daftar`);
    }
    for (const path of ['/api/auth/register', '/api/auth/login', '/api/auth/verify', '/api/auth/forgot', '/api/auth/reset', '/api/auth/resend']) {
      res = await fetch(`${s.base}${path}`, { method: 'POST', headers: { 'x-requested-with': 'BudgetTracker' } });
      assert.equal(res.status, 400, `${path} tanpa isi`);
    }

    // Tidak ada yang tersimpan dari semua percobaan gagal di atas.
    assert.equal((await c.get('/api/transactions')).data.total, 1, 'hanya saldo awal');
    assert.equal((await c.get('/api/reports/laporan-ngawur')).status, 404);
  } finally {
    await s.close();
  }
});

test('data antar pengguna terpisah total', async () => {
  const s = await startServer();
  try {
    const a = s.client();
    const b = s.client();
    const { A, ids } = await seedScenario(s, a);
    await s.signUp(b, { email: 'tetangga@contoh.test', usage: 'pribadi', openingCash: 50_000 });
    const B = Object.fromEntries((await b.get('/api/accounts')).data.accounts.map((x) => [x.name, x.id]));

    // B tidak melihat apa pun milik A.
    assert.equal((await b.get('/api/transactions')).data.total, 1);
    assert.equal((await b.get('/api/debts')).data.debts.length, 0);
    assert.equal((await b.get('/api/contacts')).data.contacts.length, 0);
    assert.equal((await b.get('/api/reports/balance-sheet?to=2026-12-31')).data.assets.total, 50_000);
    assert.equal((await b.get(`/api/reports/ledger?from=2026-01-01&to=2026-12-31&accountId=${A.Bank}`)).status, 404);

    // B tidak bisa mengubah/menghapus/menumpang data A.
    assert.equal((await b.del(`/api/entries/${ids.t1}`)).status, 404);
    assert.equal((await b.patch(`/api/transactions/${ids.t1}`, { kind: 'income', date: '2026-01-05', amount: 1, description: 'x', categoryId: B.Gaji, cashAccountId: B.Kas })).status, 404);
    assert.equal((await b.del(`/api/debts/${ids.d7}`)).status, 404);
    assert.equal((await b.post(`/api/debts/${ids.d7}/payments`, { amount: 1, date: '2026-02-01', cashAccountId: B.Kas })).status, 404);
    assert.equal((await b.patch(`/api/accounts/${A.Kas}`, { name: 'Dibajak' })).status, 400);
    assert.equal((await b.del(`/api/accounts/${A.Sewa}`)).status, 400);
    assert.equal((await b.put(`/api/budgets/${A.Sewa}`, { amount: 5 })).status, 400);
    // Memakai akun milik A di transaksi B ditolak.
    assert.equal((await b.post('/api/transactions', { kind: 'expense', date: '2026-01-05', amount: 1, description: 'x', categoryId: A.Sewa, cashAccountId: B.Kas })).status, 400);
    assert.equal((await b.post('/api/journal', { date: '2026-01-05', description: 'x', lines: [{ accountId: A.Kas, debit: 5, credit: 0 }, { accountId: B.Kas, debit: 0, credit: 5 }] })).status, 400);
    const kontakA = (await a.get('/api/contacts')).data.contacts[0];
    assert.equal((await b.post('/api/debts', { kind: 'receivable', mode: 'cash', amount: 1, date: '2026-01-05', description: 'x', contactId: kontakA.id, cashAccountId: B.Kas })).status, 400);

    // Data A utuh.
    assert.equal((await a.get('/api/transactions')).data.total, 16);
    assert.equal((await a.get('/api/accounts')).data.accounts.find((x) => x.id === A.Kas).name, 'Kas');
  } finally {
    await s.close();
  }
});
