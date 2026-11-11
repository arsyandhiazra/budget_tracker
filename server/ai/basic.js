// "Asisten dasar": menjawab pertanyaan umum soal keuangan pengguna TANPA model AI.
// Caranya sederhana: mencari kata kunci di pertanyaan, lalu menyusun jawaban
// dari data. Dipakai kalau kunci API belum diisi, atau kalau layanan AI sedang gagal.
import { kindLabel } from './context.js';

const rp = (n) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const has = (text, re) => re.test(text);

function pickPeriod(text, ctx) {
  if (has(text, /hari ini|harian/)) return ['hari ini', ctx.todayTotals];
  if (has(text, /minggu|pekan|7 hari/)) return ['7 hari terakhir', ctx.week];
  if (has(text, /bulan (lalu|kemarin|sebelumnya)/)) return ['bulan lalu', ctx.lastMonth];
  if (has(text, /tahun/)) return ['tahun ini', ctx.year];
  return ['bulan ini', ctx.month];
}

const list = (items, n = 5) => items.slice(0, n).map((c, i) => `${i + 1}. ${c.name} — ${rp(c.amount)}`).join('\n');

function compare(now, before, label) {
  if (!before) return '';
  const diff = now - before;
  if (diff === 0) return ` Sama dengan ${label}.`;
  const pct = Math.round((Math.abs(diff) / before) * 100);
  return ` Itu ${diff > 0 ? 'naik' : 'turun'} ${pct}% dibanding ${label} (${rp(before)}).`;
}

const HELP = {
  transaksi: 'Buka menu **Transaksi**, lalu tekan **Tambah transaksi**. Pilih jenisnya (pemasukan, pengeluaran, atau transfer), isi jumlah, kategori, dan dompetnya, lalu simpan.',
  anggaran: 'Buka menu **Anggaran**, lalu isi batas bulanan di kategori yang kamu mau. Batang di sampingnya akan menunjukkan sudah terpakai berapa.',
  utang: 'Buka menu **Utang & Piutang**, tekan **Catat baru**, lalu pilih utang (kamu yang harus bayar) atau piutang (orang lain yang harus bayar ke kamu). Saat ada pembayaran, tekan **Bayar** di baris catatannya.',
  laporan: 'Buka menu **Laporan**, pilih jenis laporannya (misalnya Laba Rugi atau Neraca), atur tanggalnya, lalu tekan **Excel** untuk mengunduh atau **Cetak / PDF** untuk mencetak.',
  kontak: 'Buka menu **Kontak**, lalu tekan **Tambah kontak**. Kontak dipakai untuk mencatat siapa pelanggan, pemasok, atau karyawanmu.',
  akun: 'Buka menu **Daftar Akun**, lalu tekan **Tambah akun**. Di sana kamu bisa menambah kategori pemasukan/pengeluaran atau dompet baru.',
};

