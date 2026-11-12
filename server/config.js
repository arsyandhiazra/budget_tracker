// Membaca pengaturan dari file .env (kalau ada) dan dari environment.
// Semua pengaturan dikumpulkan di sini supaya gampang dicari.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

// Daftar penyedia AI yang didukung. "kind" menentukan format permintaannya:
// - anthropic : format Messages API milik Anthropic (Claude)
// - openai    : format Chat Completions, dipakai OpenAI dan banyak penyedia lain
export const AI_PRESETS = {
  anthropic: { kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-5-5' },
  openai: { kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.6-luna' },
  gemini: { kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash' },
  groq: { kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: '' },
  openrouter: { kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '' },
  custom: { kind: 'openai', baseUrl: '', model: '' },
};

export function loadConfig(overrides = {}) {
  const envFile = path.join(ROOT, '.env');
  if (!overrides.skipEnvFile && fs.existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile);
    } catch (err) {
      console.warn('Peringatan: file .env tidak bisa dibaca:', err.message);
    }
  }
  const env = { ...process.env, ...(overrides.env || {}) };
  const production = env.NODE_ENV === 'production';
  const port = Number(env.PORT) || 3000;

  const providerName = String(env.AI_PROVIDER || '').trim().toLowerCase();
  const preset = AI_PRESETS[providerName];
  const ai = {
    provider: preset ? providerName : 'none',
    kind: preset?.kind || null,
    apiKey: String(env.AI_API_KEY || '').trim(),
    model: String(env.AI_MODEL || preset?.model || '').trim(),
    baseUrl: String(env.AI_BASE_URL || preset?.baseUrl || '').trim().replace(/\/+$/, ''),
  };
  ai.enabled = Boolean(preset && ai.apiKey && ai.model && ai.baseUrl);
  if (providerName && providerName !== 'none' && !ai.enabled && !overrides.quiet) {
    console.warn(
      preset
        ? `Peringatan: AI_PROVIDER=${providerName} belum lengkap (butuh AI_API_KEY${ai.model ? '' : ' dan AI_MODEL'}${ai.baseUrl ? '' : ' dan AI_BASE_URL'}). Chatbot jalan dalam mode dasar.`
        : `Peringatan: AI_PROVIDER="${providerName}" tidak dikenal. Pilihan: ${Object.keys(AI_PRESETS).join(', ')}.`,
    );
  }

  return {
    production,
    port,
    host: env.HOST || (production ? '0.0.0.0' : '127.0.0.1'),
    appUrl: (env.APP_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
    // Alamat database Postgres. Neon/Vercel mengisinya sebagai DATABASE_URL atau POSTGRES_URL.
    // Kosong = (hanya di laptop) database lokal PGlite di folder data/pglite.
    databaseUrl: String(env.DATABASE_URL || env.POSTGRES_URL || '').trim(),
    pgliteDir: env.PGLITE_DIR || path.join(ROOT, 'data', 'pglite'),
    distDir: path.join(ROOT, 'dist'),
    sessionDays: Number(env.SESSION_DAYS) || 30,
    // Hosting (Render, Railway, dll.) menaruh aplikasi di belakang proxy HTTPS. Dengan
    // mempercayai proxy itu, server tahu alamat IP asli pengunjung dan bahwa koneksinya aman.
    // Aktif otomatis di production; isi TRUST_PROXY=0 kalau server diakses langsung tanpa proxy.
    trustProxy: env.TRUST_PROXY ? ['1', 'true'].includes(env.TRUST_PROXY) : production,
    timezone: env.APP_TIMEZONE || 'Asia/Jakarta',
    smtp: {
      host: String(env.SMTP_HOST || '').trim(),
      port: Number(env.SMTP_PORT) || 587,
      user: String(env.SMTP_USER || '').trim(),
      pass: String(env.SMTP_PASS || ''),
      from: String(env.SMTP_FROM || env.SMTP_USER || 'Budget Tracker <no-reply@localhost>').trim(),
    },
    ai,
    ...(overrides.values || {}),
  };
}
