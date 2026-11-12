// Faktur: angka dihitung manual, jurnalnya otomatis, dan pembayarannya lewat piutang.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

async function setup(s, email = `inv-${Math.random().toString(36).slice(2)}@contoh.test`) {
  const c = s.client();
  await s.signUp(c, { email, name: 'Penjual', usage: 'usaha', openingCash: 1_000_000, openingBank: 5_000_000, date: '2026-01-01' });
  const A = Object.fromEntries((await c.get('/api/accounts')).data.accounts.map((a) => [a.name, a.id]));
  const balance = async (name) => (await c.get('/api/accounts')).data.accounts.find((a) => a.name === name)?.balance;
  const create = async (body, status = 201) => {
    const r = await c.post('/api/invoices', {
      issueDate: '2026-02-01', dueDate: '2026-02-15', customerName: 'PT Pelanggan', categoryId: A['Pendapatan Jasa'],
      items: [{ description: 'Desain logo', quantity: 1, unitPrice: 1_000_000 }], ...body,
    });
    assert.equal(r.status, status, JSON.stringify(r.data));
    return r.data;
  };
  const get = async (id, today = '2026-02-10') => (await c.get(`/api/invoices/${id}?today=${today}`)).data;
  return { c, A, balance, create, get };
}

test('buat faktur: total dihitung benar, jurnal otomatis, dan tercatat sebagai piutang', async () => {
  const s = await startServer();
  try {
    const { c, A, balance, create, get } = await setup(s);
    // 3 × 1.250.000 = 3.750.000 ; 1,5 × 200.000 = 300.000 ; subtotal 4.050.000
    // diskon 50.000 → 4.000.000 ; PPN 11% = 440.000 ; total 4.440.000
    const { id } = await create({
      items: [
        { description: 'Jasa konsultasi', quantity: 3, unitPrice: 1_250_000 },
        { description: 'Pelatihan (jam)', quantity: 1.5, unitPrice: 200_000 },
      ],
      discount: 50_000, taxRate: 11, notes: 'Terima kasih', customerAddress: 'Jl. Mawar 5',
    });
    const { invoice, seller } = await get(id);
    assert.equal(invoice.number, 'INV-2026-0001');
    assert.equal(invoice.subtotal, 4_050_000);
    assert.equal(invoice.discount, 50_000);
    assert.equal(invoice.taxRate, 11);
    assert.equal(invoice.tax, 440_000);
    assert.equal(invoice.total, 4_440_000);
    assert.equal(invoice.remaining, 4_440_000);
    assert.equal(invoice.status, 'unpaid');
    assert.equal(invoice.items.length, 2);
    assert.deepEqual(invoice.items.map((i) => i.amount), [3_750_000, 300_000]);
    assert.equal(invoice.items[1].quantity, 1.5);
    assert.equal(invoice.customer.name, 'PT Pelanggan');
    assert.equal(seller.name, 'Usaha Penjual');

    // Jurnal otomatis: Piutang +total, Pendapatan +4.000.000, Utang Pajak +440.000.
    assert.equal(await balance('Piutang'), 4_440_000);
    assert.equal(await balance('Pendapatan Jasa'), 4_000_000);
    assert.equal(await balance('Utang Pajak (PPN)'), 440_000);
    assert.equal((await c.get('/api/reports/balance-sheet?to=2026-12-31')).data.balanced, true);
    const inc = (await c.get('/api/reports/income-statement?from=2026-01-01&to=2026-12-31')).data;
    assert.equal(inc.totalIncome, 4_000_000, 'pajak bukan pendapatan');

    // Muncul di Utang & Piutang sebagai piutang dari faktur.
    const debts = (await c.get('/api/debts?today=2026-02-10')).data;
    const d = debts.debts.find((x) => x.invoice);
    assert.equal(d.source, 'invoice');
    assert.equal(d.invoice.number, 'INV-2026-0001');
    assert.equal(d.kind, 'receivable');
    assert.equal(d.amount, 4_440_000);
    assert.equal(d.dueDate, '2026-02-15');
    assert.deepEqual(debts.unlinked, { payable: 0, receivable: 0 });
    // Pelanggan baru otomatis jadi kontak
    assert.ok((await c.get('/api/contacts')).data.contacts.some((x) => x.name === 'PT Pelanggan' && x.type === 'customer'));
  } finally {
    await s.close();
  }
});

