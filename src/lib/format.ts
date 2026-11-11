// Pemformatan angka & tanggal gaya Indonesia.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const MONTHS_LONG = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

const nf = new Intl.NumberFormat("id-ID");

/** Rp 1.250.000 (minus ditulis di depan: -Rp 50.000) */
export function rp(n: number): string {
  const v = Math.round(n);
  return `${v < 0 ? "-" : ""}Rp ${nf.format(Math.abs(v))}`;
}

export const num = (n: number) => nf.format(Math.round(n));

/** Angka ringkas untuk sumbu grafik & label: 1,2 jt · 850 rb · 2,5 M */
export function compact(n: number): string {
  const v = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const fmt = (x: number, unit: string) => {
    const digits = x >= 100 ? 0 : x >= 10 ? 1 : 2;
    return `${sign}${x.toLocaleString("id-ID", { maximumFractionDigits: digits })} ${unit}`;
  };
  if (v >= 1e12) return fmt(v / 1e12, "T");
  if (v >= 1e9) return fmt(v / 1e9, "M");
  if (v >= 1e6) return fmt(v / 1e6, "jt");
  if (v >= 1e3) return fmt(v / 1e3, "rb");
  return `${sign}${nf.format(v)}`;
}

export const rpCompact = (n: number) => (Math.abs(n) >= 1e6 ? `${n < 0 ? "-" : ""}Rp ${compact(Math.abs(n))}` : rp(n));

const parts = (date: string) => date.split("-").map(Number) as [number, number, number];

/** 2026-01-05 → 5 Jan 2026 */
export function fmtDate(date?: string | null): string {
  if (!date) return "-";
  const [y, m, d] = parts(date);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** 2026-01-05 → 5 Jan */
export function fmtDay(date: string): string {
  const [, m, d] = parts(date);
  return `${d} ${MONTHS[m - 1]}`;
}

/** 2026-01 → Jan 2026 (long: Januari 2026) */
export function fmtMonth(ym: string, long = false): string {
  const [y, m] = ym.split("-").map(Number);
  return `${(long ? MONTHS_LONG : MONTHS)[m - 1]} ${y}`;
}

export const monthShort = (ym: string) => MONTHS[Number(ym.split("-")[1]) - 1];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Tanggal hari ini menurut jam di perangkat pengguna. */
export const today = () => iso(new Date());

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${pad(new Date(y, m, 0).getDate())}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = parts(date);
  return iso(new Date(y, m - 1, d + n));
}

export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = parts(a);
  const [y2, m2, d2] = parts(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** "1.250.000" / "1250000" / "Rp 1.250.000" → 1250000 */
export function parseMoney(text: string): number {
  const digits = text.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}
