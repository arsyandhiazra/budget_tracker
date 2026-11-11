// Pemilih rentang waktu: pilihan cepat + rentang tanggal sendiri.
import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { cn } from "@/utils/cn";
import { makePeriod, PRESETS, type Period } from "@/lib/period";
import { Button, Input } from "./ui";

export function PeriodPicker({ value, onChange, align = "right" }: { value: Period; onChange: (p: Period) => void; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setFrom(value.from);
    setTo(value.to);
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, value.from, value.to]);

  const valid = Boolean(from && to && from <= to);

  return (
    <div ref={root} className="no-print relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-line-strong bg-white px-3 text-sm font-semibold transition-colors hover:bg-paper"
      >
        <CalendarDays className="h-4 w-4 text-muted" aria-hidden />
        <span className="max-w-[13rem] truncate">{value.label}</span>
        <ChevronDown className={cn("h-4 w-4 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div role="dialog" aria-label="Pilih rentang waktu" className={cn("animate-pop absolute z-40 mt-2 w-72 rounded-2xl border border-line bg-white p-2 shadow-pop", align === "right" ? "right-0" : "left-0")}>
          <ul>
            {PRESETS.map((p) => (
              <li key={p.key}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(makePeriod(p.key));
                    setOpen(false);
                  }}
                  className="flex h-10 w-full items-center justify-between rounded-lg px-3 text-sm font-medium hover:bg-paper"
                >
                  {p.label}
                  {value.key === p.key && <Check className="h-4 w-4" aria-label="terpilih" />}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 border-t border-line px-3 pt-3 pb-2">
            <p className="mb-2 flex items-center justify-between text-xs font-semibold tracking-wide text-muted uppercase">
              Atur sendiri {value.key === "custom" && <Check className="h-4 w-4 text-ink" aria-label="terpilih" />}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-muted">
                Dari
                <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="mt-1 h-9 px-2 text-[13px]" />
              </label>
              <label className="text-xs text-muted">
                Sampai
                <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="mt-1 h-9 px-2 text-[13px]" />
              </label>
            </div>
            <Button
              size="sm"
              className="mt-3 w-full"
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
      )}
    </div>
  );
}
