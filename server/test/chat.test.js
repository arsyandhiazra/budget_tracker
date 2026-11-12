import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { loadConfig } from '../config.js';

async function seed(s, c, email) {
  await s.signUp(c, { email, name: 'Dewi Lestari', usage: 'pribadi', openingCash: 1_000_000, openingBank: 4_000_000, date: '2026-01-01' });
  const A = Object.fromEntries((await c.get('/api/accounts')).data.accounts.map((a) => [a.name, a.id]));
  const add = (body) => c.post('/api/transactions', body);
  await add({ kind: 'income', date: '2026-03-02', amount: 6_000_000, description: 'Gaji Maret', categoryId: A.Gaji, cashAccountId: A.Bank });
  await add({ kind: 'expense', date: '2026-03-05', amount: 900_000, description: 'Belanja bulanan', categoryId: A.Belanja, cashAccountId: A.Bank });
  await add({ kind: 'expense', date: '2026-03-10', amount: 350_000, description: 'Makan di luar', categoryId: A['Makanan & Minuman'], cashAccountId: A.Kas });
  await add({ kind: 'expense', date: '2026-02-10', amount: 500_000, description: 'Makan Februari', categoryId: A['Makanan & Minuman'], cashAccountId: A.Kas });
  // Pengeluaran akhir Februari: masuk hitungan "bulan lalu", tapi TIDAK masuk pembanding 1–15 Februari.
  await add({ kind: 'expense', date: '2026-02-25', amount: 1_000_000, description: 'Belanja akhir Februari', categoryId: A.Belanja, cashAccountId: A.Bank });
  await c.put(`/api/budgets/${A['Makanan & Minuman']}`, { amount: 300_000 });
  await c.post('/api/debts', { kind: 'payable', mode: 'cash', amount: 750_000, date: '2026-03-03', dueDate: '2026-03-08', description: 'Pinjam ke kakak', contactName: 'Kak Rudi', cashAccountId: A.Kas });
  return A;
}

