// Membuat akun contoh berisi data 6 bulan, supaya aplikasi bisa langsung dicoba.
//   npm run demo
// Masuk dengan: demo@contoh.test / demo12345
// JANGAN dijalankan di server sungguhan: kata sandinya diketahui umum.
import { loadConfig } from "../server/config.js";
import { openDb, nowIso } from "../server/db.js";
import { hashPassword } from "../server/security.js";
import { todayIn } from "../server/http.js";
import * as acc from "../server/accounting.js";

const EMAIL = "demo@contoh.test";
const PASSWORD = "demo12345";

const config = loadConfig({ quiet: true });
if (config.production) {
  console.error("Akun contoh tidak boleh dibuat di mode production.");
  process.exit(1);
}
const db = openDb(config.dbPath);
const today = todayIn(config.timezone);

// Angka acak yang selalu sama urutannya, supaya datanya konsisten tiap dijalankan.
let seed = 20261;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (lo, hi, step = 5000) => Math.round((lo + rand() * (hi - lo)) / step) * step;
const monthAdd = (ym, n) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const day = (ym, d) => `${ym}-${String(d).padStart(2, "0")}`;

const old = db.get("SELECT id FROM users WHERE email = ?", EMAIL);
if (old) {
  db.tx(() => {
    db.run("DELETE FROM entries WHERE user_id = ?", old.id);
    db.run("DELETE FROM budgets WHERE user_id = ?", old.id);
    db.run("DELETE FROM accounts WHERE user_id = ?", old.id);
    db.run("DELETE FROM users WHERE id = ?", old.id);
  });
}

const hash = await hashPassword(PASSWORD);
const now = nowIso();
const userId = Number(db.run(
  "INSERT INTO users (email, name, password_hash, email_verified_at, business_name, usage, onboarded_at, created_at) VALUES (?,?,?,?,?,?,?,?)",
  EMAIL, "Rani Pratiwi", hash, now, "Kedai Kopi Senja", "usaha", now, now,
).lastInsertRowid);

const thisMonth = today.slice(0, 7);
const months = Array.from({ length: 6 }, (_, i) => monthAdd(thisMonth, i - 5));

