// Pilihan rentang waktu ("Bulan ini", "Tahun ini", dst.) yang dipakai di banyak halaman.
import { addDays, addMonths, daysBetween, fmtDate, fmtMonth, monthEnd, today } from "./format";

export type PresetKey = "this-month" | "last-month" | "last-3-months" | "this-year" | "last-year" | "custom";

export type Period = {
  key: PresetKey;
  from: string;
  to: string;
  /** Rentang pembanding (periode sebelumnya dengan panjang yang sama). */
  pfrom: string;
  pto: string;
  label: string;
  compareLabel: string;
};

export const PRESETS: { key: Exclude<PresetKey, "custom">; label: string }[] = [
  { key: "this-month", label: "Bulan ini" },
  { key: "last-month", label: "Bulan lalu" },
  { key: "last-3-months", label: "3 bulan terakhir" },
  { key: "this-year", label: "Tahun ini" },
  { key: "last-year", label: "Tahun lalu" },
];

/** Tanggal yang "sama" di bulan lain; kalau bulannya lebih pendek, pakai hari terakhirnya. */
function sameDay(ym: string, dayOfMonth: string): string {
  const end = monthEnd(ym);
  const candidate = `${ym}-${dayOfMonth}`;
  return candidate > end ? end : candidate;
}

export function makePeriod(key: PresetKey, custom?: { from: string; to: string }): Period {
  const t = today();
  const ym = t.slice(0, 7);
  const dd = t.slice(8, 10);
  const year = Number(t.slice(0, 4));
  switch (key) {
    case "last-month": {
      const m = addMonths(ym, -1);
      const p = addMonths(ym, -2);
      return { key, from: `${m}-01`, to: monthEnd(m), pfrom: `${p}-01`, pto: monthEnd(p), label: fmtMonth(m, true), compareLabel: "bulan sebelumnya" };
    }
    case "last-3-months": {
      const start = addMonths(ym, -2);
      const pEnd = addMonths(ym, -3);
      const pStart = addMonths(ym, -5);
      // Bulan berjalan belum selesai, jadi pembandingnya juga berhenti di tanggal yang sama.
      return { key, from: `${start}-01`, to: monthEnd(ym), pfrom: `${pStart}-01`, pto: sameDay(pEnd, dd), label: `${fmtMonth(start)} – ${fmtMonth(ym)}`, compareLabel: "3 bulan sebelumnya" };
    }
    case "this-year":
      return { key, from: `${year}-01-01`, to: `${year}-12-31`, pfrom: `${year - 1}-01-01`, pto: sameDay(`${year - 1}-${t.slice(5, 7)}`, dd), label: `Tahun ${year}`, compareLabel: "periode sama tahun lalu" };
    case "last-year":
      return { key, from: `${year - 1}-01-01`, to: `${year - 1}-12-31`, pfrom: `${year - 2}-01-01`, pto: `${year - 2}-12-31`, label: `Tahun ${year - 1}`, compareLabel: "tahun sebelumnya" };
    case "custom": {
      const from = custom?.from ?? `${ym}-01`;
      const to = custom?.to ?? t;
      const len = daysBetween(from, to) + 1;
      return { key, from, to, pfrom: addDays(from, -len), pto: addDays(from, -1), label: `${fmtDate(from)} – ${fmtDate(to)}`, compareLabel: "periode sebelumnya" };
    }
    default: {
      const p = addMonths(ym, -1);
      // Contoh: 1–12 Nov dibandingkan dengan 1–12 Okt, bukan dengan Oktober penuh.
      return { key: "this-month", from: `${ym}-01`, to: monthEnd(ym), pfrom: `${p}-01`, pto: sameDay(p, dd), label: fmtMonth(ym, true), compareLabel: "periode sama bulan lalu" };
    }
  }
}