export function basicAnswer(message, ctx) {
  const text = String(message).toLowerCase().replace(/[^\p{L}\p{N}\s?]/gu, ' ').replace(/\s+/g, ' ').trim();

  if (!ctx.hasData && !has(text, /\bcara\b|bisa apa|^(halo|hai|hi|hello|hey)\b/)) {
    return 'Kamu belum punya catatan transaksi, jadi belum ada yang bisa aku hitung. Coba tambah dulu lewat menu **Transaksi**, nanti aku bisa bantu merangkumnya.';
  }

  // Cara memakai aplikasi. "Gimana anggaran saya?" bukan pertanyaan cara pakai,
  // jadi kata tanya saja tidak cukup — harus diikuti kata kerja atau kata "menu".
  const howTo = has(text, /\bcara\b/)
    || has(text, /\b(gimana|bagaimana|dimana|di mana)\b.*\b(tambah|menambah|catat|mencatat|input|buat|membuat|bikin|pasang|memasang|atur|mengatur|hapus|menghapus|ubah|mengubah|edit|ekspor|export|cetak|mencetak|unduh|download|bayar|menu|tombol)\b/);
  if (howTo) {
    if (has(text, /anggaran|budget|limit/)) return HELP.anggaran;
    if (has(text, /utang|hutang|piutang/)) return HELP.utang;
    if (has(text, /laporan|ekspor|export|excel|pdf|cetak|unduh|download/)) return HELP.laporan;
    if (has(text, /kontak|pelanggan|pemasok|supplier/)) return HELP.kontak;
    if (has(text, /kategori|akun|dompet|rekening/)) return HELP.akun;
    if (has(text, /tambah|catat|input|masuk|buat|transaksi|pengeluaran|pemasukan/)) return HELP.transaksi;
  }

  if (has(text, /^(halo|hai|hi|hello|hey|pagi|siang|sore|malam|assalam|permisi)\b/) && text.split(' ').length <= 4) {
    return `Halo ${ctx.name.split(' ')[0]}! Aku bisa bantu cek saldo, pengeluaran, pemasukan, anggaran, utang-piutang, dan untung-rugi kamu. Mau tanya apa?`;
  }

  // Anggaran
  if (has(text, /anggaran|budget|limit|jatah/)) {
    if (!ctx.budgets.length) return 'Kamu belum memasang anggaran. Pasang batas bulanan per kategori di menu **Anggaran**, nanti aku bisa kasih tahu sisa jatahnya.';
    const over = ctx.budgets.filter((b) => b.spent > b.budget);
    const rows = ctx.budgets.map((b) => {
      const left = b.budget - b.spent;
      return `- ${b.name}: terpakai ${rp(b.spent)} dari ${rp(b.budget)} (${left >= 0 ? `sisa ${rp(left)}` : `lewat ${rp(-left)}`})`;
    }).join('\n');
    const note = over.length ? `\n\nYang sudah lewat batas: ${over.map((b) => b.name).join(', ')}.` : '\n\nSemua masih di dalam batas.';
    return `Anggaran bulan ini:\n${rows}${note}`;
  }

  // Utang & piutang
  if (has(text, /piutang/) || has(text, /utang|hutang|pinjam/)) {
    const wantReceivable = has(text, /piutang/);
    const items = wantReceivable ? ctx.debts.receivable : ctx.debts.payable;
    const label = wantReceivable ? 'piutang (uang yang harus kamu terima)' : 'utang (uang yang harus kamu bayar)';
    if (!items.length) return `Tidak ada ${label} yang belum lunas.`;
    const total = items.reduce((s, d) => s + d.remaining, 0);
    const rows = items.slice(0, 6).map((d) => `- ${d.contact?.name || 'Tanpa nama'}: ${rp(d.remaining)}${d.dueDate ? `, jatuh tempo ${d.dueDate}` : ''}${d.status === 'overdue' ? ' — sudah terlambat' : ''}`).join('\n');
    return `Total ${label}: ${rp(total)}.\n${rows}`;
  }

  // Untung / rugi
  if (has(text, /laba|rugi|untung|profit|surplus|defisit|selisih/)) {
    const [label, t] = pickPeriod(text, ctx);
    const word = t.net >= 0 ? 'lebih (untung)' : 'kurang (rugi)';
    return `Untuk ${label}: pemasukan ${rp(t.income)} dan pengeluaran ${rp(t.expense)}. Hasilnya ${word} ${rp(Math.abs(t.net))}.`;
  }

  // Kategori terbesar
  if (has(text, /terbesar|terbanyak|paling (banyak|besar|boros)|boros|kategori|buat apa|ke mana|kemana/)) {
    const [label, t] = pickPeriod(text, ctx);
    if (!t.expenses.length) return `Belum ada pengeluaran untuk ${label}.`;
    const top = t.expenses[0];
    const share = t.expense ? Math.round((top.amount / t.expense) * 100) : 0;
    return `Pengeluaran terbesar ${label} ada di **${top.name}**: ${rp(top.amount)} (${share}% dari total ${rp(t.expense)}).\n\nUrutannya:\n${list(t.expenses)}`;
  }

  // Pengeluaran
  if (has(text, /pengeluaran|keluar|belanja|habis|spending|boros/)) {
    const [label, t] = pickPeriod(text, ctx);
    const extra = label === 'bulan ini' ? compare(t.expense, ctx.lastMonthToDate.expense, 'periode yang sama bulan lalu') : '';
    const top = t.expenses.length ? `\n\nTerbanyak:\n${list(t.expenses, 3)}` : '';
    return `Pengeluaran ${label}: ${rp(t.expense)}.${extra}${top}`;
  }

  // Pemasukan
  if (has(text, /pemasukan|pendapatan|penghasilan|masuk|omzet|omset|gaji/)) {
    const [label, t] = pickPeriod(text, ctx);
    const extra = label === 'bulan ini' ? compare(t.income, ctx.lastMonthToDate.income, 'periode yang sama bulan lalu') : '';
    const top = t.incomes.length ? `\n\nSumbernya:\n${list(t.incomes, 3)}` : '';
    return `Pemasukan ${label}: ${rp(t.income)}.${extra}${top}`;
  }

  // Saldo
  if (has(text, /saldo|kas\b|uang|dompet|bank|rekening|tabungan|punya berapa/)) {
    const rows = ctx.wallets.map((w) => `- ${w.name}: ${rp(w.balance)}`).join('\n');
    return `Total uangmu sekarang ${rp(ctx.cashTotal)}.\n${rows}`;
  }

  // Catatan terbaru
  if (has(text, /terakhir|terbaru|riwayat|transaksi|catatan/)) {
    if (!ctx.recent.length) return 'Belum ada catatan transaksi.';
    const rows = ctx.recent.slice(0, 6).map((e) => `- ${e.date} · ${e.description} · ${kindLabel(e.kind)} ${rp(e.amount)}`).join('\n');
    return `Catatan terbaru kamu:\n${rows}`;
  }

  // Ringkasan + saran berbasis data (juga jadi jawaban cadangan)
  const m = ctx.month;
  const notes = [];
  if (m.expenses.length) {
    const top = m.expenses[0];
    notes.push(`Pengeluaran terbesar ada di ${top.name} (${rp(top.amount)}).`);
  }
  if (m.net < 0) notes.push('Bulan ini pengeluaranmu lebih besar dari pemasukan. Coba cek kategori terbesar, mungkin ada yang bisa dikurangi.');
  else if (m.income > 0) notes.push(`Kamu berhasil menyisihkan ${Math.round((m.net / m.income) * 100)}% dari pemasukan bulan ini.`);
  const over = ctx.budgets.filter((b) => b.spent > b.budget);
  if (over.length) notes.push(`Anggaran yang lewat batas: ${over.map((b) => b.name).join(', ')}.`);
  const late = [...ctx.debts.payable, ...ctx.debts.receivable].filter((d) => d.status === 'overdue');
  if (late.length) notes.push(`Ada ${late.length} utang/piutang yang sudah lewat jatuh tempo.`);

  const summary = `Ringkasan bulan ini: pemasukan ${rp(m.income)}, pengeluaran ${rp(m.expense)}, selisih ${rp(m.net)}. Total uangmu ${rp(ctx.cashTotal)}.${notes.length ? `\n\n${notes.map((n) => `- ${n}`).join('\n')}` : ''}`;
  if (has(text, /tips|saran|hemat|irit|nabung|menabung|kondisi|analisis|ringkas|rangkum|summary|gimana keuangan|bagaimana keuangan/)) return summary;

  return `${summary}\n\nAku sedang dalam mode dasar, jadi baru bisa menjawab soal: saldo, pengeluaran, pemasukan, kategori terbesar, anggaran, utang, piutang, untung-rugi, dan transaksi terbaru. Coba tanya dengan kata-kata itu ya.`;
}
