// Pemilih rentang waktu: pilihan cepat + rentang tanggal sendiri.
// Di layar lebar tampil sebagai dropdown di bawah tombol. Di layar HP (potret) tampil sebagai
// lembar dari bawah yang selalu selebar layar, jadi tidak pernah terpotong di sisi kiri/kanan
// dan tombol "Terapkan" tetap terjangkau ibu jari.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { makePeriod, PRESETS, type Period } from "@/lib/period";
import { Button, Input } from "./ui";

const WIDE = "(min-width: 640px)";
const PANEL_WIDTH = 288; // sama dengan sm:w-72

/** true di layar selebar tablet/desktop; false di HP. Mengikuti rotasi layar. */
function useWide() {
  const [wide, setWide] = useState(() => (typeof window === "undefined" || !window.matchMedia ? true : window.matchMedia(WIDE).matches));
  useEffect(() => {
    const query = window.matchMedia(WIDE);
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return wide;
}

export function PeriodPicker({ value, onChange, align = "right" }: { value: Period; onChange: (p: Period) => void; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  const wide = useWide();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState<number | null>(null);

  // Layar lebar: dropdown dipasang rata kanan/kiri tombol, lalu digeser seperlunya supaya tidak keluar dari layar
  // (misalnya tombol ada di sisi kiri halaman tetapi panelnya ingin rata kanan).
  useLayoutEffect(() => {
    if (!open || !wide || !root.current) return;
    const rect = root.current.getBoundingClientRect();
    const viewport = document.documentElement.clientWidth;
    const wanted = align === "right" ? rect.right - PANEL_WIDTH : rect.left;
    setLeft(Math.min(Math.max(wanted, 8), viewport - PANEL_WIDTH - 8) - rect.left);
  }, [open, wide, align]);

  useEffect(() => {
    if (!open) return;
    setFrom(value.from);
    setTo(value.to);
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!root.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, value.from, value.to]);

  // Di HP, halaman di belakang lembar tidak ikut tergulir.
  useEffect(() => {
    if (!open || wide) return;
    const body = document.body;
    const overflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = overflow;
    };
  }, [open, wide]);

  const valid = Boolean(from && to && from <= to);

  const sheet = (
    <div
      ref={panel}
      role="dialog"
      aria-modal={!wide}
      aria-label="Pilih rentang waktu"
      tabIndex={-1}
      style={wide && left !== null ? { left, right: "auto" } : undefined}
      className={cn(
        "animate-pop border border-line bg-white shadow-pop outline-none",
        // HP: lembar penuh lebar di dasar layar.
        "fixed inset-x-0 bottom-0 z-50 max-h-sheet overflow-y-auto overscroll-contain rounded-t-3xl border-b-0 p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]",
        // Layar lebar: dropdown di bawah tombol.
        "sm:absolute sm:inset-x-auto sm:bottom-auto sm:z-40 sm:mt-2 sm:max-h-none sm:w-72 sm:overflow-visible sm:rounded-2xl sm:border-b sm:p-2",
        align === "right" ? "sm:right-0" : "sm:left-0",
      )}
    >
      <div className="mb-2 flex items-center justify-between sm:hidden">
        <h2 className="text-base font-bold tracking-tight">Rentang waktu</h2>
        <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Tutup" className="-mr-2">
          <X className="h-5 w-5" aria-hidden />
        </Button>
      </div>
      <ul>
        {PRESETS.map((p) => (
          <li key={p.key}>
            <button
              type="button"
              onClick={() => {
                onChange(makePeriod(p.key));
                setOpen(false);
              }}
              className="flex h-11 w-full items-center justify-between rounded-lg px-3 text-sm font-medium hover:bg-paper sm:h-10"
            >
              {p.label}
              {value.key === p.key && <Check className="h-4 w-4" aria-label="terpilih" />}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 border-t border-line px-3 pt-3 pb-2 sm:pb-2">
        <p className="mb-2 flex items-center justify-between text-xs font-semibold tracking-wide text-muted uppercase">
          Atur sendiri {value.key === "custom" && <Check className="h-4 w-4 text-ink" aria-label="terpilih" />}
        </p>
        <div className="grid grid-cols-1 gap-2 min-[340px]:grid-cols-2">
          <label className="block min-w-0 text-xs text-muted">
            Dari
            <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="mt-1 h-11 min-w-0 px-2 text-[13px] sm:h-9" />
          </label>
          <label className="block min-w-0 text-xs text-muted">
            Sampai
            <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="mt-1 h-11 min-w-0 px-2 text-[13px] sm:h-9" />
          </label>
        </div>
        {from && to && from > to && <p className="mt-2 text-xs text-bad">Tanggal “Dari” harus sebelum atau sama dengan “Sampai”.</p>}
        <Button
          size="sm"
          className="mt-3 h-11 w-full sm:h-9"
          disabled={!valid}
          onClick={() => {
            onChange(makePeriod("custom", { from, to }));
            setOpen(false);
          }}
        >
          Terapkan
        </Button>
      </div>
    </div>
  );

  return (
    <div ref={root} className="no-print relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex h-10 max-w-full items-center gap-2 rounded-xl border border-line-strong bg-white px-3 text-sm font-semibold transition-colors hover:bg-paper"
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 truncate sm:max-w-[13rem]">{value.label}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open &&
        (wide ? (
          sheet
        ) : (
          // Dipasang di <body> supaya tidak terjebak di dalam elemen induk yang punya blur/transform.
          createPortal(
            <div className="no-print">
              <div className="animate-fade fixed inset-0 z-50 bg-scrim" onClick={() => setOpen(false)} aria-hidden />
              {sheet}
            </div>,
            document.body,
          )
        ))}
    </div>
  );
}