db.tx(() => {
  acc.seedAccounts(db, userId, "usaha");
  const A = Object.fromEntries(acc.listAccounts(db, userId).map((a) => [a.name, a.id]));
  const add = (body) => {
    if (body.date > today) return null;
    return acc.createEntry(db, userId, { date: body.date, description: body.description, kind: body.kind, lines: acc.simpleLines(db, userId, body) });
  };
  const income = (date, amount, description, category = "Pendapatan Penjualan", wallet = "Kas") => add({ kind: "income", date, amount, description, categoryId: A[category], cashAccountId: A[wallet] });
  const expense = (date, amount, description, category, wallet = "Bank") => add({ kind: "expense", date, amount, description, categoryId: A[category], cashAccountId: A[wallet] });

  acc.createEntry(db, userId, {
    date: day(months[0], 1), description: "Saldo awal", kind: "opening",
    lines: [
      { accountId: A.Kas, debit: 3_000_000, credit: 0 },
      { accountId: A.Bank, debit: 12_000_000, credit: 0 },
      { accountId: A.Modal, debit: 0, credit: 15_000_000 },
    ],
  });

  months.forEach((ym, i) => {
    const growth = 1 + i * 0.07;
    for (const d of [3, 7, 10, 14, 17, 21, 24, 28]) {
      income(day(ym, d), between(1_500_000 * growth, 2_300_000 * growth), `Penjualan kopi & roti (${d > 15 ? "akhir" : "awal"} bulan)`, "Pendapatan Penjualan", d % 3 === 0 ? "Kas" : "Bank");
    }
    if (i % 2 === 1) income(day(ym, 19), between(1_200_000, 2_400_000), "Pesanan katering rapat", "Pendapatan Jasa", "Bank");
    for (const d of [2, 9, 16, 23]) expense(day(ym, d), between(1_150_000 * growth, 1_650_000 * growth), "Belanja biji kopi, susu, dan bahan roti", "Pembelian Barang (HPP)");
    expense(day(ym, 5), 2_000_000, "Sewa kios", "Sewa");
    expense(day(ym, 10), between(560_000, 760_000), "Tagihan listrik, air, dan wifi", "Listrik, Air & Internet");
    expense(day(ym, 12), between(250_000, 680_000), "Iklan Instagram & cetak brosur", "Pemasaran & Iklan");
    expense(day(ym, 6), between(120_000, 260_000), "Bensin antar pesanan", "Transportasi", "Kas");
    expense(day(ym, 20), between(120_000, 240_000), "Ongkos kurir", "Transportasi", "Kas");
    expense(day(ym, 15), between(180_000, 420_000), "Gelas kertas, tisu, sedotan", "Perlengkapan", "Kas");
    expense(day(ym, 8), between(90_000, 210_000), "Makan siang tim", "Makan & Minum", "Kas");
    expense(day(ym, 22), between(90_000, 190_000), "Makan siang tim", "Makan & Minum", "Kas");
    if (i % 3 === 0) expense(day(ym, 18), between(100_000, 260_000), "Nonton bareng tim", "Hiburan", "Kas");
    expense(day(ym, 27), 3_500_000, "Gaji barista & kasir", "Gaji Karyawan");
    add({ kind: "transfer", date: day(ym, 13), amount: 5_000_000, description: "Setor tunai ke bank", cashAccountId: A.Kas, toAccountId: A.Bank });
    add({ kind: "drawing", date: day(ym, 26), amount: 1_500_000, description: "Ambil untuk keperluan pribadi", cashAccountId: A.Bank });
  });

  // Utang & piutang
  const loan = acc.createDebt(db, userId, { kind: "payable", mode: "cash", amount: 10_000_000, date: day(months[0], 4), dueDate: day(monthAdd(thisMonth, 2), 4), description: "Pinjaman modal usaha", contactName: "Koperasi Maju Bersama", cashAccountId: A.Bank });
  for (let i = 1; i < months.length; i += 1) {
    const date = day(months[i], 4);
    if (date <= today) acc.payDebt(db, userId, loan, { amount: 1_500_000, date, cashAccountId: A.Bank });
  }
  const machine = acc.createDebt(db, userId, { kind: "payable", mode: "credit", amount: 6_000_000, date: day(months[1], 11), dueDate: day(months[4], 11), description: "Mesin espresso (dicicil)", contactName: "Toko Mesin Kopi Jaya", categoryId: A.Peralatan });
  acc.payDebt(db, userId, machine, { amount: 2_000_000, date: day(months[2], 11), cashAccountId: A.Bank });
  acc.payDebt(db, userId, machine, { amount: 2_000_000, date: day(months[3], 11), cashAccountId: A.Bank });
  const office = acc.createDebt(db, userId, { kind: "receivable", mode: "credit", amount: 2_400_000, date: day(months[4], 18), dueDate: day(monthAdd(thisMonth, 1), 5), description: "Katering rapat bulanan", contactName: "Kantor Notaris Wibowo", categoryId: A["Pendapatan Jasa"] });
  acc.payDebt(db, userId, office, { amount: 1_000_000, date: day(months[4], 28), cashAccountId: A.Bank });
  acc.createDebt(db, userId, { kind: "receivable", mode: "credit", amount: 850_000, date: day(months[3], 9), dueDate: day(months[4], 9), description: "Pesanan kue ulang tahun", contactName: "Bu Ratna", categoryId: A["Pendapatan Penjualan"] });

  db.run("INSERT INTO contacts (user_id, name, type, phone, note, created_at) VALUES (?,?,?,?,?,?)", userId, "Dimas", "employee", "0812-0000-1111", "Barista", now);
  db.run("INSERT INTO contacts (user_id, name, type, email, created_at) VALUES (?,?,?,?,?)", userId, "CV Sangrai Nusantara", "supplier", "pesan@sangrai.test", now);

  const budgets = { "Pembelian Barang (HPP)": 7_000_000, "Gaji Karyawan": 3_500_000, Sewa: 2_000_000, "Listrik, Air & Internet": 700_000, "Pemasaran & Iklan": 500_000, Transportasi: 400_000, "Makan & Minum": 300_000, Perlengkapan: 350_000 };
  for (const [name, amount] of Object.entries(budgets)) acc.setBudget(db, userId, A[name], amount);
});

const count = db.get("SELECT COUNT(*) AS n FROM entries WHERE user_id = ?", userId).n;
db.close();
console.log(`\nAkun contoh siap dengan ${count} catatan.\n  Email      : ${EMAIL}\n  Kata sandi : ${PASSWORD}\n\nJalankan "npm start", lalu masuk dengan akun itu.\n`);
