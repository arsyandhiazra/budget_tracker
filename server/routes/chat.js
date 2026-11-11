// Chatbot. Kalau kunci API AI sudah diisi di .env → dijawab model AI.
// Kalau belum (atau layanan AI gagal) → dijawab "asisten dasar" dari data.
import express from 'express';
import { HttpError, v, todayIn } from '../http.js';
import { nowIso } from '../db.js';
import { buildContext, systemPrompt } from '../ai/context.js';
import { basicAnswer } from '../ai/basic.js';
import { askAI } from '../ai/providers.js';

const HISTORY_FOR_AI = 12; // berapa pesan terakhir yang ikut dikirim sebagai konteks
const KEEP_MESSAGES = 200; // riwayat yang disimpan per pengguna

export function createChat({ db, config, limiter, fetchImpl }) {
  const router = express.Router();
  const status = () => ({ mode: config.ai.enabled ? 'ai' : 'basic', provider: config.ai.enabled ? config.ai.provider : null });

  router.get('/chat', (req, res) => {
    const rows = db.all('SELECT id, role, content, mode, created_at AS createdAt FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT 50', req.user.id);
    res.json({ messages: rows.reverse(), ...status() });
  });

  router.delete('/chat', (req, res) => {
    db.run('DELETE FROM chat_messages WHERE user_id = ?', req.user.id);
    res.json({ ok: true });
  });

  router.post('/chat', async (req, res) => {
    const userId = req.user.id;
    const message = v.str(req.body.message, 'Pesan', { max: 1000 });
    const today = /^\d{4}-\d{2}-\d{2}$/.test(req.body.today || '') ? v.date(req.body.today) : todayIn(config.timezone);

    for (const [key, max, windowMs] of [[`chat:${userId}`, 15, 60_000], [`chat-day:${userId}`, 300, 24 * 60 * 60_000]]) {
      const r = limiter.hit(key, max, windowMs);
      if (!r.ok) throw new HttpError(429, 'Kamu mengirim pesan terlalu cepat. Tunggu sebentar ya.', 'RATE_LIMITED', { retryAfter: r.retryAfter });
    }

    const ctx = buildContext(db, req.user, today);
    const history = db.all('SELECT role, content FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?', userId, HISTORY_FOR_AI).reverse();
    db.run('INSERT INTO chat_messages (user_id, role, content, created_at) VALUES (?,?,?,?)', userId, 'user', message, nowIso());

    let reply;
    let mode = 'basic';
    let notice;
    if (config.ai.enabled) {
      const messages = [...history, { role: 'user', content: message }];
      while (messages.length && messages[0].role !== 'user') messages.shift();
      try {
        reply = await askAI(config.ai, { system: systemPrompt(ctx), messages }, fetchImpl);
        mode = 'ai';
      } catch (err) {
        console.error('Chat AI gagal:', err.message);
        notice = 'Layanan AI sedang tidak bisa dihubungi, jadi ini jawaban dari mode dasar.';
      }
    }
    reply ??= basicAnswer(message, ctx);

    const r = db.run('INSERT INTO chat_messages (user_id, role, content, mode, created_at) VALUES (?,?,?,?,?)', userId, 'assistant', reply, mode, nowIso());
    db.run('DELETE FROM chat_messages WHERE user_id = ? AND id <= (SELECT id FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)', userId, userId, KEEP_MESSAGES);
    res.json({ id: Number(r.lastInsertRowid), reply, mode, notice });
  });

  return router;
}