test('chatbot mode dasar menjawab dari data asli', async () => {
  const s = await startServer();
  try {
    const c = s.client();
    await seed(s, c, 'dewi@contoh.test');
    const ask = async (message) => {
      const r = await c.post('/api/chat', { message, today: '2026-03-15' });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(r.data.mode, 'basic');
      return r.data.reply;
    };

    assert.match(await ask('Halo'), /Halo Dewi/);
    // Kas 1.000.000 − 350.000 − 500.000 + 750.000 = 900.000 ; Bank 4.000.000 + 6.000.000 − 900.000 − 1.000.000 = 8.100.000
    const saldo = await ask('Berapa saldo saya sekarang?');
    assert.match(saldo, /Rp 9\.000\.000/);
    assert.match(saldo, /Kas: Rp 900\.000/);
    assert.match(saldo, /Bank: Rp 8\.100\.000/);

    const keluar = await ask('pengeluaran bulan ini berapa?');
    assert.match(keluar, /Rp 1\.250\.000/);
    // 1–15 Maret (1.250.000) dibanding 1–15 Februari (500.000) → naik 150%.
    // Kalau salah membandingkan dengan Februari penuh (1.500.000), hasilnya "turun 17%".
    assert.match(keluar, /naik 150% dibanding periode yang sama bulan lalu \(Rp 500\.000\)/);
    assert.match(await ask('pengeluaran bulan lalu?'), /Rp 1\.500\.000/);
    assert.match(await ask('pemasukan bulan ini'), /Rp 6\.000\.000/);
    assert.match(await ask('kategori paling boros apa?'), /\*\*Belanja\*\*: Rp 900\.000 \(72%/);
    assert.match(await ask('gimana anggaran saya?'), /Makanan & Minuman: terpakai Rp 350\.000 dari Rp 300\.000 \(lewat Rp 50\.000\)/);
    const utang = await ask('ada utang apa saja?');
    assert.match(utang, /Rp 750\.000/);
    assert.match(utang, /Kak Rudi/);
    assert.match(utang, /terlambat/);
    assert.match(await ask('piutang saya?'), /Tidak ada piutang/);
    assert.match(await ask('untung atau rugi bulan ini?'), /lebih \(untung\) Rp 4\.750\.000/);
    assert.match(await ask('transaksi terakhir'), /Makan di luar/);
    assert.match(await ask('cara tambah transaksi gimana?'), /Tambah transaksi/);
    assert.match(await ask('kasih saran dong'), /Ringkasan bulan ini/);
    assert.match(await ask('siapa presiden pertama?'), /mode dasar/);

    // Riwayat tersimpan & bisa dihapus
    let h = (await c.get('/api/chat')).data;
    assert.equal(h.mode, 'basic');
    assert.ok(h.messages.length >= 20);
    assert.equal(h.messages.at(-1).role, 'assistant');
    // Pengguna lain tidak melihat riwayat ini
    const other = s.client();
    await s.signUp(other, { email: 'lain@contoh.test' });
    assert.equal((await other.get('/api/chat')).data.messages.length, 0);
    assert.match((await other.post('/api/chat', { message: 'pengeluaran?', today: '2026-03-15' })).data.reply, /belum punya catatan/);
    assert.equal((await c.del('/api/chat')).status, 200);
    h = (await c.get('/api/chat')).data;
    assert.equal(h.messages.length, 0);

    // Pesan kosong / kepanjangan ditolak; terlalu cepat dibatasi
    assert.equal((await c.post('/api/chat', { message: '   ' })).status, 400);
    assert.equal((await c.post('/api/chat', { message: 'x'.repeat(1001) })).status, 400);
    await s.limiter.reset(`chat:${(await c.get('/api/auth/me')).data.user.id}`);
    let last;
    for (let i = 0; i < 16; i += 1) last = await c.post('/api/chat', { message: 'saldo', today: '2026-03-15' });
    assert.equal(last.status, 429);
  } finally {
    await s.close();
  }
});

test('chatbot mode AI: format permintaan Anthropic & OpenAI benar, gagal → mode dasar', async () => {
  const calls = [];
  let behaviour = 'ok';
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    if (behaviour === 'down') return new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 529 });
    if (behaviour === 'throw') throw new Error('jaringan putus');
    if (url.endsWith('/v1/messages')) return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Jawaban dari Claude.' }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Jawaban dari model lain.' } }] }), { status: 200 });
  };

  // ── Anthropic ──
  let s = await startServer({ ai: { provider: 'anthropic', kind: 'anthropic', apiKey: 'kunci-rahasia', model: 'claude-haiku-5-5', baseUrl: 'https://api.anthropic.com' }, fetchImpl });
  try {
    const c = s.client();
    await seed(s, c, 'ai@contoh.test');
    let r = await c.post('/api/chat', { message: 'Berapa pengeluaranku bulan ini?', today: '2026-03-15' });
    assert.equal(r.status, 200);
    assert.deepEqual([r.data.reply, r.data.mode], ['Jawaban dari Claude.', 'ai']);
    let call = calls.at(-1);
    assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(call.headers['x-api-key'], 'kunci-rahasia');
    assert.equal(call.headers['anthropic-version'], '2023-06-01');
    assert.equal(call.body.model, 'claude-haiku-5-5');
    assert.ok(call.body.max_tokens > 0);
    assert.deepEqual(call.body.messages, [{ role: 'user', content: 'Berapa pengeluaranku bulan ini?' }]);
    assert.match(call.body.system, /Bulan ini: pemasukan Rp 6\.000\.000, pengeluaran Rp 1\.250\.000/);
    assert.match(call.body.system, /Kak Rudi/);
    assert.match(call.body.system, /Bulan lalu sampai tanggal yang sama[^\n]*pengeluaran Rp 500\.000/);
    assert.match(call.body.system, /Bulan lalu \(sebulan penuh\)[^\n]*pengeluaran Rp 1\.500\.000/);
    assert.ok(!call.body.system.includes('kunci-rahasia') && !call.body.system.includes('ai@contoh.test'), 'kunci & email tidak ikut terkirim');

    r = await c.post('/api/chat', { message: 'Terus sarannya apa?', today: '2026-03-15' });
    call = calls.at(-1);
    assert.deepEqual(call.body.messages.map((m) => m.role), ['user', 'assistant', 'user'], 'riwayat ikut dikirim, berselang-seling');
    assert.equal((await c.get('/api/chat')).data.mode, 'ai');

    behaviour = 'down';
    r = await c.post('/api/chat', { message: 'saldo saya?', today: '2026-03-15' });
    assert.equal(r.status, 200);
    assert.equal(r.data.mode, 'basic');
    assert.match(r.data.notice, /mode dasar/);
    assert.match(r.data.reply, /Rp 9\.000\.000/);
    behaviour = 'throw';
    r = await c.post('/api/chat', { message: 'saldo saya?', today: '2026-03-15' });
    assert.equal(r.data.mode, 'basic');
    behaviour = 'ok';
  } finally {
    await s.close();
  }

  // ── OpenAI-compatible (OpenAI, Gemini, Groq, …) ──
  s = await startServer({ ai: { provider: 'gemini', kind: 'openai', apiKey: 'kunci-g', model: 'gemini-3.8-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' }, fetchImpl });
  try {
    const c = s.client();
    await seed(s, c, 'ai2@contoh.test');
    const r = await c.post('/api/chat', { message: 'Halo', today: '2026-03-15' });
    assert.deepEqual([r.data.reply, r.data.mode], ['Jawaban dari model lain.', 'ai']);
    const call = calls.at(-1);
    assert.equal(call.url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    assert.equal(call.headers.authorization, 'Bearer kunci-g');
    assert.equal(call.body.model, 'gemini-3.8-flash');
    assert.equal(call.body.messages[0].role, 'system');
    assert.deepEqual(call.body.messages.at(-1), { role: 'user', content: 'Halo' });
  } finally {
    await s.close();
  }
});