test('faktur tanpa pajak tidak membuat akun pajak; akun pajak dipakai ulang', async () => {
  const s = await startServer();
  try {
    const { c, create, balance } = await setup(s);
    await create({});
    assert.equal(await balance('Utang Pajak (PPN)'), undefined, 'belum ada akun pajak');
    await create({ taxRate: 11 });
    await create({ taxRate: 11, issueDate: '2026-02-03' });
    const taxAccounts = (await c.get('/api/accounts')).data.accounts.filter((a) => a.name === 'Utang Pajak (PPN)');
    assert.equal(taxAccounts.length, 1);
    assert.equal(taxAccounts[0].balance, 220_000);
    assert.equal(taxAccounts[0].system, true);
  } finally {
    await s.close();
  }
});

test('nomor faktur: otomatis berurutan per tahun, bisa diisi sendiri, tidak boleh kembar', async () => {
  const s = await startServer();
  try {
    const { c, create } = await setup(s);
    const a = await create({});
    const b = await create({});
    const other = await create({ issueDate: '2027-01-05', dueDate: null });
    const list = (await c.get('/api/invoices?today=2027-02-01')).data.items;
    assert.deepEqual(list.map((i) => i.number).sort(), ['INV-2026-0001', 'INV-2026-0002', 'INV-2027-0001']);
    assert.ok(a.id && b.id && other.id);
    assert.equal((await c.get('/api/invoices/next-number?date=2026-06-01')).data.number, 'INV-2026-0003');
    assert.equal((await c.get('/api/invoices/next-number?date=2028-06-01')).data.number, 'INV-2028-0001');

    await create({ number: 'KWT/2026/07' });
    const dup = await c.post('/api/invoices', { issueDate: '2026-02-01', customerName: 'X', categoryId: (await c.get('/api/accounts')).data.accounts.find((x) => x.name === 'Pendapatan Jasa').id, items: [{ description: 'a', quantity: 1, unitPrice: 1000 }], number: 'kwt/2026/07' });
    assert.equal(dup.status, 400);
    assert.match(dup.data.error.message, /sudah dipakai/);
    const bad = await c.post('/api/invoices', { issueDate: '2026-02-01', customerName: 'X', categoryId: 1, items: [{ description: 'a', quantity: 1, unitPrice: 1000 }], number: '<script>' });
    assert.equal(bad.status, 400);
  } finally {
    await s.close();
  }
});

test('bayar faktur: sebagian lalu lunas, status berubah, uang masuk ke dompet', async () => {
  const s = await startServer();
  try {
    const { c, A, balance, create, get } = await setup(s);
    const { id } = await create({ items: [{ description: 'Jasa', quantity: 2, unitPrice: 500_000 }] }); // 1.000.000
    assert.equal((await get(id, '2026-02-10')).invoice.status, 'unpaid');
    assert.equal((await get(id, '2026-03-01')).invoice.status, 'overdue');

    let r = await c.post(`/api/invoices/${id}/payments`, { amount: 400_000, date: '2026-02-05', cashAccountId: A.Bank });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    let inv = (await get(id, '2026-02-10')).invoice;
    assert.equal(inv.status, 'partial');
    assert.equal(inv.paid, 400_000);
    assert.equal(inv.remaining, 600_000);
    assert.equal(inv.payments.length, 1);
    assert.equal((await get(id, '2026-03-01')).invoice.status, 'overdue', 'sebagian dibayar tetapi lewat jatuh tempo');
    assert.equal(await balance('Bank'), 5_400_000);
    assert.equal(await balance('Piutang'), 600_000);

    assert.equal((await c.post(`/api/invoices/${id}/payments`, { amount: 700_000, date: '2026-02-06', cashAccountId: A.Bank })).status, 400, 'melebihi sisa');
    assert.equal((await c.post(`/api/invoices/${id}/payments`, { amount: 600_000, date: '2026-02-06', cashAccountId: A.Bank })).status, 201);
    inv = (await get(id)).invoice;
    assert.equal(inv.status, 'paid');
    assert.equal(inv.remaining, 0);
    assert.equal(await balance('Piutang'), 0);

    const list = (await c.get('/api/invoices?today=2026-03-01')).data;
    assert.deepEqual(list.totals, { unpaid: 0, overdue: 0, count: 1 });
    assert.equal((await c.get('/api/invoices?status=paid&today=2026-03-01')).data.items.length, 1);
    assert.equal((await c.get('/api/invoices?status=open&today=2026-03-01')).data.items.length, 0);
  } finally {
    await s.close();
  }
});

