# Budget Tracker

Aplikasi pembukuan dan anggaran berbasis web. Kamu mencatat uang masuk dan keluar
lewat form sederhana, lalu aplikasi menyusun sendiri grafik dan laporan keuangannya.

## Isi aplikasi

| Menu | Gunanya |
| --- | --- |
| **Dasbor** | Total uang, pemasukan vs pengeluaran 6 bulan, pengeluaran per kategori, anggaran, tren saldo |
| **Transaksi** | Catat pemasukan, pengeluaran, transfer antar dompet, setor modal, prive |
| **Utang & Piutang** | Siapa berutang ke siapa, jatuh tempo, cicilan, penanda terlambat |
| **Anggaran** | Batas pengeluaran bulanan per kategori, dengan peringatan kalau hampir/lewat batas |
| **Laporan** | Laba Rugi, Neraca, Arus Kas, Perubahan Modal, Neraca Saldo, Buku Besar, Jurnal Umum, Utang Piutang. Bisa unduh Excel dan cetak/PDF |
| **Jurnal Umum** | Semua catatan dalam bentuk debit-kredit, plus jurnal manual |
| **Daftar Akun** | Dompet (kas, bank, e-wallet) dan kategori |
| **Kontak** | Pelanggan, pemasok, karyawan |
| **Asisten** | Chatbot di pojok kanan bawah yang menjawab berdasarkan datamu |
| **Akun** | Daftar dengan email, kode verifikasi, masuk, lupa kata sandi, ganti kata sandi, hapus akun |

## Cara menjalankan