test('pengaturan AI dari .env dibaca dengan benar', () => {
  const cfg = (env) => loadConfig({ skipEnvFile: true, quiet: true, env: { AI_PROVIDER: '', AI_API_KEY: '', AI_MODEL: '', AI_BASE_URL: '', ...env } }).ai;
  assert.equal(cfg({}).enabled, false);
  assert.equal(cfg({ AI_PROVIDER: 'anthropic' }).enabled, false, 'tanpa kunci tetap mode dasar');
  let ai = cfg({ AI_PROVIDER: 'Anthropic', AI_API_KEY: 'k' });
  assert.deepEqual([ai.enabled, ai.kind, ai.model, ai.baseUrl], [true, 'anthropic', 'claude-haiku-5-5', 'https://api.anthropic.com']);
  ai = cfg({ AI_PROVIDER: 'openai', AI_API_KEY: 'k', AI_MODEL: 'model-lain' });
  assert.deepEqual([ai.enabled, ai.kind, ai.model, ai.baseUrl], [true, 'openai', 'model-lain', 'https://api.openai.com/v1']);
  ai = cfg({ AI_PROVIDER: 'gemini', AI_API_KEY: 'k' });
  assert.deepEqual([ai.enabled, ai.baseUrl], [true, 'https://generativelanguage.googleapis.com/v1beta/openai']);
  assert.equal(cfg({ AI_PROVIDER: 'groq', AI_API_KEY: 'k' }).enabled, false, 'groq butuh AI_MODEL');
  assert.equal(cfg({ AI_PROVIDER: 'custom', AI_API_KEY: 'k', AI_MODEL: 'm', AI_BASE_URL: 'http://localhost:11434/v1/' }).baseUrl, 'http://localhost:11434/v1');
  assert.equal(cfg({ AI_PROVIDER: 'ngawur', AI_API_KEY: 'k' }).enabled, false);
});