test('ubah faktur selama belum ada pembayaran; setelah dibayar dikunci', async () => {
  const s = await startServer();
  try {
    const { c, A, balance, create, get } = await setup(s);
    const { id } = await create({ taxRate: 11 }); // 1.000.000 + 110.000
    assert.equal(await balance('Piutang'), 1_110_000);

    const edit = await c.patch(`/api/invoices/${id}`, {
      issueDate: '2026-02-02', dueDate: '2026-03-02', customerName: 'PT Pelanggan', categoryId: A['Pendapatan Penjualan'],
      items: [{ description: 'Barang', quantity: 10, unitPrice: 25_000 }, { description: 'Ongkir', quantity: 1, unitPrice: 50_000 }],
      discount: 0, taxRate: 0, notes: 'Revisi',
    });
    assert.equal(edit.status, 200, JSON.stringify(edit.data));
    const inv = (await get(id)).invoice;
    assert.equal(inv.total, 300_000);
    assert.equal(inv.tax, 0);
    assert.equal(inv.category.name, 'Pendapatan Penjualan');
    assert.equal(inv.number, 'INV-2026-0001', 'nomor tetap');
    assert.equal(inv.dueDate, '2026-03-02');
    assert.equal(await balance('Piutang'), 300_000);
    assert.equal(await balance('Pendapatan Jasa'), 0);
    assert.equal(await balance('Pendapatan Penjualan'), 300_000);
    assert.equal(await balance('Utang Pajak (PPN)'), 0);
    assert.equal((await c.get('/api/reports/balance-sheet?to=2026-12-31')).data.balanced, true);
    const debt = (await c.get('/api/debts?today=2026-02-10')).data.debts[0];
    assert.equal(debt.amount, 300_000);
    assert.equal(debt.dueDate, '2026-03-02');

    const pay = await c.post(`/api/invoices/${id}/payments`, { amount: 100_000, date: '2026-02-10', cashAccountId: A.Bank });
    assert.equal(pay.status, 201);
    const locked = await c.patch(`/api/invoices/${id}`, { issueDate: '2026-02-02', customerName: 'PT Pelanggan', categoryId: A['Pendapatan Jasa'], items: [{ description: 'x', quantity: 1, unitPrice: 5 }] });
    assert.equal(locked.status, 400);
    assert.match(locked.data.error.message, /pembayarannya/);
    // Hapus pembayaran lewat Utang & Piutang → boleh diubah lagi.
    const d2 = (await c.get('/api/debts?today=2026-02-10')).data.debts[0];
    assert.equal((await c.del(`/api/debts/${d2.id}/payments/${d2.payments[0].id}`)).status, 200);
    assert.equal((await c.patch(`/api/invoices/${id}`, { issueDate: '2026-02-02', customerName: 'PT Pelanggan', categoryId: A['Pendapatan Jasa'], items: [{ description: 'x', quantity: 1, unitPrice: 5000 }] })).status, 200);
  } finally {
    await s.close();
  }
});

