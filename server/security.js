// Urusan keamanan: mengacak kata sandi, membuat token sesi & kode verifikasi,
// dan membatasi percobaan berulang (rate limit).
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

// Parameter scrypt (mengikuti rekomendasi OWASP: N=2^15, r=8, p=3).
const SCRYPT = { N: 32768, r: 8, p: 3, keylen: 64, maxmem: 128 * 1024 * 1024 };

// Kata sandi tidak pernah disimpan apa adanya. Yang disimpan hanya hasil
// "acakan satu arah"-nya, ibarat sidik jari: bisa dicocokkan, tidak bisa dibalik.
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, keyB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(keyB64, 'base64');
    const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT.maxmem,
    });
    return crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// Dipakai saat email tidak terdaftar, supaya lama prosesnya tetap mirip dan
// orang iseng tidak bisa menebak email mana yang terdaftar dari kecepatan jawaban.
let dummyHash;
export async function fakePasswordCheck(password) {
  dummyHash ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummyHash);
}

export const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Pembatas percobaan (rate limit). Catatannya disimpan di database, bukan di memori,
// supaya tetap berlaku di hosting serverless (Vercel) yang menyalakan banyak server
// sementara dan mematikannya lagi.
export class RateLimiter {
  constructor(db) {
    this.db = db;
  }

  // Mengembalikan { ok, retryAfter } — retryAfter dalam detik.
  async hit(key, limit, windowMs) {
    const now = Date.now();
    const cutoff = now - windowMs;
    const { n, oldest } = await this.db.get('SELECT COUNT(*) AS n, MIN(hit_at) AS oldest FROM rate_limits WHERE key = ? AND hit_at > ?', key, cutoff);
    if (n >= limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)) };
    await this.db.run('INSERT INTO rate_limits (key, hit_at) VALUES (?, ?)', key, now);
    // Sesekali bersihkan catatan lama (lebih dari 1 hari).
    if (Math.random() < 0.02) await this.db.run('DELETE FROM rate_limits WHERE hit_at < ?', now - 24 * 60 * 60_000);
    return { ok: true, retryAfter: 0 };
  }

  async reset(key) {
    await this.db.run('DELETE FROM rate_limits WHERE key = ?', key);
  }

  stop() {}
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      /* cookie rusak diabaikan */
    }
  }
  return out;
}
