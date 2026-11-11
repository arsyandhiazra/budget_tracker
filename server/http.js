// Alat bantu kecil untuk membalas error dan memeriksa data yang masuk.

export class HttpError extends Error {
  constructor(status, message, code = 'ERROR', extra = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const bad = (message, code = 'INVALID') => new HttpError(400, message, code);
export const notFound = (message = 'Data tidak ditemukan.') => new HttpError(404, message, 'NOT_FOUND');

export const MAX_AMOUNT = 1_000_000_000_000_000; // 1 kuadriliun rupiah, batas aman hitungan

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export const v = {
  str(value, label, { min = 1, max = 200, optional = false } = {}) {
    if (value === undefined || value === null || value === '') {
      if (optional) return null;
      throw bad(`${label} wajib diisi.`);
    }
    if (typeof value !== 'string') throw bad(`${label} tidak valid.`);
    const text = value.trim();
    if (!text && optional) return null;
    if (text.length < min) throw bad(min <= 1 ? `${label} wajib diisi.` : `${label} minimal ${min} karakter.`);
    if (text.length > max) throw bad(`${label} maksimal ${max} karakter.`);
    return text;
  },
  email(value) {
    const text = v.str(value, 'Email', { max: 254 }).toLowerCase();
    if (!EMAIL_RE.test(text)) throw bad('Format email belum benar. Contoh: nama@email.com');
    return text;
  },
  password(value, label = 'Kata sandi') {
    if (typeof value !== 'string' || value.length < 8) throw bad(`${label} minimal 8 karakter.`);
    if (value.length > 200) throw bad(`${label} terlalu panjang.`);
    return value;
  },
  amount(value, label = 'Jumlah', { allowZero = false } = {}) {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
      throw bad(`${label} harus berupa angka bulat (tanpa koma).`);
    }
    if (n < 0 || (!allowZero && n === 0)) throw bad(`${label} harus lebih dari 0.`);
    if (n > MAX_AMOUNT) throw bad(`${label} terlalu besar.`);
    return n;
  },
  date(value, label = 'Tanggal', { optional = false } = {}) {
    if ((value === undefined || value === null || value === '') && optional) return null;
    if (!isDate(value)) throw bad(`${label} tidak valid.`);
    return value;
  },
  id(value, label = 'ID', { optional = false } = {}) {
    if ((value === undefined || value === null || value === '') && optional) return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) throw bad(`${label} tidak valid.`);
    return n;
  },
  oneOf(value, list, label) {
    if (!list.includes(value)) throw bad(`${label} tidak valid.`);
    return value;
  },
};

// Rentang tanggal dari query (?from=...&to=...). Kalau kosong berarti "semua".
export function range(query) {
  const from = query.from ? v.date(query.from, 'Tanggal awal') : '0000-01-01';
  const to = query.to ? v.date(query.to, 'Tanggal akhir') : '9999-12-31';
  if (from > to) throw bad('Tanggal awal tidak boleh setelah tanggal akhir.');
  return { from, to };
}

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Tanggal hari ini (YYYY-MM-DD) menurut zona waktu tertentu.
export function todayIn(timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
