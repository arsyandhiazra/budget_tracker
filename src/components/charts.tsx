// Grafik buatan sendiri (SVG) supaya gampang dibaca:
// - angka sumbu dibulatkan & diringkas (2 jt, 500 rb), garis bantu tipis
// - selalu ada legenda untuk 2 seri, label angka langsung di titik penting
// - arahkan kursor / tekan Tab untuk melihat angka persisnya
// - tombol "Tabel" menampilkan data yang sama dalam bentuk tabel
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, BarChart3, CircleAlert, Minus, Table2, TriangleAlert } from "lucide-react";
import { cn } from "@/utils/cn";
import { compact, fmtDate, fmtDay, rp, rpCompact } from "@/lib/format";
import { Card } from "./ui";

// Warna grafik mengikuti tema (terang/gelap) lewat variabel CSS di index.css.
export const COLORS = { masuk: "var(--color-masuk)", keluar: "var(--color-keluar)", ink: "var(--color-ink)", grid: "var(--color-line)", axis: "var(--color-line-strong)", muted: "var(--color-muted)", band: "var(--color-paper)" };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Angka sumbu yang "bulat": 0 · 2 jt · 4 jt · 6 jt */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (max <= min) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = Math.max(1, (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag);
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; ; v += step) {
    ticks.push(Math.round(v));
    if (v >= max || ticks.length > 12) break;
  }
  return ticks;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

// ───────────── Bingkai grafik: judul, legenda, tombol tabel ─────────────

export type TableData = { columns: string[]; rows: (string | number)[][] };