Butuh **Node.js versi 22.13 atau lebih baru** (unduh versi LTS di <https://nodejs.org>).

Buka terminal di folder ini, lalu:

```bash
npm install     # sekali saja, mengunduh bahan-bahan yang dibutuhkan
npm start       # menyalakan aplikasi
```

Buka <http://localhost:3000> di browser. Untuk mematikan, tekan `Ctrl + C` di terminal.

### Mau langsung lihat isinya?

```bash
npm run demo    # membuat akun contoh berisi data 6 bulan
npm start
```

Masuk dengan `demo@contoh.test` / `demo12345`. Akun contoh ini hanya untuk coba-coba di
laptop sendiri; jangan dibuat di server yang dipakai orang lain.

## Alur membuat akun

1. **Daftar**: isi nama, email, dan kata sandi (minimal 8 karakter).
2. **Verifikasi email**: masukkan kode 6 angka yang dikirim ke email. Kode berlaku
   15 menit, maksimal 5 kali salah, dan bisa dikirim ulang setelah 60 detik.
3. **Pengaturan awal**: pilih dipakai untuk pribadi atau usaha (menentukan daftar
   kategori awal), lalu isi uang yang kamu punya sekarang sebagai saldo awal.
4. Selesai, dasbor terbuka.

> **Mode percobaan.** Selama pengiriman email belum diatur, kode verifikasi
> ditampilkan langsung di layar dan di terminal. Ini supaya aplikasi bisa dicoba
> tanpa repot. Sebelum dipakai orang lain, atur email sungguhan (lihat di bawah).

## Pengaturan (file `.env`)

Salin `.env.example` menjadi `.env`, lalu isi seperlunya. Setiap kali `.env` diubah,
matikan server lalu jalankan `npm start` lagi.

### Email sungguhan

Isi bagian `SMTP_...`. Contoh untuk Gmail ada di dalam `.env.example` (pakai
"Sandi Aplikasi", bukan kata sandi Gmail biasa).

### Chatbot AI

Tanpa pengaturan, chatbot berjalan dalam **mode dasar**: ia mengenali pertanyaan umum
(saldo, pengeluaran, pemasukan, kategori terbesar, anggaran, utang, piutang, untung-rugi,
transaksi terbaru) dan menjawab langsung dari datamu. Tidak ada data yang dikirim ke luar.

Untuk jawaban yang lebih luwes, isi `AI_PROVIDER` dan `AI_API_KEY`. Penyedia yang
didukung: `anthropic` (Claude), `openai`, `gemini`, `groq`, `openrouter`, atau `custom`.

Yang perlu kamu tahu:

- Memakai AI berarti **ringkasan keuangan pengguna dikirim ke penyedia AI** setiap kali
  ada pertanyaan (saldo, total per kategori, anggaran, utang-piutang, 12 catatan terakhir).
  Email dan kata sandi tidak pernah ikut dikirim.
- Penyedia AI biasanya **menagih biaya** per pemakaian.
- Kalau layanan AI gagal dihubungi, chatbot otomatis kembali ke mode dasar.
- Sambungan ke penyedia AI sudah diuji dengan server tiruan (format permintaannya
  sesuai dokumentasi resmi), tetapi **belum pernah dicoba dengan kunci asli**. Setelah
  mengisi kunci, coba kirim satu pertanyaan. Kalau gagal, pesan errornya muncul di terminal.

## Perintah lain

| Perintah | Gunanya |
| --- | --- |
| `npm run dev` | Mode pengembangan. Buka <http://localhost:5173>; perubahan kode langsung terlihat |
| `npm run build` | Membuat ulang tampilan (folder `dist`). **Wajib dijalankan setelah mengubah isi folder `src`** |
| `npm test` | Menjalankan tes otomatis bagian server |
| `npm run typecheck` | Memeriksa kode tampilan |

## Susunan folder

```
server/            ← "dapur": menyimpan data, mengurus akun, menghitung laporan
  index.js           titik mulai
  app.js             merakit server + pengaman
  db.js              struktur tabel (SQLite, satu file di folder data/)
  accounting.js      inti pembukuan dan semua laporan
  routes/auth.js     daftar, verifikasi, masuk, lupa kata sandi
  routes/api.js      transaksi, utang-piutang, anggaran, laporan, kontak
  routes/chat.js     chatbot
  ai/                penghubung ke penyedia AI + mode dasar
  test/              tes otomatis
src/               ← "ruang makan": semua yang terlihat di layar
  pages/             satu file per halaman
  components/        tombol, grafik, menu samping, chatbot
  index.css          warna dan huruf (ubah di sini untuk ganti nuansa)
dist/              ← tampilan yang sudah jadi (dibuat oleh npm run build)
data/              ← file database (muncul otomatis saat pertama dijalankan)
```

Ibaratnya: `src` adalah ruang makan yang dilihat tamu, `server` adalah dapur yang
memasak pesanan, dan `data` adalah lemari penyimpanan.

## Menaruh aplikasi online

Aplikasi ini punya server, jadi **tidak bisa ditaruh di GitHub Pages** (yang hanya
bisa menampilkan halaman diam). Pakai hosting yang bisa menjalankan Node.js dan punya
penyimpanan tetap untuk file database (misalnya VPS, atau layanan dengan fitur
"persistent disk").

Yang perlu diatur di hosting:

- Perintah mulai: `npm start`
- `NODE_ENV=production`
- `APP_URL` = alamat aplikasimu
- `DB_PATH` = lokasi file database di penyimpanan tetap
- `SMTP_...` wajib diisi (di production kode verifikasi tidak ditampilkan di layar)
- Pastikan alamatnya memakai **https**

Cadangkan folder `data/` secara berkala. Pengguna juga bisa mengunduh cadangan
datanya sendiri dari menu Pengaturan.

## Keamanan yang sudah dipasang

- Kata sandi disimpan dalam bentuk acakan satu arah (scrypt), tidak pernah apa adanya.
- Sesi login memakai cookie `HttpOnly` yang tidak bisa dibaca skrip di halaman.
- Percobaan login, daftar, dan kode verifikasi dibatasi supaya tidak bisa ditebak berulang-ulang.
- Setiap data selalu disaring per pemilik akun; pengguna lain tidak bisa melihat atau mengubahnya.
- Ganti/atur ulang kata sandi otomatis mengeluarkan perangkat lain.
- Semua isian diperiksa di server, dan setiap jurnal dijamin seimbang (debit = kredit).

## Yang belum ada

Supaya jelas dari awal, hal-hal ini belum dibuat:

- Faktur/invoice
- Satu pembukuan dipakai beberapa orang dengan hak akses berbeda
- Mengganti alamat email akun
- Mode gelap
- Impor data dari Excel
- Utang yang dicatat lewat jurnal manual tidak muncul di menu Utang & Piutang
  (tetap terhitung di Neraca)

## Catatan soal zip asli

Zip yang menjadi dasar proyek ini berisi website panduan (tutorial), bukan aplikasinya.
Proyek ini memakai kerangka yang sama (React, Vite, Tailwind), tetapi isi panduannya
diganti dengan aplikasi yang sesungguhnya.
