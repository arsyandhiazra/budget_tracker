# Budget Tracker

Aplikasi pembukuan dan anggaran berbasis web. Kamu mencatat uang masuk dan keluar
lewat form sederhana, lalu aplikasi menyusun sendiri grafik dan laporan keuangannya.

## Isi aplikasi

| Menu | Gunanya |
| --- | --- |
| **Dasbor** | Total uang, pemasukan vs pengeluaran 6 bulan, pengeluaran per kategori, anggaran, tren saldo |
| **Transaksi** | Catat pemasukan, pengeluaran, transfer antar dompet, setor modal, prive |
| **Faktur** | Buat faktur untuk pelanggan (nomor otomatis, diskon, PPN), cetak atau simpan PDF, catat pembayarannya. Otomatis menjadi piutang |
| **Utang & Piutang** | Siapa berutang ke siapa, jatuh tempo, cicilan, penanda terlambat. Termasuk yang berasal dari faktur dan jurnal manual |
| **Anggaran** | Batas pengeluaran bulanan per kategori, dengan peringatan kalau hampir/lewat batas |
| **Laporan** | Laba Rugi, Neraca, Arus Kas, Perubahan Modal, Neraca Saldo, Buku Besar, Jurnal Umum, Utang Piutang. Bisa unduh Excel dan cetak/PDF |
| **Jurnal Umum** | Semua catatan dalam bentuk debit-kredit, plus jurnal manual |
| **Daftar Akun** | Dompet (kas, bank, e-wallet) dan kategori |
| **Kontak** | Pelanggan, pemasok, karyawan |
| **Impor Data** | Memasukkan banyak transaksi sekaligus dari file Excel (.xlsx) atau CSV, dengan pratinjau dulu |
| **Asisten** | Chatbot di pojok kanan bawah yang menjawab berdasarkan datamu |
| **Pengaturan** | Profil, ganti email, ganti kata sandi, kop faktur, anggota & peran, tampilan terang/gelap, cadangan, hapus akun |
| **Akun** | Daftar dengan email, kode verifikasi, masuk, lupa kata sandi |

## Cara menjalankan

