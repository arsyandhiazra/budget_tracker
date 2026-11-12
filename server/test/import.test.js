// Impor transaksi dari Excel/CSV: pembaca file, pratinjau, penyimpanan, dan ketahanan terhadap file buruk.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './helpers.js';
import { readXlsx } from '../xlsx-read.js';
import { parseTable, parseCsv } from '../table.js';
import { parseDateCell, parseAmountCell } from '../import.js';
import { buildXlsx } from '../xlsx.js';

const fx = (name) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', name));
const FILES = ['mutasi-openpyxl.xlsx', 'mutasi-xlsxwriter.xlsx', 'mutasi-libreoffice.xlsx', 'mutasi-titikkoma.csv', 'mutasi-koma.csv'];

async function setup(s, email = `imp-${Math.random().toString(36).slice(2)}@contoh.test`) {
  const c = s.client();
  await s.signUp(c, { email, usage: 'usaha', openingCash: 0, openingBank: 0, date: '2026-01-01' });
  const A = Object.fromEntries((await c.get('/api/accounts')).data.accounts.map((a) => [a.name, a.id]));
  const balance = async (name) => (await c.get('/api/accounts')).data.accounts.find((a) => a.name === name)?.balance;
  return { c, A, balance };
}

// Mengirim file mentah seperti yang dilakukan browser.
async function upload(s, c, action, buf, query = '', headers = {}) {
  const res = await fetch(`${s.base}/api/import/${action}${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-requested-with': 'BudgetTracker', cookie: c.cookie, ...headers },
    body: buf,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

test('pembaca xlsx: tiga penulis Excel berbeda menghasilkan isi yang sama', async () => {
  const rows = {};
  for (const name of FILES.filter((f) => f.endsWith('.xlsx'))) {
    const r = readXlsx(fx(name));
    // Judul kolom ada di baris ke-4 (openpyxl & xlsxwriter) atau paling atas; cari barisnya.
    const head = r.findIndex((row) => row[0] === 'Tanggal');
    assert.ok(head >= 0, `${name}: judul kolom ditemukan`);
    assert.deepEqual(r[head].slice(0, 6), ['Tanggal', 'Jenis', 'Jumlah', 'Kategori', 'Dompet', 'Keterangan'], name);
    rows[name] = r.slice(head + 1).filter((x) => x.some((c) => c !== null));
    // Lembar kedua ("Lembar Lain") tidak ikut terbaca.
    assert.ok(!JSON.stringify(r).includes('tidak boleh terbaca'), `${name}: hanya lembar pertama`);
    // Entitas XML & unicode terbaca benar.
    const text = JSON.stringify(r);
    assert.ok(text.includes('Penjualan kopi ☕ & roti'), `${name}: unicode dan &`);
    assert.ok(text.includes('Sewa kios <bulan Januari>'), `${name}: tanda < >`);
  }
  const lengths = Object.values(rows).map((r) => r.length);
  assert.ok(lengths.every((n) => n === 6), `jumlah baris sama: ${lengths}`);
  // Sel tanggal sungguhan terbaca sebagai angka seri Excel (46027 = 5 Jan 2026).
  assert.equal(rows['mutasi-openpyxl.xlsx'][0][0], 46027);
  assert.equal(parseDateCell(46027), '2026-01-05');
});

test('pembaca tabel: CSV titik koma (BOM) dan CSV koma dengan kutip & baris baru dalam isian', () => {
  const a = parseTable(fx('mutasi-titikkoma.csv'));
  assert.deepEqual(a[0], ['Tanggal', 'Jenis', 'Jumlah', 'Kategori', 'Dompet', 'Keterangan']);
  assert.equal(a[1][2], '3.000.000');
  const b = parseTable(fx('mutasi-koma.csv'));
  const makan = b.find((r) => r[3] === 'makan & minum');
  assert.equal(makan[5], 'Makan siang tim, "dengan kutip"\nbaris kedua');
  assert.deepEqual(parseCsv('a,b\r\n"x,y",2\r\n'), [['a', 'b'], ['x,y', '2']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']], 'pemisah tab dikenali');
  assert.deepEqual(parseCsv('x;y;z\n1;;3'), [['x', 'y', 'z'], ['1', null, '3']]);
});

test('membaca tanggal dan jumlah dari berbagai penulisan', () => {
  const dates = {
    '2026-01-31': '2026-01-31', '2026-1-5': '2026-01-05', '31/01/2026': '2026-01-31', '31-01-26': '2026-01-31', '5.3.2026': '2026-03-05',
    '31 Jan 2026': '2026-01-31', '5 Agustus 2026': '2026-08-05', '17-Agu-26': '2026-08-17', '2026-01-31T10:20:00Z': '2026-01-31', '  2026-02-28 ': '2026-02-28',
  };
  for (const [input, expected] of Object.entries(dates)) assert.equal(parseDateCell(input), expected, input);
  for (const bad of ['', 'kemarin', '2026-02-30', '31/13/2026', '00/01/2026', '1/1/1850', null, undefined, -5, 0, 'abc 2026']) assert.equal(parseDateCell(bad), null, String(bad));
  assert.equal(parseDateCell(45000), '2023-03-15');

  const amounts = [
    [1250000, 1250000], ['1250000', 1250000], ['1.250.000', 1250000], ['1,250,000', 1250000], ['Rp 1.250.000', 1250000], ['Rp. 1.250.000,00', 1250000],
    ['1,250,000.00', 1250000], ['(50.000)', -50000], ['-75000', -75000], ['+5.000', 5000], [1500.0000001, 1500], ['1.500', 1500], [' 12 ', 12], ['0', 0],
  ];
  for (const [input, expected] of amounts) assert.equal(parseAmountCell(input), expected, String(input));
  for (const bad of [12.5, '12,5', '1.5', 'abc', '1.2.3', '12 ribu', 'Rp', NaN, Infinity]) assert.ok(Number.isNaN(parseAmountCell(bad)) || parseAmountCell(bad) === null, String(bad));
  assert.equal(parseAmountCell(''), null);
  assert.equal(parseAmountCell(null), null);
});

for (const file of FILES) {
  test(`pratinjau impor dari ${file}: tiap baris dicek, tanpa menyimpan apa pun`, async () => {
    const s = await startServer();
    try {
      const { c, A, balance } = await setup(s);
      const r = await upload(s, c, 'preview', fx(file), `?defaultWalletId=${A.Bank}`);
      assert.equal(r.status, 200, JSON.stringify(r.data));
      const { summary, rows } = r.data;
      assert.equal(summary.total, 6);
      assert.equal(summary.errors, 2, 'tanggal salah + kategori baru (belum diizinkan dibuat)');
      assert.equal(summary.ok, 4);
      assert.equal(summary.income, 3_500_000);
      assert.equal(summary.expense, 1_350_000);
      assert.equal(summary.from, '2026-01-05');
      assert.equal(summary.to, '2026-01-08');

      const by = (text) => rows.find((x) => x.description.includes(text));
      assert.equal(by('Penjualan kopi').status, 'ok');
      assert.equal(by('Penjualan kopi').date, '2026-01-05');
      assert.equal(by('Sewa kios').amount, 1_200_000, 'teks "Rp 1.200.000" dibaca benar');
      assert.equal(by('Sewa kios').date, '2026-01-06');
      assert.equal(by('Makan siang').kind, 'expense', 'huruf kecil dikenali');
      assert.equal(by('Makan siang').category, 'makan & minum');
      const blank = by('tanpa kategori');
      assert.equal(blank.category, 'Pendapatan Lain-lain', 'kategori kosong memakai kategori bawaan');
      assert.equal(blank.wallet, 'Bank', 'dompet kosong memakai dompet bawaan');
      assert.match(by('Baris yang salah').message, /Tanggal "bukan tanggal"/);
      assert.match(by('Beli sesuatu').message, /Kategori "Kategori Baru" belum ada/);

      // Pratinjau tidak mengubah data.
      assert.equal(await balance('Bank'), 0);
      assert.equal((await c.get('/api/transactions')).data.total, 0);

      // Dengan izin membuat kategori, baris itu sah dan kategorinya dicatat sebagai "baru".
      const again = (await upload(s, c, 'preview', fx(file), `?defaultWalletId=${A.Bank}&createCategories=1`)).data;
      assert.equal(again.summary.errors, 1);
      assert.deepEqual(again.summary.newCategories, [{ name: 'Kategori Baru', type: 'expense' }]);
    } finally {
      await s.close();
    }
  });
}

test('simpan impor: saldo & laporan benar, kategori baru dibuat, pencatat tersimpan', async () => {
  const s = await startServer();
  try {
    const { c, A, balance } = await setup(s);
    const q = `?defaultWalletId=${A.Bank}&createCategories=1&skipErrors=1`;
    // Tanpa "lewati baris bermasalah", baris yang salah menggagalkan semuanya (tidak ada yang tersimpan).
    const strict = await upload(s, c, 'commit', fx('mutasi-openpyxl.xlsx'), `?defaultWalletId=${A.Bank}&createCategories=1`);
    assert.equal(strict.status, 400);
    assert.match(strict.data.error.message, /1 baris bermasalah/);
    assert.equal((await c.get('/api/transactions')).data.total, 0);

    const r = await upload(s, c, 'commit', fx('mutasi-openpyxl.xlsx'), q);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.deepEqual(r.data, { imported: 5, duplicatesSkipped: 0, errorsSkipped: 1, categoriesCreated: ['Kategori Baru'] });

    // Bank: +3.000.000 −1.200.000 +500.000 ; Kas: −150.000 −75.000
    assert.equal(await balance('Bank'), 2_300_000);
    assert.equal(await balance('Kas'), -225_000);
    assert.equal(await balance('Sewa'), 1_200_000);
    assert.equal(await balance('Kategori Baru'), 75_000);
    assert.equal(await balance('Pendapatan Lain-lain'), 500_000);
    const accounts = (await c.get('/api/accounts')).data.accounts;
    const created = accounts.find((a) => a.name === 'Kategori Baru');
    assert.equal(created.type, 'expense');
    assert.equal((await c.get('/api/reports/balance-sheet?to=2026-12-31')).data.balanced, true);
    const inc = (await c.get('/api/reports/income-statement?from=2026-01-01&to=2026-12-31')).data;
    assert.equal(inc.totalIncome, 3_500_000);
    assert.equal(inc.totalExpense, 1_425_000);

    // Muncul di daftar transaksi seperti catatan biasa (bisa diubah/dihapus), lengkap dengan kategorinya.
    const list = (await c.get('/api/transactions?limit=50')).data;
    assert.equal(list.total, 5);
    const sewa = list.items.find((e) => e.description.startsWith('Sewa kios'));
    assert.equal(sewa.kind, 'expense');
    assert.equal(sewa.category.name, 'Sewa');
    assert.equal(sewa.cashAccount.name, 'Bank');
    assert.equal(sewa.createdBy.name, 'Pengguna Tes');
    assert.equal((await c.del(`/api/entries/${sewa.id}`)).status, 200);
    assert.equal(await balance('Bank'), 3_500_000);

    // Ada di jurnal dengan dua baris seimbang.
    const journal = (await c.get('/api/reports/journal?from=2026-01-01&to=2026-12-31')).data;
    for (const e of journal.entries) assert.equal(e.lines.reduce((x, l) => x + l.debit, 0), e.lines.reduce((x, l) => x + l.credit, 0));
  } finally {
    await s.close();
  }
});

test('impor dua kali: transaksi yang sama persis dilewati, kecuali diminta lain', async () => {
  const s = await startServer();
  try {
    const { c, A, balance } = await setup(s);
    const q = `?defaultWalletId=${A.Bank}&createCategories=1&skipErrors=1`;
    assert.equal((await upload(s, c, 'commit', fx('mutasi-xlsxwriter.xlsx'), q)).status, 201);
    const total = async () => (await c.get('/api/transactions')).data.total;
    assert.equal(await total(), 5);

    // File yang sama, tapi dibaca dari format lain (CSV) → tetap dikenali sebagai duplikat.
    const preview = (await upload(s, c, 'preview', fx('mutasi-titikkoma.csv'), q)).data;
    assert.equal(preview.summary.duplicates, 5);
    assert.equal(preview.summary.ok, 0);
    assert.ok(preview.rows.some((r) => r.status === 'duplicate' && /sudah ada/i.test(r.message)));

    const second = await upload(s, c, 'commit', fx('mutasi-libreoffice.xlsx'), q);
    assert.equal(second.status, 400, 'tidak ada yang baru');
    assert.match(second.data.error.message, /Tidak ada baris/);
    assert.equal(await total(), 5);

    const forced = await upload(s, c, 'commit', fx('mutasi-libreoffice.xlsx'), `${q}&duplicates=include`);
    assert.equal(forced.status, 201);
    assert.equal(forced.data.imported, 5);
    assert.equal(await total(), 10);
    assert.equal(await balance('Bank'), 2 * 2_300_000);
  } finally {
    await s.close();
  }
});

test('dua baris identik dalam satu file sama-sama diimpor (dua kopi di hari yang sama itu sah)', async () => {
  const s = await startServer();
  try {
    const { c, A } = await setup(s);
    const csv = 'Tanggal,Jenis,Jumlah,Kategori,Dompet,Keterangan\n2026-02-01,Pengeluaran,25000,Makan & Minum,Kas,Kopi\n2026-02-01,Pengeluaran,25000,Makan & Minum,Kas,Kopi\n';
    const first = await upload(s, c, 'commit', Buffer.from(csv));
    assert.equal(first.status, 201, JSON.stringify(first.data));
    assert.equal(first.data.imported, 2);
    // Impor ulang: keduanya dikenali sebagai duplikat (dihitung satu-satu).
    const preview = (await upload(s, c, 'preview', Buffer.from(csv))).data;
    assert.equal(preview.summary.duplicates, 2);
    // Kalau file punya 3 baris identik dan di database baru 2, hanya 1 yang baru.
    const three = csv + '2026-02-01,Pengeluaran,25000,Makan & Minum,Kas,Kopi\n';
    const p3 = (await upload(s, c, 'preview', Buffer.from(three))).data;
    assert.deepEqual([p3.summary.duplicates, p3.summary.ok], [2, 1]);
    void A;
  } finally {
    await s.close();
  }
});

test('format kolom lain: Pemasukan/Pengeluaran terpisah, atau jumlah bertanda plus-minus', async () => {
  const s = await startServer();
  try {
    const { c, balance } = await setup(s);
    const twoCols = 'Tgl;Keterangan;Pemasukan;Pengeluaran;Dompet\n01/03/2026;Gaji;5.000.000;;Bank\n02/03/2026;Listrik;;350.000;Bank\n';
    let r = await upload(s, c, 'commit', Buffer.from(twoCols));
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.imported, 2);
    assert.equal(await balance('Bank'), 4_650_000);
    assert.equal(await balance('Pendapatan Lain-lain'), 5_000_000, 'tanpa kolom kategori → kategori bawaan');
    assert.equal(await balance('Beban Lain-lain'), 350_000);

    const signed = 'Tanggal,Nominal,Dompet,Keterangan\n2026-03-05,-20000,Kas,Parkir\n2026-03-06,100000,Kas,Setoran\n';
    r = await upload(s, c, 'commit', Buffer.from(signed));
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(await balance('Kas'), 80_000);

    const both = 'Tanggal;Pemasukan;Pengeluaran;Dompet\n01/03/2026;1000;2000;Kas\n';
    r = await upload(s, c, 'preview', Buffer.from(both));
    assert.match(r.data.rows[0].message, /sama-sama terisi/);
    const negWithKind = 'Tanggal,Jenis,Jumlah,Dompet\n2026-03-01,Pengeluaran,-5000,Kas\n';
    assert.match((await upload(s, c, 'preview', Buffer.from(negWithKind))).data.rows[0].message, /tidak boleh negatif/);
    const unknownKind = 'Tanggal,Jenis,Jumlah,Dompet\n2026-03-01,Transfer,5000,Kas\n';
    assert.match((await upload(s, c, 'preview', Buffer.from(unknownKind))).data.rows[0].message, /Jenis "Transfer" tidak dikenali/);
    const unknownWallet = 'Tanggal,Jenis,Jumlah,Dompet\n2026-03-01,Pengeluaran,5000,Brankas Rahasia\n';
    assert.match((await upload(s, c, 'preview', Buffer.from(unknownWallet))).data.rows[0].message, /Dompet "Brankas Rahasia" tidak ditemukan.*Kas/);
    const noWallet = 'Tanggal,Jenis,Jumlah\n2026-03-01,Pengeluaran,5000\n';
    assert.match((await upload(s, c, 'preview', Buffer.from(noWallet))).data.rows[0].message, /Dompet kosong/);
    const decimals = 'Tanggal,Jenis,Jumlah,Dompet\n2026-03-01,Pengeluaran,5000.5,Kas\n';
    assert.match((await upload(s, c, 'preview', Buffer.from(decimals))).data.rows[0].message, /bukan angka bulat/);
  } finally {
    await s.close();
  }
});

test('template impor: dibuat dari kategori & dompet pembukuan ini, dan bisa langsung diimpor', async () => {
  const s = await startServer();
  try {
    const { c, A } = await setup(s);
    const res = await c.get('/api/import/template', { raw: true });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /spreadsheetml/);
    assert.match(res.headers.get('content-disposition'), /template-impor-transaksi\.xlsx/);
    const buf = Buffer.from(await res.arrayBuffer());
    const rows = readXlsx(buf);
    assert.deepEqual(rows[0], ['Tanggal', 'Jenis', 'Jumlah', 'Kategori', 'Dompet', 'Keterangan']);
    assert.equal(rows.length, 3);
    assert.ok(['Kas', 'Bank', 'Dompet Digital'].includes(rows[1][4]));
    const preview = (await upload(s, c, 'preview', buf)).data;
    assert.equal(preview.summary.ok, 2, JSON.stringify(preview.rows));
    assert.equal(preview.summary.errors, 0);
    void A;
  } finally {
    await s.close();
  }
});

test('file buruk ditolak dengan pesan jelas, tanpa membuat server error', async () => {
  const s = await startServer();
  try {
    const { c } = await setup(s);
    const expect400 = async (buf, pattern, label) => {
      const r = await upload(s, c, 'preview', buf);
      assert.equal(r.status, 400, `${label}: ${JSON.stringify(r.data)}`);
      assert.match(r.data.error.message, pattern, label);
    };
    await expect400(Buffer.alloc(0), /belum dipilih/, 'kosong');
    await expect400(Buffer.from('%PDF-1.4 ...'), /PDF/, 'pdf');
    await expect400(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), /\.xls/, 'xls lama');
    await expect400(Buffer.from([1, 2, 3, 0, 0, 0, 9, 9]), /tidak dikenali/, 'biner acak');
    await expect400(Buffer.from('halo\ndunia\n'), /Baris judul kolom/, 'teks tanpa kolom');
    await expect400(Buffer.from('Tanggal,Jumlah\n'), /Tidak ada baris transaksi/, 'hanya judul');
    await expect400(Buffer.from('PK\x03\x04 bukan zip yang benar'), /rusak/, 'zip rusak');
    const good = fx('mutasi-openpyxl.xlsx');
    await expect400(good.subarray(0, Math.floor(good.length / 2)), /rusak/, 'xlsx terpotong');
    // Merusak isi lembar datanya sendiri (bagian lain yang tidak dibaca boleh saja rusak).
    const corrupt = Buffer.from(good);
    const at = corrupt.indexOf('xl/worksheets/sheet1.xml') + 'xl/worksheets/sheet1.xml'.length;
    for (let i = at + 10; i < at + 40; i += 1) corrupt[i] ^= 0xff;
    await expect400(corrupt, /rusak/, 'isi lembar dirusak');
    // zip yang isinya bukan excel
    await expect400(buildZip([{ name: 'catatan.txt', data: Buffer.from('halo') }]), /lembar|rusak/, 'zip tanpa lembar');
    const noFile = await fetch(`${s.base}/api/import/preview`, { method: 'POST', headers: { 'x-requested-with': 'BudgetTracker', cookie: c.cookie } });
    assert.equal(noFile.status, 400);
    const tooBig = await upload(s, c, 'preview', Buffer.alloc(3.2 * 1024 * 1024, 65));
    assert.equal(tooBig.status, 413);
    // CSRF: tanpa header penanda ditolak
    const csrf = await fetch(`${s.base}/api/import/preview`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', cookie: c.cookie }, body: 'x' });
    assert.equal(csrf.status, 403);
  } finally {
    await s.close();
  }
});

// Membuat ZIP minimal untuk uji ketahanan. "declared" = ukuran hasil buka yang dinyatakan di berkas.
function buildZip(files, { declaredSize } = {}) {
  const parts = []; const central = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name); const packed = zlib.deflateRawSync(f.data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(f.data.length, 22); local.writeUInt16LE(name.length, 26);
    parts.push(local, name, packed);
    const e = Buffer.alloc(46); e.writeUInt32LE(0x02014b50, 0); e.writeUInt16LE(20, 4); e.writeUInt16LE(20, 6); e.writeUInt16LE(8, 10);
    e.writeUInt32LE(packed.length, 20); e.writeUInt32LE(declaredSize ?? f.data.length, 24); e.writeUInt16LE(name.length, 28); e.writeUInt32LE(offset, 42);
    central.push(e, name); offset += local.length + name.length + packed.length;
  }
  const dir = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

test('zip bomb: lembar yang membengkak sangat besar ditolak cepat (ukuran dinyatakan jujur maupun bohong)', async () => {
  const s = await startServer();
  try {
    const { c } = await setup(s);
    const sheet = Buffer.concat([Buffer.from('<worksheet><sheetData>'), Buffer.alloc(60 * 1024 * 1024, 0x20), Buffer.from('</sheetData></worksheet>')]);
    const honest = buildZip([{ name: 'xl/worksheets/sheet1.xml', data: sheet }]);
    assert.ok(honest.length < 200_000, `file bom hanya ${honest.length} byte`);
    let t = Date.now();
    let r = await upload(s, c, 'preview', honest);
    assert.equal(r.status, 400);
    assert.match(r.data.error.message, /terlalu besar/);
    assert.ok(Date.now() - t < 3000, 'ditolak sebelum dibuka');

    // Berbohong soal ukuran (menyatakan 10 KB) tetap dihentikan oleh batas keluaran.
    const liar = buildZip([{ name: 'xl/worksheets/sheet1.xml', data: sheet }], { declaredSize: 10_000 });
    t = Date.now();
    r = await upload(s, c, 'preview', liar);
    assert.equal(r.status, 400);
    assert.match(r.data.error.message, /rusak/);
    assert.ok(Date.now() - t < 5000, 'dihentikan oleh batas keluaran');
    assert.equal((await c.get('/api/auth/me')).status, 200, 'server masih sehat');
  } finally {
    await s.close();
  }
});

test('impor: pelihat ditolak, pencatat boleh; batas 2.000 baris; data antar pembukuan terpisah', async () => {
  const s = await startServer();
  try {
    const { c, A } = await setup(s, 'pemilik-impor@contoh.test');
    const csv = 'Tanggal,Jenis,Jumlah,Dompet\n2026-03-01,Pengeluaran,5000,Kas\n';

    const viewer = s.client();
    await s.register(viewer, { email: 'pelihat-impor@contoh.test', name: 'Pelihat' });
    await c.post('/api/team/invitations', { email: 'pelihat-impor@contoh.test', role: 'viewer' });
    await viewer.post(`/api/auth/invitations/${(await viewer.get('/api/auth/me')).data.invitations[0].id}/accept`);
    assert.equal((await viewer.get('/api/import/template', { raw: true })).status, 200, 'pelihat boleh mengunduh template');
    const denied = await upload(s, viewer, 'commit', Buffer.from(csv));
    assert.equal(denied.status, 403);
    assert.equal(denied.data.error.code, 'READ_ONLY');
    await c.patch(`/api/team/members/${(await c.get('/api/team')).data.members[0].userId}`, { role: 'editor' });
    const allowed = await upload(s, viewer, 'commit', Buffer.from(csv));
    assert.equal(allowed.status, 201, JSON.stringify(allowed.data));
    const row = (await c.get('/api/transactions')).data.items[0];
    assert.equal(row.createdBy.name, 'Pelihat', 'tercatat siapa yang mengimpor');

    // Orang lain tidak melihat hasilnya.
    const stranger = s.client();
    await s.signUp(stranger, { email: 'asing-impor@contoh.test', usage: 'pribadi', date: '2026-01-01' });
    assert.equal((await stranger.get('/api/transactions')).data.total, 0);

    // Batas jumlah baris
    const many = ['Tanggal,Jenis,Jumlah,Dompet', ...Array.from({ length: 2001 }, (_, i) => `2026-03-01,Pengeluaran,${1000 + i},Kas`)].join('\n');
    const over = await upload(s, c, 'preview', Buffer.from(many));
    assert.equal(over.status, 400);
    assert.match(over.data.error.message, /Maksimal 2\.000 baris/);
    void A;
  } finally {
    await s.close();
  }
});

test('impor 2.000 baris sekaligus selesai wajar dan seluruhnya seimbang', async () => {
  const s = await startServer();
  try {
    const { c, balance } = await setup(s);
    const lines = ['Tanggal,Jenis,Jumlah,Kategori,Dompet,Keterangan'];
    let expected = 0;
    for (let i = 0; i < 2000; i += 1) {
      const income = i % 4 === 0;
      const amount = 1000 + i;
      expected += income ? amount : -amount;
      lines.push(`2026-03-${String(1 + (i % 28)).padStart(2, '0')},${income ? 'Pemasukan' : 'Pengeluaran'},${amount},${income ? 'Pendapatan Penjualan' : 'Sewa'},Bank,Baris ${i}`);
    }
    const t = Date.now();
    const r = await upload(s, c, 'commit', Buffer.from(lines.join('\n')));
    const took = Date.now() - t;
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.imported, 2000);
    assert.ok(took < 20_000, `impor 2.000 baris memakan ${took} ms`);
    assert.equal(await balance('Bank'), expected);
    assert.equal((await c.get('/api/transactions?limit=1')).data.total, 2000);
    assert.equal((await c.get('/api/reports/balance-sheet?to=2026-12-31')).data.balanced, true);
    assert.equal((await c.get('/api/reports/trial-balance?to=2026-12-31')).data.balanced, true);
  } finally {
    await s.close();
  }
});

// Di Vercel, isi permintaan bisa sudah dibaca platform (req.body terisi, aliran sudah habis) sebelum Express.
// Tes ini meniru itu: login (JSON), unggah file (biner), dan batas ukuran tetap berfungsi.
test('tetap berfungsi kalau platform hosting sudah membaca isi permintaan lebih dulu (gaya Vercel)', async () => {
  const s = await startServer();
  const wrapper = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    if (raw.length) {
      const body = /json/.test(req.headers['content-type'] || '') ? JSON.parse(raw.toString('utf8')) : raw;
      Object.defineProperty(req, 'body', { value: body, writable: true, configurable: true, enumerable: true });
    }
    s.app(req, res);
  });
  await new Promise((r) => wrapper.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${wrapper.address().port}`;
  try {
    const email = 'vercel-gaya@contoh.test';
    const H = { 'x-requested-with': 'BudgetTracker' };
    const json = (path, body, cookie) => fetch(base + path, { method: 'POST', headers: { ...H, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
    assert.equal((await json('/api/auth/register', { name: 'Vercel', email, password: 'rahasia-123' })).status, 201);
    const verify = await json('/api/auth/verify', { email, code: s.lastCode(email) });
    assert.equal(verify.status, 200);
    const cookie = verify.headers.get('set-cookie').split(';')[0];
    assert.equal((await json('/api/auth/onboarding', { usage: 'usaha', date: '2026-01-01' }, cookie)).status, 200);

    const file = (query, body) => fetch(`${base}/api/import/preview${query}`, { method: 'POST', headers: { ...H, 'content-type': 'application/octet-stream', cookie }, body });
    const r = await file('', fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mutasi-xlsxwriter.xlsx')));
    assert.equal(r.status, 200, await r.clone().text());
    const data = await r.json();
    assert.equal(data.summary.total, 6);
    // Isi permintaan kosong / terlalu besar tetap ditolak rapi.
    assert.equal((await file('', Buffer.alloc(0))).status, 400);
    const tooBig = await file('', Buffer.alloc(3.2 * 1024 * 1024, 65));
    assert.equal(tooBig.status, 413);
    assert.equal((await tooBig.json()).error.code, 'TOO_LARGE');
  } finally {
    await new Promise((r) => wrapper.close(r));
    await s.close();
  }
});
