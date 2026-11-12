// Utang/piutang yang dicatat lewat jurnal manual harus muncul di menu Utang & Piutang,
// ikut terpotong oleh pelunasan, dan tetap cocok dengan saldo di buku besar (Neraca).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { backfillJournalDebts } from '../accounting.js';

async function setup(s) {
  const c = s.client();
  await s.signUp(c, { email: `jd-${Math.random().toString(36).slice(2)}@contoh.test`, usage: 'usaha', openingCash: 1_000_000, openingBank: 10_000_000, date: '2026-01-01' });
  const A = Object.fromEntries((await c.get('/api/accounts')).data.accounts.map((a) => [a.name, a.id]));
  const journal = async (body, status = 201) => {
    const r = await c.post('/api/journal', { date: '2026-01-05', description: 'Jurnal', ...body });
    assert.equal(r.status, status, JSON.stringify(r.data));
    return r.data;
  };
  const debts = async () => (await c.get('/api/debts?today=2026-03-01')).data;
  return { c, A, journal, debts };
}

const dr = (accountId, debit) => ({ accountId, debit, credit: 0 });
const cr = (accountId, credit) => ({ accountId, debit: 0, credit });

test('utang dari jurnal manual muncul di Utang & Piutang dan cocok dengan Neraca', async () => {
  const s = await startServer();
  try {
    const { c, A, journal, debts } = await setup(s);
    const contact = (await c.post('/api/contacts', { name: 'Toko Besi', type: 'supplier' })).data.id;
    const { id } = await journal({ description: 'Beli rak, dicicil', contactId: contact, dueDate: '2026-03-30', lines: [dr(A.Peralatan, 2_000_000), cr(A['Utang Usaha'], 2_000_000)] });

    let d = await debts();
    assert.equal(d.debts.length, 1);
    const item = d.debts[0];
    assert.equal(item.kind, 'payable');
    assert.equal(item.amount, 2_000_000);
    assert.equal(item.source, 'journal');
    assert.equal(item.entryId, id);
    assert.equal(item.contact.name, 'Toko Besi');
    assert.equal(item.dueDate, '2026-03-30');
    assert.deepEqual(d.totals, { payable: 2_000_000, receivable: 0 });
    assert.deepEqual(d.unlinked, { payable: 0, receivable: 0 });

    // Piutang dari jurnal manual
    await journal({ description: 'Jual jasa, belum dibayar', lines: [dr(A.Piutang, 700_000), cr(A['Pendapatan Jasa'], 700_000)] });
    d = await debts();
    assert.deepEqual(d.totals, { payable: 2_000_000, receivable: 700_000 });
    assert.equal(d.debts.find((x) => x.kind === 'receivable').source, 'journal');

    // Jurnal yang menampilkan catatan utangnya (untuk formulir ubah)
    const list = (await c.get('/api/reports/journal?from=2026-01-01&to=2026-12-31')).data.entries;
    const entry = list.find((e) => e.id === id);
    assert.equal(entry.debts[0].dueDate, '2026-03-30');
  } finally {
    await s.close();
  }
});