test('hapus faktur menghapus piutang dan pembayarannya; dari menu utang ditolak', async () => {
  const s = await startServer();
  try {
    const { c, A, balance, create } = await setup(s);
    const { id } = await create({ taxRate: 11 });
    await c.post(`/api/invoices/${id}/payments`, { amount: 300_000, date: '2026-02-05', cashAccountId: A.Bank });
    assert.equal(await balance('Bank'), 5_300_000);

    const debt = (await c.get('/api/debts?today=2026-02-10')).data.debts[0];
    const viaMenu = await c.del(`/api/debts/${debt.id}`);
    assert.equal(viaMenu.status, 400);
    assert.match(viaMenu.data.error.message, /menu Faktur/);
    assert.equal((await c.del(`/api/entries/${debt.entryId}`)).status, 400, 'catatan jurnalnya juga terlindungi');

    assert.equal((await c.del(`/api/invoices/${id}`)).status, 200);
    assert.equal(await balance('Bank'), 5_000_000, 'pembayaran ikut batal');
    assert.equal(await balance('Piutang'), 0);
    assert.equal(await balance('Pendapatan Jasa'), 0);
    assert.equal(await balance('Utang Pajak (PPN)'), 0);
    assert.equal((await c.get('/api/invoices')).data.items.length, 0);
    assert.equal((await c.get('/api/debts')).data.debts.length, 0);
    assert.equal((await s.db.get('SELECT COUNT(*) AS n FROM invoice_items')).n, 0);
    assert.equal((await c.del(`/api/invoices/${id}`)).status, 404);
    assert.equal((await c.get('/api/reports/balance-sheet?to=2026-12-31')).data.balanced, true);
  } finally {
    await s.close();
  }
});

test('faktur menolak isian yang salah', async () => {
  const s = await startServer();
  try {
    const { c, A, create } = await setup(s);
    const base = { issueDate: '2026-02-01', customerName: 'X', categoryId: A['Pendapatan Jasa'], items: [{ description: 'a', quantity: 1, unitPrice: 1000 }] };
    const rejects = async (patch, pattern) => {
      const r = await c.post('/api/invoices', { ...base, ...patch });
      assert.equal(r.status, 400, JSON.stringify(patch));
      if (pattern) assert.match(r.data.error.message, pattern, JSON.stringify(patch));
    };
    await rejects({ items: [] }, /minimal satu/);
    await rejects({ items: 'x' });
    await rejects({ items: [{ description: '', quantity: 1, unitPrice: 1000 }] });
    await rejects({ items: [{ description: 'a', quantity: 0, unitPrice: 1000 }] }, /lebih dari 0/);
    await rejects({ items: [{ description: 'a', quantity: 1.2345, unitPrice: 1000 }] }, /3 angka/);
    await rejects({ items: [{ description: 'a', quantity: 1, unitPrice: -5 }] });
    await rejects({ items: [{ description: 'a', quantity: 1, unitPrice: 1.5 }] });
    await rejects({ items: Array.from({ length: 101 }, () => ({ description: 'a', quantity: 1, unitPrice: 1 })) }, /maksimal 100/);
    await rejects({ discount: 1001 }, /Diskon/);
    await rejects({ taxRate: 101 }, /Pajak/);
    await rejects({ taxRate: -1 }, /Pajak/);
    await rejects({ taxRate: 11.123 }, /Pajak/);
    await rejects({ issueDate: '2026-13-40' });
    await rejects({ dueDate: '2026-01-01' }, /Jatuh tempo/);
    await rejects({ customerName: '', contactId: null }, /Pelanggan/);
    await rejects({ contactId: 99999, customerName: undefined }, /Pelanggan/);
    await rejects({ categoryId: A.Kas }, /pendapatan/);
    await rejects({ categoryId: A.Sewa }, /pendapatan/);
    await rejects({ categoryId: 99999 });
    await rejects({ categoryId: undefined });
    await rejects({ notes: 'x'.repeat(501) });
    // Pembulatan: 0,333 × 1.000 = 333 ; 1 × 1 → total 334 (sah)
    const ok = await create({ items: [{ description: 'a', quantity: 0.333, unitPrice: 1000 }, { description: 'b', quantity: 1, unitPrice: 1 }] });
    assert.ok(ok.id);
    assert.equal((await c.get(`/api/invoices/${ok.id}`)).data.invoice.total, 334);
  } finally {
    await s.close();
  }
});

