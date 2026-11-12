// Berbagi pembukuan: pemilik mengundang orang lewat email, dengan peran
//   editor = "Pencatat" (boleh mencatat & mengubah)   viewer = "Pelihat" (hanya melihat).
// Undangan hanya bisa diterima oleh pemilik email itu (emailnya sudah diverifikasi saat daftar).
import express from 'express';
import { HttpError, bad, notFound, v } from '../http.js';
import { nowIso } from '../db.js';
import { inviteEmail } from '../mailer.js';
import { INVITE_DAYS } from './auth.js';

const ROLES = ['editor', 'viewer'];
const MAX_PEOPLE = 20; // anggota + undangan yang menunggu

export function createTeam({ db, config, mailer, limiter, requireOwner }) {
  const router = express.Router();

  // Alamat aplikasi untuk tautan di email: APP_URL kalau diisi, kalau tidak alamat yang sedang dipakai pemilik.
  const appUrl = (req) => (config.appUrlExplicit ? config.appUrl : `${req.protocol}://${req.get('host')}`);

  // Profil pembukuan (kop faktur): semua anggota boleh melihat, hanya pemilik yang mengubah.
  router.get('/book', (req, res) => {
    const b = req.book;
    res.json({ id: b.id, role: b.role, name: b.name, usage: b.usage, ownerName: b.ownerName, address: b.address, phone: b.phone, paymentInfo: b.paymentInfo });
  });

  router.patch('/book', requireOwner, async (req, res) => {
    const name = v.str(req.body.name, 'Nama pembukuan', { max: 80, optional: true });
    const address = v.str(req.body.address, 'Alamat', { max: 300, optional: true });
    const phone = v.str(req.body.phone, 'Telepon', { max: 40, optional: true });
    const paymentInfo = v.str(req.body.paymentInfo, 'Info pembayaran', { max: 400, optional: true });
    await db.run('UPDATE users SET business_name = ?, business_address = ?, business_phone = ?, payment_info = ? WHERE id = ?', name, address, phone, paymentInfo, req.book.id);
    res.json({ ok: true });
  });

  router.get('/team', requireOwner, async (req, res) => {
    const owner = { id: req.user.id, name: req.user.name, email: req.user.email };
    const members = await db.all(
      `SELECT m.user_id AS "userId", m.role, m.created_at AS "joinedAt", u.name, u.email
       FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.book_id = ? ORDER BY m.created_at`,
      req.book.id,
    );
    const now = nowIso();
    const invitations = (await db.all('SELECT id, email, role, created_at AS "createdAt", expires_at AS "expiresAt" FROM invitations WHERE book_id = ? ORDER BY created_at DESC', req.book.id))
      .map((i) => ({ ...i, expired: i.expiresAt < now }));
    res.json({ owner, members, invitations });
  });

  router.post('/team/invitations', requireOwner, async (req, res) => {
    const check = await limiter.hit(`invite:${req.book.id}`, 20, 60 * 60_000);
    if (!check.ok) throw new HttpError(429, 'Terlalu banyak undangan dalam satu jam. Coba lagi nanti.', 'RATE_LIMITED', { retryAfter: check.retryAfter });
    const email = v.email(req.body.email);
    const role = v.oneOf(req.body.role, ROLES, 'Peran');
    if (email === req.user.email.toLowerCase()) throw bad('Itu alamat emailmu sendiri. Kamu sudah menjadi pemilik pembukuan ini.');
    const member = await db.get('SELECT 1 AS x FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.book_id = ? AND lower(u.email) = ?', req.book.id, email);
    if (member) throw bad('Orang ini sudah menjadi anggota. Ubah perannya dari daftar anggota.');
    const existing = await db.get('SELECT id FROM invitations WHERE book_id = ? AND lower(email) = ?', req.book.id, email);
    if (!existing) {
      const people = (await db.get('SELECT (SELECT COUNT(*) FROM memberships WHERE book_id = ?) + (SELECT COUNT(*) FROM invitations WHERE book_id = ?) AS n', req.book.id, req.book.id)).n;
      if (people >= MAX_PEOPLE) throw bad(`Maksimal ${MAX_PEOPLE} anggota dan undangan per pembukuan.`);
    }
    const now = nowIso();
    const expires = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
    let id;
    if (existing) {
      // Mengundang ulang = memperbarui peran dan masa berlaku, lalu mengirim email lagi.
      await db.run('UPDATE invitations SET role = ?, created_at = ?, expires_at = ?, invited_by = ? WHERE id = ?', role, now, expires, req.user.id, existing.id);
      id = existing.id;
    } else {
      id = await db.insert('INSERT INTO invitations (book_id, email, role, invited_by, created_at, expires_at) VALUES (?,?,?,?,?,?)', req.book.id, email, role, req.user.id, now, expires);
    }
    let emailSent = true;
    try {
      await mailer.send({ to: email, ...inviteEmail({ inviterName: req.user.name, bookName: req.book.name || `Pembukuan ${req.user.name}`, role, url: appUrl(req), days: INVITE_DAYS }) });
    } catch (err) {
      console.error('Gagal mengirim email undangan:', err.message);
      emailSent = false; // undangannya tetap tersimpan; orangnya akan melihatnya setelah masuk
    }
    res.status(201).json({ id, emailSent });
  });

  router.delete('/team/invitations/:id', requireOwner, async (req, res) => {
    const r = await db.run('DELETE FROM invitations WHERE id = ? AND book_id = ?', v.id(req.params.id), req.book.id);
    if (!r.changes) throw notFound('Undangan tidak ditemukan.');
    res.json({ ok: true });
  });

  router.patch('/team/members/:userId', requireOwner, async (req, res) => {
    const role = v.oneOf(req.body.role, ROLES, 'Peran');
    const r = await db.run('UPDATE memberships SET role = ? WHERE book_id = ? AND user_id = ?', role, req.book.id, v.id(req.params.userId));
    if (!r.changes) throw notFound('Anggota tidak ditemukan.');
    res.json({ ok: true });
  });

  router.delete('/team/members/:userId', requireOwner, async (req, res) => {
    const userId = v.id(req.params.userId);
    const r = await db.run('DELETE FROM memberships WHERE book_id = ? AND user_id = ?', req.book.id, userId);
    if (!r.changes) throw notFound('Anggota tidak ditemukan.');
    await db.run('UPDATE sessions SET book_id = NULL WHERE user_id = ? AND book_id = ?', userId, req.book.id);
    res.json({ ok: true });
  });

  return router;
}