test('melunasi utang jurnal dari menu, dan perlindungan hapus/ubah', async () => {
  const s = await startServer();
  try {
    const { c, A, journal, debts } = await setup(s);
    const { id } = await journal({ description: 'Beli rak, dicicil', lines: [dr(A.Peralatan, 2_000_000), cr(A['Utang Usaha'], 2_000_000)] });
    const debt = (await debts()).debts[0];

    const pay = await c.post(`/api/debts/${debt.id}/payments`, { amount: 500_000, date: '2026-01-20', cashAccountId: A.Bank });
    assert.equal(pay.status, 201, JSON.stringify(pay.data));
    let d = await debts();
    assert.equal(d.debts[0].remaining, 1_500_000);
    assert.equal(d.debts[0].payments[0].source, 'menu');
    assert.deepEqual(d.unlinked, { payable: 0, receivable: 0 });

    // Tidak boleh dihapus dari menu (harus lewat jurnalnya) ...
    let r = await c.del(`/api/debts/${debt.id}`);
    assert.equal(r.status, 400);
    assert.match(r.data.error.message, /Jurnal Umum/);
    // ... dan jurnalnya tidak boleh dihapus selama masih ada pembayaran.
    r = await c.del(`/api/entries/${id}`);
    assert.equal(r.status, 400);
    assert.match(r.data.error.message, /pembayarannya/);
    // Jumlah tidak boleh diubah di bawah yang sudah dibayar.
    r = await c.patch(`/api/journal/${id}`, { date: '2026-01-05', description: 'Beli rak', lines: [dr(A.Peralatan, 400_000), cr(A['Utang Usaha'], 400_000)] });
    assert.equal(r.status, 400);
    assert.match(r.data.error.message, /dibayar/);
    // Tidak boleh dijadikan tunai (utangnya hilang) selama ada pembayaran.
    r = await c.patch(`/api/journal/${id}`, { date: '2026-01-05', description: 'Beli rak', lines: [dr(A.Peralatan, 2_000_000), cr(A.Bank, 2_000_000)] });
    assert.equal(r.status, 400);
    // Menaikkan jumlah boleh; sisa ikut bertambah.
    r = await c.patch(`/api/journal/${id}`, { date: '2026-01-05', description: 'Beli rak', lines: [dr(A.Peralatan, 2_500_000), cr(A['Utang Usaha'], 2_500_000)] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    d = await debts();
    assert.equal(d.debts[0].amount, 2_500_000);
    assert.equal(d.debts[0].remaining, 2_000_000);
    // Jatuh tempo sebelum tanggal jurnal ditolak.
    r = await c.patch(`/api/journal/${id}`, { date: '2026-01-05', description: 'Beli rak', dueDate: '2026-01-01', lines: [dr(A.Peralatan, 2_500_000), cr(A['Utang Usaha'], 2_500_000)] });
    assert.equal(r.status, 400);

    // Hapus pembayaran lalu jurnalnya boleh dihapus.
    assert.equal((await c.del(`/api/debts/${debt.id}/payments/${pay.data.id}`)).status, 200);
    assert.equal((await c.del(`/api/entries/${id}`)).status, 200);
    d = await debts();
    assert.equal(d.debts.length, 0);
    assert.deepEqual(d.unlinked, { payable: 0, receivable: 0 });
  } finally {
    await s.close();
  }
});

test('pembayaran lewat jurnal manual memotong utang tertua, atau utang milik kontak yang dipilih', async () => {
  const s = await startServer();
  try {
    const { c, A, journal, debts } = await setup(s);
    const budi = (await c.post('/api/contacts', { name: 'Budi', type: 'supplier' })).data.id;
    const sari = (await c.post('/api/contacts', { name: 'Sari', type: 'supplier' })).data.id;
    await journal({ date: '2026-01-05', description: 'Utang A (Budi)', contactId: budi, lines: [dr(A.Peralatan, 1_000_000), cr(A['Utang Usaha'], 1_000_000)] });
    await journal({ date: '2026-01-06', description: 'Utang B (Sari)', contactId: sari, lines: [dr(A.Peralatan, 1_000_000), cr(A['Utang Usaha'], 1_000_000)] });
    await journal({ date: '2026-01-07', description: 'Utang C (tanpa nama)', lines: [dr(A.Peralatan, 1_000_000), cr(A['Utang Usaha'], 1_000_000)] });

    // Tanpa kontak: utang tertua dulu (A), lalu sisanya ke B.
    const pay1 = await journal({ date: '2026-01-10', description: 'Bayar utang usaha', lines: [dr(A['Utang Usaha'], 1_400_000), cr(A.Bank, 1_400_000)] });
    let d = await debts();
    const by = (name) => d.debts.find((x) => x.description.includes(name));
    assert.equal(by('Utang A').remaining, 0);
    assert.equal(by('Utang B').remaining, 600_000);
    assert.equal(by('Utang C').remaining, 1_000_000);
    assert.equal(by('Utang A').payments[0].source, 'journal');
    assert.deepEqual(d.unlinked, { payable: 0, receivable: 0 });

    // Dengan kontak: hanya utang milik kontak itu (C tidak bernama, jadi tidak ikut).
    await journal({ date: '2026-01-11', description: 'Bayar Sari', contactId: sari, lines: [dr(A['Utang Usaha'], 600_000), cr(A.Bank, 600_000)] });
    d = await debts();
    assert.equal(by('Utang B').remaining, 0);
    assert.equal(by('Utang C').remaining, 1_000_000);

    // Pembayaran jurnal tidak bisa dihapus lewat menu; harus lewat jurnalnya.
    const aId = by('Utang A').id;
    const payId = by('Utang A').payments[0].id;
    const r = await c.del(`/api/debts/${aId}/payments/${payId}`);
    assert.equal(r.status, 400);
    assert.match(r.data.error.message, /Jurnal Umum/);

    // Menghapus jurnal pembayaran mengembalikan sisa utang.
    assert.equal((await c.del(`/api/entries/${pay1.id}`)).status, 200);
    d = await debts();
    // Yang 1.400.000 batal; pembayaran Sari 600.000 tetap memotong utang B (1.000.000 → sisa 400.000).
    assert.equal(by('Utang A').remaining, 1_000_000);
    assert.equal(by('Utang B').remaining, 400_000);
    assert.deepEqual(d.unlinked, { payable: 0, receivable: 0 });
  } finally {
    await s.close();
  }
});

test('pembayaran yang dicatat lebih dulu otomatis dicocokkan saat utangnya dicatat', async () => {
  const s = await startServer();
  try {
    const { A, journal, debts, c } = await setup(s);
    // Pembayaran dulu: belum ada utang yang bisa dipotong → muncul sebagai selisih.
    await journal({ date: '2026-01-10', description: 'Bayar utang usaha', lines: [dr(A['Utang Usaha'], 300_000), cr(A.Bank, 300_000)] });
    let d = await debts();
    assert.equal(d.debts.length, 0);
    assert.deepEqual(d.unlinked, { payable: -300_000, receivable: 0 });

    // Utangnya baru dicatat (tanggal lebih awal dari pembayaran) → pembayaran langsung cocok.
    await journal({ date: '2026-01-05', description: 'Utang yang telat dicatat', lines: [dr(A.Peralatan, 1_000_000), cr(A['Utang Usaha'], 1_000_000)] });
    d = await debts();
    assert.equal(d.debts[0].remaining, 700_000);
    assert.deepEqual(d.unlinked, { payable: 0, receivable: 0 });
    assert.equal((await c.get('/api/reports/balance-sheet?to=2026-12-31')).data.balanced, true);
  } finally {
    await s.close();
  }
});

test('piutang dari jurnal manual: pelunasan lewat jurnal memotong piutang', async () => {
  const s = await startServer();
  try {
    const { A, journal, debts } = await setup(s);
    await journal({ date: '2026-01-05', description: 'Jual jasa', lines: [dr(A.Piutang, 900_000), cr(A['Pendapatan Jasa'], 900_000)] });
    await journal({ date: '2026-01-12', description: 'Terima pembayaran', lines: [dr(A.Bank, 400_000), cr(A.Piutang, 400_000)] });
    const d = await debts();
    assert.equal(d.debts[0].kind, 'receivable');
    assert.equal(d.debts[0].remaining, 500_000);
    assert.deepEqual(d.totals, { payable: 0, receivable: 500_000 });
    assert.deepEqual(d.unlinked, { payable: 0, receivable: 0 });
  } finally {
    await s.close();
  }
});

test('jurnal lama disinkronkan sekali (backfill) dan hasilnya sama', async () => {
  const s = await startServer();
  try {
    const { A, journal, debts } = await setup(s);
    await journal({ description: 'Beli rak', lines: [dr(A.Peralatan, 2_000_000), cr(A['Utang Usaha'], 2_000_000)] });
    await journal({ date: '2026-01-09', description: 'Bayar sebagian', lines: [dr(A['Utang Usaha'], 500_000), cr(A.Bank, 500_000)] });
    const before = (await debts()).debts[0];

    // Meniru data lama: catatan turunan belum ada.
    await s.db.run('DELETE FROM debt_payments');
    await s.db.run('DELETE FROM debts');
    assert.equal((await debts()).debts.length, 0);

    await s.db.tx(() => backfillJournalDebts(s.db));
    const after = (await debts()).debts[0];
    assert.equal(after.amount, before.amount);
    assert.equal(after.remaining, 1_500_000);
    assert.equal(after.source, 'journal');
    // Dijalankan dua kali tidak menggandakan apa pun.
    await s.db.tx(() => backfillJournalDebts(s.db));
    const again = await debts();
    assert.equal(again.debts.length, 1);
    assert.equal(again.debts[0].remaining, 1_500_000);
  } finally {
    await s.close();
  }
});

test('pelunasan dari menu dan dari jurnal yang bersamaan tidak melebihi sisa utang', async () => {
  const s = await startServer();
  try {
    const { c, A, journal, debts } = await setup(s);
    await journal({ description: 'Beli rak', lines: [dr(A.Peralatan, 1_000, 0), cr(A['Utang Usaha'], 1_000)] });
    const debt = (await debts()).debts[0];
    const attempts = await Promise.all([
      c.post(`/api/debts/${debt.id}/payments`, { amount: 600, date: '2026-01-06', cashAccountId: A.Bank }),
      c.post('/api/journal', { date: '2026-01-06', description: 'Bayar lewat jurnal', lines: [dr(A['Utang Usaha'], 600), cr(A.Bank, 600)] }),
    ]);
    assert.ok(attempts.every((r) => r.status === 201 || r.status === 400), JSON.stringify(attempts.map((r) => r.status)));
    const d = await debts();
    assert.ok(d.debts[0].remaining >= 0, 'sisa tidak boleh negatif');
    assert.ok(d.debts[0].paid <= 1_000);
  } finally {
    await s.close();
  }
});