test('faktur: pemilik/pencatat bisa membuat, pelihat hanya melihat, dan data antar pembukuan terpisah', async () => {
  const s = await startServer();
  try {
    const { c, A, create } = await setup(s, 'penjual@contoh.test');
    const { id } = await create({});
    await c.patch('/api/book', { name: 'Toko Sari', address: 'Jl. Melati 1, Bandung', phone: '0812-0000', paymentInfo: 'BCA 123 a.n. Sari' });

    const viewer = s.client();
    await s.register(viewer, { email: 'pelihat@contoh.test', name: 'Pelihat' });
    await c.post('/api/team/invitations', { email: 'pelihat@contoh.test', role: 'viewer' });
    const invId = (await viewer.get('/api/auth/me')).data.invitations[0].id;
    await viewer.post(`/api/auth/invitations/${invId}/accept`);

    const view = await viewer.get(`/api/invoices/${id}?today=2026-02-10`);
    assert.equal(view.status, 200);
    assert.equal(view.data.seller.name, 'Toko Sari');
    assert.equal(view.data.seller.address, 'Jl. Melati 1, Bandung');
    assert.equal(view.data.seller.paymentInfo, 'BCA 123 a.n. Sari');
    assert.equal((await viewer.get('/api/invoices')).data.items.length, 1);
    const attempt = await viewer.post('/api/invoices', { issueDate: '2026-02-01', customerName: 'X', categoryId: A['Pendapatan Jasa'], items: [{ description: 'a', quantity: 1, unitPrice: 1 }] });
    assert.equal(attempt.status, 403);
    assert.equal((await viewer.del(`/api/invoices/${id}`)).status, 403);
    assert.equal((await viewer.post(`/api/invoices/${id}/payments`, { amount: 1, date: '2026-02-05', cashAccountId: A.Bank })).status, 403);

    // Orang di luar pembukuan itu tidak bisa melihat atau menyentuhnya.
    const stranger = s.client();
    await s.signUp(stranger, { email: 'asing@contoh.test', usage: 'usaha', date: '2026-01-01' });
    assert.equal((await stranger.get(`/api/invoices/${id}`)).status, 404);
    assert.equal((await stranger.del(`/api/invoices/${id}`)).status, 404);
    assert.equal((await stranger.patch(`/api/invoices/${id}`, {})).status, 404);
    assert.equal((await stranger.get('/api/invoices')).data.items.length, 0);
    assert.equal((await stranger.get('/api/invoices/next-number?date=2026-01-01')).data.number, 'INV-2026-0001', 'penomoran terpisah per pembukuan');
  } finally {
    await s.close();
  }
});

test('pencarian & filter daftar faktur; hapus akun yang punya faktur', async () => {
  const s = await startServer();
  try {
    const { c, create } = await setup(s, 'cari@contoh.test');
    await create({ customerName: 'Toko Alfa' });
    await create({ customerName: 'CV Beta 100%' });
    assert.equal((await c.get('/api/invoices?q=alfa')).data.items.length, 1);
    assert.equal((await c.get('/api/invoices?q=100%25')).data.items.length, 1, 'tanda % dibaca apa adanya');
    assert.equal((await c.get('/api/invoices?q=0002')).data.items.length, 1, 'cari nomor');
    assert.equal((await c.get('/api/invoices?status=ngawur')).status, 400);
    const r = await c.del('/api/auth/account', { password: 'rahasia-123' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await s.db.get('SELECT COUNT(*) AS n FROM invoices')).n, 0);
  } finally {
    await s.close();
  }
});
