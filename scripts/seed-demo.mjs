// Membuat akun contoh berisi data 6 bulan, supaya aplikasi bisa langsung dicoba.
//   npm run demo
// Masuk dengan: demo@contoh.test / demo12345
// JANGAN dijalankan di server sungguhan: kata sandinya diketahui umum.
import { loadConfig } from "../server/config.js";
import { openDbFromConfig, nowIso } from "../server/db.js";
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
const db = await openDbFromConfig(config);
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

const old = await db.get("SELECT id FROM users WHERE email = ?", EMAIL);
if (old) {
  await db.tx(async () => {
    await db.run("DELETE FROM entries WHERE user_id = ?", old.id);
    await db.run("DELETE FROM budgets WHERE user_id = ?", old.id);
    await db.run("DELETE FROM accounts WHERE user_id = ?", old.id);
    await db.run("DELETE FROM users WHERE id = ?", old.id);
  });
}

const hash = await hashPassword(PASSWORD);
const now = nowIso();
const userId = await db.insert(
  "INSERT INTO users (email, name, password_hash, email_verified_at, business_name, usage, onboarded_at, created_at) VALUES (?,?,?,?,?,?,?,?)",
  EMAIL, "Rani Pratiwi", hash, now, "Kedai Kopi Senja", "usaha", now, now,
);

const thisMonth = today.slice(0, 7);
const months = Array.from({ length: 6 }, (_, i) => monthAdd(thisMonth, i - 5));

