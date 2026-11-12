// Alat bantu tes: menyalakan server sungguhan di memori (database sementara),
// lalu memanggilnya lewat HTTP seperti yang dilakukan browser.
import { loadConfig } from '../config.js';
import crypto from 'node:crypto';
import { openDb } from '../db.js';
import { createApp } from '../app.js';

// Database untuk tes. Kalau TEST_DATABASE_URL diisi, tes berjalan di Postgres asli
// (tiap tes memakai "schema" sendiri yang dihapus setelahnya). Kalau tidak, dipakai
// PGlite di memori, jadi "npm test" jalan tanpa memasang apa-apa.
export function testDb() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return openDb({});
  return openDb({ url, schema: `t_${crypto.randomBytes(6).toString('hex')}`, dropSchemaOnClose: true, max: 4 });
}

export async function startServer({ ai, production = false, fetchImpl } = {}) {
  const config = loadConfig({ skipEnvFile: true, quiet: true, env: { NODE_ENV: production ? 'production' : 'test', AI_PROVIDER: '', AI_API_KEY: '', SMTP_HOST: '' } });
  config.distDir = '/nonexistent';
  if (ai) config.ai = { ...config.ai, ...ai, enabled: true };
  const db = await testDb();
  const mails = [];
  const api = { failMailTo: null };
  const mailer = {
    configured: true, // seperti SMTP aktif: kode TIDAK ikut dikembalikan ke browser
    async send(mail) {
      if (api.failMailTo && mail.to === api.failMailTo) throw new Error('SMTP tes: sengaja gagal');
      mails.push(mail);
    },
  };
  const app = createApp({ db, config, mailer, fetchImpl });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  // "Browser" mini: menyimpan cookie sesi per klien.
  function client() {
    let cookie = '';
    async function call(method, path, body, { raw = false, headers = {} } = {}) {
      const res = await fetch(base + path, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(method !== 'GET' ? { 'x-requested-with': 'BudgetTracker' } : {}),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      if (raw) return res;
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return { status: res.status, data, headers: res.headers };
    }
    return {
      get: (p, o) => call('GET', p, undefined, o),
      post: (p, b = {}, o) => call('POST', p, b, o),
      patch: (p, b = {}, o) => call('PATCH', p, b, o),
      put: (p, b = {}, o) => call('PUT', p, b, o),
      del: (p, b, o) => call('DELETE', p, b, o),
      get cookie() { return cookie; },
    };
  }

  const lastCode = (to) => {
    const mail = [...mails].reverse().find((m) => m.to === to);
    return mail ? mail.text.match(/\b(\d{6})\b/)[1] : null;
  };

  // Jalan pintas: daftar + verifikasi saja (tanpa pengaturan awal).
  async function register(c, { email, name = 'Pengguna Tes', password = 'rahasia-123' } = {}) {
    await c.post('/api/auth/register', { name, email, password });
    const r = await c.post('/api/auth/verify', { email, code: lastCode(email) });
    return r.data.user;
  }

  // Jalan pintas: daftar + verifikasi + pengaturan awal.
  async function signUp(c, { email, name = 'Pengguna Tes', password = 'rahasia-123', usage = 'usaha', openingCash = 0, openingBank = 0, date = '2026-01-01' } = {}) {
    await c.post('/api/auth/register', { name, email, password });
    await c.post('/api/auth/verify', { email, code: lastCode(email) });
    const r = await c.post('/api/auth/onboarding', { usage, openingCash, openingBank, date });
    return r.data.user;
  }

  return {
    get failMailTo() { return api.failMailTo; },
    set failMailTo(v) { api.failMailTo = v; },
    base, db, config, mails, client, lastCode, signUp, register,
    limiter: app.locals.limiter,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await db.close();
    },
  };
}