Butuh **Node.js versi 22.13 atau lebih baru** (unduh versi LTS di <https://nodejs.org>).

Buka terminal di folder ini, lalu:

```bash
npm install     # sekali saja, mengunduh bahan-bahan yang dibutuhkan
npm start       # menyalakan aplikasi
```

Buka <http://localhost:3000> di browser. Untuk mematikan, tekan `Ctrl + C` di terminal.

Di laptop, data disimpan di folder `data/pglite` (database Postgres lokal), jadi tidak
perlu memasang apa-apa dan datanya tidak hilang walaupun aplikasi dimatikan. Kalau
kamu mengisi `DATABASE_URL` di `.env`, aplikasi memakai database itu.

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

## Fitur-fitur yang dipakai bersama

### Dipakai beberapa orang (anggota & peran)

Satu pembukuan bisa dipakai bersama, misalnya pemilik usaha dan karyawan yang mencatat.
Pemilik membuka **Pengaturan → Anggota & akses**, memasukkan email orangnya, dan memilih peran:

| Peran | Boleh apa |
| --- | --- |
| **Pemilik** | Semuanya: mencatat, mengundang/mengeluarkan anggota, mengubah kop faktur, mengunduh cadangan |
| **Pencatat** | Melihat dan mencatat/mengubah/menghapus data (transaksi, faktur, utang, kontak, impor). Tidak bisa mengelola anggota |
| **Pelihat** | Hanya melihat dasbor, daftar, dan laporan. Boleh bertanya ke asisten. Tidak bisa mengubah apa pun |

Cara kerjanya: orang yang diundang masuk (atau daftar dulu) memakai **email yang sama dengan
undangan**, lalu menerima undangan di bagian atas halaman. Setelah itu ia bisa berpindah antara
pembukuannya sendiri dan pembukuan yang dibagikan lewat pilihan **Sedang dibuka** di menu samping.
Setiap catatan menyimpan siapa yang mencatatnya. Perubahan peran atau mengeluarkan anggota
berlaku seketika.

Yang perlu diketahui:

- Email undangan dikirim lewat pengaturan email (`SMTP_...`) yang sama dengan kode verifikasi.
  Kalau email gagal terkirim, undangannya tetap tersimpan dan langsung terlihat oleh orangnya
  setelah ia masuk dengan email itu.
- Undangan berlaku 14 hari. Satu pembukuan maksimal 20 anggota dan undangan.
- Pemilik tidak bisa menghapus akunnya selama pembukuannya masih dibagikan. Keluarkan semua
  anggota dulu, supaya data yang dipakai orang lain tidak hilang tanpa sengaja.

### Faktur

Menu **Faktur → Buat faktur**: pilih atau ketik pelanggan, isi barang/jasa (jumlah boleh
desimal, mis. 1,5 jam), diskon, dan pajak (isi 11 untuk PPN 11%). Nomor otomatis berurutan per
tahun (`INV-2026-0001`), atau isi nomor sendiri.

- Faktur otomatis dicatat sebagai **piutang** dan **pendapatan** (dan **Utang Pajak (PPN)** kalau
  memakai pajak; akunnya dibuat otomatis saat faktur pertama dengan pajak). Pelanggan baru
  otomatis masuk ke Kontak.
- Saat pelanggan membayar, tekan **Catat pembayaran** di halaman faktur. Pembayaran sebagian
  boleh. Status berubah: *Belum dibayar → Dibayar sebagian → Lunas*, atau *Terlambat* kalau lewat
  jatuh tempo.
- **Cetak / simpan PDF** memakai fitur cetak browser: hanya dokumen faktur yang dicetak.
  Nama usaha, alamat, telepon, dan info rekening di kop diatur di **Pengaturan → Pembukuan & faktur**.
- Faktur yang sudah ada pembayarannya tidak bisa diubah isinya (hapus dulu pembayarannya).
  Menghapus faktur ikut menghapus piutang dan pembayarannya.

### Impor dari Excel atau CSV

Menu **Impor Data**. Alurnya dua tahap supaya aman: pilih file → **periksa pratinjau** (belum ada
yang tersimpan) → impor. Hasil impor tersimpan dalam satu paket: berhasil semua atau tidak sama sekali.

- Unduh **template Excel** (memakai nama kategori dan dompet pembukuanmu), atau pakai file sendiri
  dengan kolom: **Tanggal, Jenis** (Pemasukan/Pengeluaran), **Jumlah, Kategori, Dompet, Keterangan**.
  Judul kolom boleh di baris mana saja dalam 15 baris pertama. Dikenali juga: dua kolom
  *Pemasukan* dan *Pengeluaran* terpisah, atau satu kolom *Jumlah* dengan tanda minus untuk
  pengeluaran (seperti mutasi rekening).
- Tanggal ditulis hari/bulan/tahun (`31/01/2026`, `31 Jan 2026`) atau `2026-01-31`. Jumlah boleh
  `1250000`, `1.250.000`, atau `Rp 1.250.000`. Maksimal 2.000 baris dan 3 MB per file.
- Kategori yang belum ada bisa dibuat otomatis (bisa dimatikan). Kategori kosong memakai
  kategori "lain-lain", dompet kosong memakai dompet bawaan yang kamu pilih.
- **Duplikat dikenali** (tanggal, jenis, jumlah, keterangan, kategori, dan dompet sama persis dengan
  transaksi yang sudah ada), jadi file yang sama tidak tercatat dua kali.
- Yang diimpor: pemasukan dan pengeluaran. Transfer dan utang tetap dicatat dari menunya.
  File `.xls` (Excel versi lama) belum dibaca; simpan dulu sebagai `.xlsx` atau `.csv`.

### Utang yang dicatat lewat jurnal manual

Jurnal manual yang menyentuh akun utang atau piutang (Utang Usaha, Utang Pinjaman, Piutang, atau akun
buatanmu dengan jenis yang sama) otomatis muncul juga di **Utang & Piutang**, lengkap dengan kontak
dan jatuh tempo yang kamu isi di formulir jurnal. Pelunasan lewat jurnal memotong utang tertua
pada akun yang sama (atau milik kontak yang dipilih). Kalau ada selisih antara Neraca dan daftar
itu, halaman Utang & Piutang menampilkannya.

Catatan dari jurnal diubah atau dihapus lewat **Jurnal Umum**, bukan lewat tombol Hapus di Utang &
Piutang. Jurnal yang utangnya sudah ada pembayarannya tidak bisa dihapus atau dikecilkan di bawah
jumlah yang sudah dibayar.

### Mengganti email akun

**Pengaturan → Ganti email**: masukkan email baru dan kata sandi, lalu kode 6 angka dikirim ke
email **baru** itu (untuk memastikan alamatnya milikmu). Setelah kode dimasukkan, email diganti,
alamat lama diberi tahu, dan perangkat lain otomatis keluar. Mulai saat itu masuk dan kode
verifikasi memakai email baru.

### Tampilan terang dan gelap

**Pengaturan → Tampilan** (atau tombol bulan/matahari di menu samping): *Terang*, *Gelap*, atau
*Ikuti perangkat*. Pilihan tersimpan di browser itu saja. Saat dicetak, tampilan selalu terang.

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
| `npm test` | Menjalankan tes otomatis bagian server (memakai database lokal sementara). Isi `TEST_DATABASE_URL` kalau mau menguji di Postgres sungguhan; jalankan keduanya sebelum merilis |
| `npm run typecheck` | Memeriksa kode tampilan |

## Susunan folder

```
server/            ← "dapur": menyimpan data, mengurus akun, menghitung laporan
  index.js           titik mulai
  app.js             merakit server + pengaman
  db.js              struktur tabel + sambungan ke database (Postgres)
  accounting.js      inti pembukuan dan semua laporan
  invoices.js        faktur: hitungan, jurnal otomatis, pembayaran
  import.js          impor Excel/CSV: pemeriksaan baris, deteksi duplikat, simpan massal
  xlsx.js / xlsx-read.js   menulis dan membaca file Excel (tanpa pustaka tambahan)
  table.js           membaca .xlsx atau .csv menjadi baris-baris
  routes/auth.js     daftar, masuk, ganti email, pembukuan aktif, undangan
  routes/team.js     anggota & peran, kop pembukuan
  routes/api.js      transaksi, utang-piutang, anggaran, laporan, kontak
  routes/invoices.js faktur
  routes/import.js   impor file
  routes/chat.js     chatbot
  ai/                penghubung ke penyedia AI + mode dasar
  test/              tes otomatis
src/               ← "ruang makan": semua yang terlihat di layar
  pages/             satu file per halaman
  components/        tombol, grafik, menu samping, chatbot, anggota, ganti email
  lib/               penghubung ke server, tema terang/gelap, peran pengguna
  index.css          warna dan huruf, terang dan gelap (ubah di sini untuk ganti nuansa)
dist/              ← tampilan yang sudah jadi (dibuat oleh npm run build)
data/              ← database lokal untuk laptop (hanya muncul kalau DATABASE_URL kosong)
```

Ibaratnya: `src` adalah ruang makan yang dilihat tamu, `server` adalah dapur yang
memasak pesanan, dan `data` adalah lemari penyimpanan.

## Deploy gratis: Vercel + Neon

Hasil akhirnya: aplikasi online di alamat `https://nama-kamu.vercel.app`, siapa pun bisa
daftar dan masuk, dan datanya tersimpan permanen di database Postgres.

| Bagian | Layanan | Biaya |
| --- | --- | --- |
| Tampilan + server | [Vercel](https://vercel.com) | Gratis (paket Hobby) |
| Database permanen | [Neon](https://neon.tech) (Postgres) | Gratis (ada batas ukuran, lihat catatan) |
| Email kode verifikasi | Gmail atau [Brevo](https://www.brevo.com) | Gratis (ada batas kiriman per hari) |

Semua langkah di bawah dilakukan di browser. Tidak ada yang perlu dipasang.

### Langkah 1. Siapkan email pengirim

Aplikasi mengirim kode 6 angka ke email pengguna baru, jadi butuh akun email pengirim.
Cara termudah memakai Gmail milikmu (batas Google sekitar 500 email per hari):

1. Buka <https://myaccount.google.com/security> lalu aktifkan **Verifikasi 2 Langkah**.
2. Buka <https://myaccount.google.com/apppasswords>, buat sandi aplikasi baru (nama bebas,
   mis. "Budget Tracker"). Salin 16 huruf yang muncul.
3. Simpan, nanti dipakai di Langkah 3:

   | Nama | Isi |
   | --- | --- |
   | `SMTP_HOST` | `smtp.gmail.com` |
   | `SMTP_PORT` | `587` |
   | `SMTP_USER` | alamat Gmail kamu |
   | `SMTP_PASS` | 16 huruf sandi aplikasi (**bukan** kata sandi Gmail) |
   | `SMTP_FROM` | `Budget Tracker <alamat-gmail-kamu@gmail.com>` |

Penggunanya ramai? Pakai Brevo (menu *SMTP & API*), isinya sama bentuknya.

### Langkah 2. Buat database gratis di Neon

1. Daftar di <https://neon.tech> (bisa dengan akun GitHub atau Google).
2. Klik **New Project**. Beri nama `budget-tracker`. Pada **Region** pilih
   **AWS Asia Pacific (Singapore)** supaya dekat dengan server Vercel (`sin1`) dan pengguna di Indonesia.
3. Setelah proyek jadi, klik **Connect**. Nyalakan **Connection pooling**, lalu salin
   alamat yang muncul. Bentuknya:
   `postgresql://pengguna:sandi@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
4. Alamat itu adalah **rahasia** (isinya kata sandi database). Jangan ditempel di GitHub atau chat.

Tabel tidak perlu dibuat sendiri: aplikasi membuatnya otomatis saat pertama kali dijalankan.

### Langkah 3. Deploy ke Vercel

1. Pastikan kode ini ada di GitHub, di cabang yang akan dipakai sebagai versi utama
   (biasanya `main`). Kalau kamu bekerja di cabang lain, gabungkan dulu ke `main` lewat Pull Request.
2. Daftar di <https://vercel.com> dengan akun GitHub, lalu klik **Add New → Project**
   dan pilih repositori `budget_tracker`.
3. Vercel mengenali proyek ini otomatis (Vite). Biarkan pengaturan build apa adanya.
4. Buka bagian **Environment Variables**, lalu isi satu per satu:

   | Nama | Isi | Wajib? |
   | --- | --- | --- |
   | `DATABASE_URL` | alamat dari Neon (Langkah 2) | **Ya** |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | dari Langkah 1 | **Ya** |
   | `AI_PROVIDER`, `AI_API_KEY` | untuk chatbot AI (lihat bagian Chatbot AI di atas) | Tidak |

   Jalan pintas untuk database: di Vercel buka tab **Storage** → **Neon** → buat database;
   Vercel mengisi `DATABASE_URL` otomatis.
5. Klik **Deploy**. Tunggu sekitar satu menit sampai muncul alamat `https://....vercel.app`.

### Langkah 4. Uji, supaya yakin ini sungguhan

1. Buka alamatnya dan **daftar dengan emailmu sendiri**. Kode 6 angka harus masuk ke emailmu
   (cek folder Spam kalau belum terlihat).
2. Selesaikan pengaturan awal, lalu catat satu transaksi.
3. Keluar, lalu masuk lagi dengan email dan kata sandi tadi.
4. Di Vercel buka **Deployments → ⋯ → Redeploy**. Setelah selesai, masuk lagi. Akun dan
   transaksimu masih ada: itu tandanya database permanen.
5. Bagikan alamatnya. Setiap perubahan kode yang kamu dorong ke `main` akan dideploy otomatis.

### Kalau ada yang tidak jalan

| Gejala | Penyebab | Perbaikan |
| --- | --- | --- |
| "Server belum siap (database belum tersambung)" | `DATABASE_URL` kosong atau salah | Periksa di Vercel → Settings → Environment Variables, lalu **Redeploy** |
| "Email tidak berhasil dikirim" | `SMTP_...` kosong atau salah | Pastikan memakai sandi aplikasi 16 huruf, bukan kata sandi Gmail. Lihat log di Vercel → Logs |
| Permintaan pertama setelah lama sepi terasa lambat (1–3 detik) | Neon gratis "tidur" saat sepi | Wajar. Permintaan berikutnya cepat |
| Mengubah variabel tapi tidak ada efek | Variabel hanya terbaca saat deploy | **Redeploy** setelah mengubahnya |

### Catatan penting

- **Batas paket gratis.** Neon gratis punya batas penyimpanan (sekitar 0,5 GB per proyek)
  dan riwayat pemulihan yang singkat. Teks catatan keuangan itu kecil, jadi ini cukup untuk
  ribuan pengguna kecil, tetapi cek batas terbaru di situs Neon.
- **Vercel Hobby untuk pemakaian pribadi/non-komersial.** Kalau aplikasi ini dipakai untuk
  bisnis berbayar, ketentuan Vercel mengharuskan paket Pro. Alternatifnya, jalankan di
  hosting lain (lihat bawah). Kodenya sama.
- **Cadangan.** Minta pengguna mengunduh cadangan dari menu Pengaturan secara berkala. Untuk
  seluruh database, pakai `pg_dump "$DATABASE_URL" > cadangan.sql`.
- **Domain sendiri.** Di Vercel buka **Settings → Domains**, ikuti petunjuknya (gratis, domain-nya beli sendiri).
- **Anggota & undangan butuh email.** Email undangan memakai `SMTP_...` yang sama. `APP_URL` boleh
  dikosongkan di Vercel: tautan di email memakai alamat yang sedang dipakai pemilik.
- **Memperbarui aplikasi.** Dorong kode ke `main`; Vercel men-deploy otomatis. Perubahan struktur database
  dijalankan sendiri saat aplikasi pertama kali menyala, dan data lama dipertahankan (termasuk
  jurnal manual lama yang kini tampil di Utang & Piutang).
- **Batas unggahan.** Vercel membatasi isi permintaan sekitar 4,5 MB; impor dibatasi 3 MB per file.

### Memakai hosting lain

Kodenya tidak terikat Vercel. Di hosting yang menjalankan Node.js (Render, Railway, Fly.io,
VPS), isi `NODE_ENV=production`, `DATABASE_URL`, `SMTP_...`, `APP_URL`, lalu jalankan
`npm run build` sekali dan `npm start` sebagai perintah mulai. Tidak butuh disk permanen,
karena datanya ada di Postgres.

## Keamanan yang sudah dipasang

- Kata sandi disimpan dalam bentuk acakan satu arah (scrypt), tidak pernah apa adanya.
- Sesi login memakai cookie `HttpOnly` yang tidak bisa dibaca skrip di halaman.
- Percobaan login, daftar, dan kode verifikasi dibatasi supaya tidak bisa ditebak berulang-ulang
  (catatannya di database, jadi tetap berlaku di hosting serverless).
- Setiap data selalu disaring per pembukuan; orang yang tidak diundang tidak bisa melihat atau
  mengubahnya. Peran **Pelihat** ditolak di server (bukan sekadar tombol yang disembunyikan).
- Undangan hanya bisa diterima oleh pemilik email yang diundang, dan email itu sudah diverifikasi saat daftar.
- Ganti email butuh kata sandi + kode ke alamat baru, dan alamat lama diberi tahu.
- File impor dibaca dengan batas ukuran (anti file "bom" zip), dan hanya lembar data yang dibaca.
- Ganti/atur ulang kata sandi otomatis mengeluarkan perangkat lain.
- Semua isian diperiksa di server, dan setiap jurnal dijamin seimbang (debit = kredit).

## Batasan yang masih ada

Supaya jelas, hal-hal ini belum dibuat:

- **Faktur**: belum bisa dikirim ke pelanggan langsung dari aplikasi (cetak atau simpan PDF lalu
  kirim sendiri), belum ada faktur berulang, satu tarif pajak per faktur, dan hanya rupiah.
- **Impor**: hanya pemasukan dan pengeluaran, dan belum membaca file `.xls` lama.
- **Anggota**: hanya tiga peran (pemilik, pencatat, pelihat); kepemilikan pembukuan belum bisa
  dipindahkan; tidak ada riwayat perubahan (yang tersimpan hanya siapa yang mencatat).
- **Pelunasan lewat jurnal manual** dicocokkan otomatis ke utang tertua. Kalau ingin menentukan
  sendiri utang mana yang dilunasi, pakai tombol **Bayar** di Utang & Piutang.
- **Tema** terang/gelap dipilih per browser; tidak ikut berpindah ke perangkat lain.
- Faktur/laporan dicetak lewat fitur cetak browser, jadi tampilannya mengikuti browser yang dipakai.

## Catatan soal zip asli

Zip yang menjadi dasar proyek ini berisi website panduan (tutorial), bukan aplikasinya.
Proyek ini memakai kerangka yang sama (React, Vite, Tailwind), tetapi isi panduannya
diganti dengan aplikasi yang sesungguhnya.