await db.tx(async () => {
  await acc.seedAccounts(db, userId, "usaha");
  const A = Object.fromEntries((await acc.listAccounts(db, userId)).map((a) => [a.name, a.id]));
  const add = async (body) => {
    if (body.date > today) return null;
    return acc.createEntry(db, userId, { date: body.date, description: body.description, kind: body.kind, lines: await acc.simpleLines(db, userId, body) });
  };
  const income = (date, amount, description, category = "Pendapatan Penjualan", wallet = "Kas") => add({ kind: "income", date, amount, description, categoryId: A[category], cashAccountId: A[wallet] });
  const expense = (date, amount, description, category, wallet = "Bank") => add({ kind: "expense", date, amount, description, categoryId: A[category], cashAccountId: A[wallet] });

  await acc.createEntry(db, userId, {
    date: day(months[0], 1), description: "Saldo awal", kind: "opening",
    lines: [
      { accountId: A.Kas, debit: 3_000_000, credit: 0 },
      { accountId: A.Bank, debit: 12_000_000, credit: 0 },
      { accountId: A.Modal, debit: 0, credit: 15_000_000 },
    ],
  });

  for (const [i, ym] of months.entries()) {
    const growth = 1 + i * 0.07;
    for (const d of [3, 7, 10, 14, 17, 21, 24, 28]) {
      await income(day(ym, d), between(1_500_000 * growth, 2_300_000 * growth), `Penjualan kopi & roti (${d > 15 ? "akhir" : "awal"} bulan)`, "Pendapatan Penjualan", d % 3 === 0 ? "Kas" : "Bank");
    }
    if (i % 2 === 1) await income(day(ym, 19), between(1_200_000, 2_400_000), "Pesanan katering rapat", "Pendapatan Jasa", "Bank");
    for (const d of [2, 9, 16, 23]) expense(day(ym, d), between(1_150_000 * growth, 1_650_000 * growth), "Belanja biji kopi, susu, dan bahan roti", "Pembelian Barang (HPP)");
    await expense(day(ym, 5), 2_000_000, "Sewa kios", "Sewa");
    await expense(day(ym, 10), between(560_000, 760_000), "Tagihan listrik, air, dan wifi", "Listrik, Air & Internet");
    await expense(day(ym, 12), between(250_000, 680_000), "Iklan Instagram & cetak brosur", "Pemasaran & Iklan");
    await expense(day(ym, 6), between(120_000, 260_000), "Bensin antar pesanan", "Transportasi", "Kas");
    await expense(day(ym, 20), between(120_000, 240_000), "Ongkos kurir", "Transportasi", "Kas");
    await expense(day(ym, 15), between(180_000, 420_000), "Gelas kertas, tisu, sedotan", "Perlengkapan", "Kas");
    await expense(day(ym, 8), between(90_000, 210_000), "Makan siang tim", "Makan & Minum", "Kas");
    await expense(day(ym, 22), between(90_000, 190_000), "Makan siang tim", "Makan & Minum", "Kas");
    if (i % 3 === 0) await expense(day(ym, 18), between(100_000, 260_000), "Nonton bareng tim", "Hiburan", "Kas");
    await expense(day(ym, 27), 3_500_000, "Gaji barista & kasir", "Gaji Karyawan");
    await add({ kind: "transfer", date: day(ym, 13), amount: 5_000_000, description: "Setor tunai ke bank", cashAccountId: A.Kas, toAccountId: A.Bank });
    await add({ kind: "drawing", date: day(ym, 26), amount: 1_500_000, description: "Ambil untuk keperluan pribadi", cashAccountId: A.Bank });
  }

  // Utang & piutang
  const loan = await acc.createDebt(db, userId, { kind: "payable", mode: "cash", amount: 10_000_000, date: day(months[0], 4), dueDate: day(monthAdd(thisMonth, 2), 4), description: "Pinjaman modal usaha", contactName: "Koperasi Maju Bersama", cashAccountId: A.Bank });
  for (let i = 1; i < months.length; i += 1) {
    const date = day(months[i], 4);
    if (date <= today) await acc.payDebt(db, userId, loan, { amount: 1_500_000, date, cashAccountId: A.Bank });
  }
  const machine = await acc.createDebt(db, userId, { kind: "payable", mode: "credit", amount: 6_000_000, date: day(months[1], 11), dueDate: day(months[4], 11), description: "Mesin espresso (dicicil)", contactName: "Toko Mesin Kopi Jaya", categoryId: A.Peralatan });
  await acc.payDebt(db, userId, machine, { amount: 2_000_000, date: day(months[2], 11), cashAccountId: A.Bank });
  await acc.payDebt(db, userId, machine, { amount: 2_000_000, date: day(months[3], 11), cashAccountId: A.Bank });
  const office = await acc.createDebt(db, userId, { kind: "receivable", mode: "credit", amount: 2_400_000, date: day(months[4], 18), dueDate: day(monthAdd(thisMonth, 1), 5), description: "Katering rapat bulanan", contactName: "Kantor Notaris Wibowo", categoryId: A["Pendapatan Jasa"] });
  await acc.payDebt(db, userId, office, { amount: 1_000_000, date: day(months[4], 28), cashAccountId: A.Bank });
  await acc.createDebt(db, userId, { kind: "receivable", mode: "credit", amount: 850_000, date: day(months[3], 9), dueDate: day(months[4], 9), description: "Pesanan kue ulang tahun", contactName: "Bu Ratna", categoryId: A["Pendapatan Penjualan"] });

  await db.run("INSERT INTO contacts (user_id, name, type, phone, note, created_at) VALUES (?,?,?,?,?,?)", userId, "Dimas", "employee", "0812-0000-1111", "Barista", now);
  await db.run("INSERT INTO contacts (user_id, name, type, email, created_at) VALUES (?,?,?,?,?)", userId, "CV Sangrai Nusantara", "supplier", "pesan@sangrai.test", now);

  const budgets = { "Pembelian Barang (HPP)": 7_000_000, "Gaji Karyawan": 3_500_000, Sewa: 2_000_000, "Listrik, Air & Internet": 700_000, "Pemasaran & Iklan": 500_000, Transportasi: 400_000, "Makan & Minum": 300_000, Perlengkapan: 350_000 };
  for (const [name, amount] of Object.entries(budgets)) await acc.setBudget(db, userId, A[name], amount);
});

const count = (await db.get("SELECT COUNT(*) AS n FROM entries WHERE user_id = ?", userId)).n;
await db.close();
console.log(`\nAkun contoh siap dengan ${count} catatan.\n  Email      : ${EMAIL}\n  Kata sandi : ${PASSWORD}\n\nJalankan "npm start", lalu masuk dengan akun itu.\n`);