export function ChartCard({ title, subtitle, legend, table, children, className }: { title: string; subtitle?: string; legend?: ReactNode; table?: TableData; children: ReactNode; className?: string }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card className={cn("flex flex-col p-5", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="font-bold tracking-tight">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-4">
          {!showTable && legend}
          {table && (
            <button
              type="button"
              onClick={() => setShowTable((v) => !v)}
              aria-pressed={showTable}
              className="no-print inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-semibold text-ink-soft transition-colors hover:bg-paper"
            >
              {showTable ? <BarChart3 className="h-3.5 w-3.5" aria-hidden /> : <Table2 className="h-3.5 w-3.5" aria-hidden />}
              {showTable ? "Grafik" : "Tabel"}
            </button>
          )}
        </div>
      </div>
      {showTable && table ? <MiniTable {...table} /> : children}
    </Card>
  );
}

function MiniTable({ columns, rows }: TableData) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line">
            {columns.map((c, i) => (
              <th key={c} scope="col" className={cn("py-2 text-xs font-semibold text-muted", i === 0 ? "text-left" : "text-right")}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-line/60 last:border-0">
              {row.map((cell, i) => (
                <td key={i} className={cn("py-2", i === 0 ? "text-left font-medium" : "tnum text-right")}>
                  {typeof cell === "number" ? rp(cell) : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-soft">
      {items.map((i) => (
        <li key={i.name} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: i.color }} aria-hidden />
          {i.name}
        </li>
      ))}
    </ul>
  );
}

function Tip({ x, side, top, width, title, rows }: { x: number; side: "left" | "right"; top: number; width: number; title: string; rows: { name: string; value: string; color?: string }[] }) {
  const W = 216;
  const left = side === "right" ? clamp(x, 0, width - W) : clamp(x - W, 0, width - W);
  return (
    <div className="pointer-events-none absolute z-10 rounded-xl bg-ink px-3 py-2 text-white shadow-pop" style={{ left, top, width: W }} role="presentation">
      <p className="mb-1 text-[11px] font-medium text-white/70">{title}</p>
      {rows.map((r) => (
        <p key={r.name} className="flex items-center justify-between gap-3 text-xs leading-5">
          <span className="flex items-center gap-1.5 whitespace-nowrap text-white/80">
            {r.color && <span className="h-0.5 w-3 rounded-full" style={{ background: r.color }} aria-hidden />}
            {r.name}
          </span>
          <span className="tnum font-bold whitespace-nowrap">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

// ───────────── Grafik batang berkelompok ─────────────

const barPath = (x: number, y: number, w: number, h: number) => {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

export function ColumnChart({ categories, series, height = 264, ariaLabel }: {
  categories: { label: string; full: string }[];
  series: { name: string; color: string; values: number[] }[];
  height?: number;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const m = { top: 24, right: 8, bottom: 28, left: 48 };
  const ticks = niceTicks(0, Math.max(1, ...series.flatMap((s) => s.values)));
  const top = ticks[ticks.length - 1];
  const iw = Math.max(0, width - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const band = categories.length ? iw / categories.length : iw;
  const n = series.length;
  const gap = 2;
  const barW = clamp((band * 0.62 - gap * (n - 1)) / n, 3, 24);
  const groupW = barW * n + gap * (n - 1);
  const y = (v: number) => m.top + ih - (Math.max(v, 0) / top) * ih;
  const last = categories.length - 1;
  const showLabels = band >= 84;

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="group" aria-label={ariaLabel} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? COLORS.axis : COLORS.grid} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tnum fill-muted text-[11px]">
                {compact(t)}
              </text>
            </g>
          ))}
          {categories.map((c, i) => {
            const x0 = m.left + i * band;
            const gx = x0 + (band - groupW) / 2;
            const dim = active !== null && active !== i;
            return (
              <g key={c.full}>
                {active === i && <rect x={x0 + 2} y={m.top - 6} width={Math.max(0, band - 4)} height={ih + 6} rx={8} fill={COLORS.band} />}
                {series.map((s, k) => {
                  const v = s.values[i] ?? 0;
                  const h = m.top + ih - y(v);
                  const bx = gx + k * (barW + gap);
                  return (
                    <g key={s.name} opacity={dim ? 0.45 : 1} style={{ transition: "opacity .12s" }}>
                      {h > 0 && <path d={barPath(bx, y(v), barW, h)} fill={s.color} />}
                      {showLabels && i === last && v > 0 && n <= 2 && (
                        <text
                          x={n === 1 ? bx + barW / 2 : k === 0 ? gx + groupW / 2 - 4 : gx + groupW / 2 + 4}
                          y={y(v) - 7}
                          textAnchor={n === 1 ? "middle" : k === 0 ? "end" : "start"}
                          className="tnum fill-ink text-[11px] font-semibold"
                        >
                          {compact(v)}
                        </text>
                      )}
                    </g>
                  );
                })}
                <text x={x0 + band / 2} y={height - 8} textAnchor="middle" className={cn("text-[12px]", active === i ? "fill-ink font-semibold" : "fill-muted")}>
                  {c.label}
                </text>
                {/* Area sentuh selebar kolom: lebih besar dari batangnya supaya mudah diarahkan */}
                <rect
                  x={x0}
                  y={m.top - 6}
                  width={band}
                  height={ih + m.bottom + 6}
                  fill="transparent"
                  tabIndex={0}
                  role="img"
                  aria-label={`${c.full}: ${series.map((s) => `${s.name} ${rp(s.values[i] ?? 0)}`).join(", ")}`}
                  className="outline-none focus-visible:stroke-ink focus-visible:[stroke-width:2]"
                  onPointerEnter={() => setActive(i)}
                  onPointerMove={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {active !== null && width > 0 && (
        <Tip
          width={width}
          top={m.top}
          side={active < categories.length / 2 ? "right" : "left"}
          x={m.left + (active < categories.length / 2 ? (active + 1) * band + 4 : active * band - 4)}
          title={categories[active].full}
          rows={series.map((s) => ({ name: s.name, value: rp(s.values[active] ?? 0), color: s.color }))}
        />
      )}
    </div>
  );
}

// ───────────── Grafik garis (tren) ─────────────

export function LineChart({ points, height = 232, ariaLabel, name }: { points: { date: string; value: number }[]; height?: number; ariaLabel: string; name: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const m = { top: 16, right: 78, bottom: 28, left: 48 };
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const fromZero = lo >= 0 && lo <= hi * 0.6;
  const ticks = niceTicks(fromZero ? 0 : lo, hi === lo ? lo + 1 : hi);
  const [d0, d1] = [ticks[0], ticks[ticks.length - 1]];
  const iw = Math.max(0, width - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const n = points.length;
  const x = (i: number) => m.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => m.top + ih - ((v - d0) / (d1 - d0)) * ih;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const baseline = d0 <= 0 && d1 >= 0 ? y(0) : null;

  const tickCount = clamp(Math.floor(iw / 84), 2, 6);
  const xTicks = n <= tickCount ? points.map((_, i) => i) : Array.from({ length: tickCount }, (_, k) => Math.round((k / (tickCount - 1)) * (n - 1)));

  const pick = (clientX: number, rect: DOMRect) => {
    if (n <= 1) return 0;
    return clamp(Math.round(((clientX - rect.left - m.left) / iw) * (n - 1)), 0, n - 1);
  };
  const end = n - 1;

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && n > 0 && (
        <svg width={width} height={height} className="block overflow-visible" role="img" aria-label={ariaLabel}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? COLORS.axis : COLORS.grid} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tnum fill-muted text-[11px]">
                {compact(t)}
              </text>
            </g>
          ))}
          {[...new Set(xTicks)].map((i) => (
            <text key={i} x={x(i)} y={height - 8} textAnchor={i === 0 && n > 1 ? "start" : i === end && n > 1 ? "end" : "middle"} className="fill-muted text-[12px]">
              {fmtDay(points[i].date)}
            </text>
          ))}
          {/* Bidang tipis di bawah garis hanya dipakai kalau sumbu mulai dari nol */}
          {baseline !== null && n > 1 && <path d={`${line}L${x(end).toFixed(1)},${baseline}L${x(0).toFixed(1)},${baseline}Z`} fill={COLORS.ink} opacity={0.07} />}
          {n > 1 && <path d={line} fill="none" stroke={COLORS.ink} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {active !== null && <line x1={x(active)} x2={x(active)} y1={m.top} y2={m.top + ih} stroke={COLORS.muted} strokeWidth={1} shapeRendering="crispEdges" />}
          <circle cx={x(end)} cy={y(points[end].value)} r={4.5} fill={COLORS.ink} stroke="var(--color-white)" strokeWidth={2} />
          <text x={x(end) + 10} y={y(points[end].value)} dy="0.32em" className="tnum fill-ink text-[12px] font-semibold">
            {rpCompact(points[end].value)}
          </text>
          {active !== null && active !== end && <circle cx={x(active)} cy={y(points[active].value)} r={4.5} fill={COLORS.ink} stroke="var(--color-white)" strokeWidth={2} />}
          <rect
            x={m.left - 6}
            y={m.top}
            width={iw + 12}
            height={ih + m.bottom}
            fill="transparent"
            tabIndex={0}
            aria-label={`${ariaLabel}. Tekan panah kiri atau kanan untuk membaca tiap tanggal.`}
            className="outline-none focus-visible:stroke-ink focus-visible:[stroke-width:2]"
            onPointerMove={(e) => setActive(pick(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect()))}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive((a) => a ?? end)}
            onBlur={() => setActive(null)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              setActive((a) => clamp((a ?? end) + (e.key === "ArrowLeft" ? -1 : 1), 0, end));
            }}
          />
        </svg>
      )}
      {active !== null && width > 0 && n > 0 && (
        <Tip width={width} top={m.top} side={x(active) < width / 2 ? "right" : "left"} x={x(active) + (x(active) < width / 2 ? 12 : -12)} title={fmtDate(points[active].date)} rows={[{ name, value: rp(points[active].value) }]} />
      )}
      {active !== null && <span className="sr-only" aria-live="polite">{`${fmtDate(points[active].date)}: ${rp(points[active].value)}`}</span>}
    </div>
  );
}

// ───────────── Batang peringkat (mis. pengeluaran per kategori) ─────────────

export function RankedBars({ items, total, maxRows = 6, colorClass = "bg-keluar" }: { items: { name: string; amount: number }[]; total: number; maxRows?: number; colorClass?: string }) {
  const rows = items.slice(0, maxRows).map((i) => ({ ...i, other: false }));
  const rest = items.slice(maxRows);
  if (rest.length) rows.push({ name: `${rest.length} kategori lainnya`, amount: rest.reduce((s, i) => s + i.amount, 0), other: true });
  const top = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <ul className="space-y-3.5">
      {rows.map((r) => {
        const share = total > 0 ? Math.round((r.amount / total) * 100) : 0;
        return (
          <li key={r.name} title={`${r.name}: ${rp(r.amount)} (${share}% dari total)`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[9.5rem_minmax(0,1fr)_auto]">
            <span className="truncate text-sm font-medium">{r.name}</span>
            <span className="order-3 col-span-2 block border-l border-line-strong sm:order-none sm:col-span-1">
              <span className={cn("block h-3 min-w-[3px] rounded-r-[4px]", r.other ? "bg-line-strong" : colorClass)} style={{ width: `${(r.amount / top) * 100}%` }} />
            </span>
            <span className="tnum text-right text-sm whitespace-nowrap">
              <span className="font-semibold">{rp(r.amount)}</span>
              <span className="ml-2 inline-block w-9 text-muted">{share}%</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ───────────── Meteran anggaran ─────────────

export type BudgetTone = "ok" | "warn" | "over";
export const budgetTone = (spent: number, budget: number): BudgetTone => (spent > budget ? "over" : spent >= budget * 0.8 ? "warn" : "ok");

const METER = {
  ok: { fill: "bg-ink", track: "bg-line" },
  warn: { fill: "bg-warn-fill", track: "bg-warn-soft" },
  over: { fill: "bg-bad-fill", track: "bg-bad-soft" },
};

export function Meter({ value, max, tone = "ok", label }: { value: number; max: number; tone?: BudgetTone; label: string }) {
  const pct = max > 0 ? clamp((value / max) * 100, 0, 100) : 0;
  return (
    <div className={cn("h-2 overflow-hidden rounded-full", METER[tone].track)} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)} aria-valuetext={`${rp(value)} dari ${rp(max)}`}>
      <div className={cn("h-full rounded-full transition-[width] duration-300", METER[tone].fill)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function BudgetStatusLabel({ spent, budget }: { spent: number; budget: number }) {
  const tone = budgetTone(spent, budget);
  if (tone === "over") {
    return (
      <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-bad">
        <CircleAlert className="h-3.5 w-3.5" aria-hidden /> Lewat {rp(spent - budget)}
      </span>
    );
  }
  if (tone === "warn") {
    return (
      <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-warn">
        <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> {spent === budget ? "Pas di batas, sudah habis" : `Hampir habis, sisa ${rp(budget - spent)}`}
      </span>
    );
  }
  return <span className="text-[13px] text-muted">Sisa {rp(budget - spent)}</span>;
}

export function BudgetRow({ name, spent, budget }: { name: string; spent: number; budget: number }) {
  return (
    <li>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="tnum text-[13px] whitespace-nowrap text-muted">
          <span className="font-semibold text-ink">{rp(spent)}</span> dari {rp(budget)}
        </span>
      </div>
      <Meter value={spent} max={budget} tone={budgetTone(spent, budget)} label={`Anggaran ${name}`} />
      <div className="mt-1.5">
        <BudgetStatusLabel spent={spent} budget={budget} />
      </div>
    </li>
  );
}

// ───────────── Perubahan dibanding periode sebelumnya ─────────────

export function Delta({ now, before, goodWhenUp, label }: { now: number; before: number | null | undefined; goodWhenUp: boolean; label: string }) {
  if (before === null || before === undefined) return null;
  if (before === 0) return <p className="mt-1 text-[13px] text-muted">{now === 0 ? `Sama dengan ${label}` : `Belum ada angka di ${label}`}</p>;
  const diff = now - before;
  const pct = Math.round((Math.abs(diff) / Math.abs(before)) * 100);
  if (diff === 0 || pct === 0) {
    return (
      <p className="mt-1 flex items-center gap-1 text-[13px] text-muted">
        <Minus className="h-3.5 w-3.5" aria-hidden /> Hampir sama dengan {label}
      </p>
    );
  }
  const up = diff > 0;
  const good = up === goodWhenUp;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <p className={cn("mt-1 flex items-center gap-1 text-[13px] font-medium", good ? "text-good" : "text-bad")}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        {up ? "Naik" : "Turun"} {pct > 999 ? ">999" : pct}% <span className="font-normal text-muted">dari {label}</span>
      </span>
    </p>
  );
}
