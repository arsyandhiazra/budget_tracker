// Halaman Laporan: laba rugi, neraca, arus kas, perubahan modal, neraca saldo,
// buku besar, jurnal umum, dan utang piutang. Bisa diunduh ke Excel atau dicetak/PDF.
import { useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, FileSpreadsheet, Printer } from "lucide-react";
import { cn } from "@/utils/cn";
import { download, errorMessage, qs, useData } from "@/lib/api";
import { fmtDate, rp, today } from "@/lib/format";
import { makePeriod, type Period } from "@/lib/period";
import type { Account, Debt, Entry, User } from "@/lib/types";
import { Page } from "@/components/Layout";
import { PeriodPicker } from "@/components/PeriodPicker";
import { Badge, Button, Card, DataState, Empty, PageHeader, Select, useFeedback } from "@/components/ui";

type ReportDef = { slug: string; api: string; title: string; about: string; time: "range" | "asof" | "today" };

const REPORTS: ReportDef[] = [
  { slug: "laba-rugi", api: "income-statement", title: "Laba Rugi", about: "Membandingkan pendapatan dengan beban. Hasil akhirnya menunjukkan untung atau rugi pada periode ini.", time: "range" },
  { slug: "neraca", api: "balance-sheet", title: "Neraca", about: "Potret kekayaan pada satu tanggal: apa yang dimiliki (aset), berapa utangnya (kewajiban), dan sisanya milik sendiri (modal).", time: "asof" },
  { slug: "arus-kas", api: "cash-flow", title: "Arus Kas", about: "Menjelaskan dari mana uang datang dan ke mana uang pergi, sehingga saldo kas berubah dari awal ke akhir periode.", time: "range" },
  { slug: "perubahan-modal", api: "equity", title: "Perubahan Modal", about: "Menunjukkan bagaimana modal pemilik bertambah atau berkurang: dari setoran, laba, dan pengambilan pribadi.", time: "range" },
  { slug: "neraca-saldo", api: "trial-balance", title: "Neraca Saldo", about: "Daftar saldo semua akun. Total kolom debit dan kredit harus sama; kalau sama berarti pembukuan seimbang.", time: "asof" },
  { slug: "buku-besar", api: "ledger", title: "Buku Besar", about: "Riwayat keluar-masuk tiap akun satu per satu, lengkap dengan saldo berjalan.", time: "range" },
  { slug: "jurnal-umum", api: "journal", title: "Jurnal Umum", about: "Semua catatan secara berurutan dalam bentuk debit dan kredit.", time: "range" },
  { slug: "utang-piutang", api: "debts", title: "Utang Piutang", about: "Daftar utang dan piutang yang belum lunas per hari ini.", time: "today" },
];

// ───────────── Potongan tabel laporan ─────────────

const money = (n: number) => (n < 0 ? `(${rp(-n)})` : rp(n));

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <tbody>
      <tr>
        <th colSpan={2} scope="colgroup" className="pt-5 pb-1.5 text-left text-xs font-bold tracking-wide text-muted uppercase">
          {title}
        </th>
      </tr>
      {children}
    </tbody>
  );
}

function Row({ label, amount, code, bold, total, indent }: { label: string; amount: number | null; code?: string; bold?: boolean; total?: boolean; indent?: boolean }) {
  return (
    <tr className={cn(total && "border-t border-line-strong")}>
      <td className={cn("py-1.5 pr-4 text-sm", indent && "pl-4", (bold || total) && "font-bold")}>
        {code && <span className="tnum text-muted">{code} </span>}
        {label}
      </td>
      <td className={cn("tnum py-1.5 text-right text-sm whitespace-nowrap", (bold || total) && "font-bold")}>{amount === null ? "" : money(amount)}</td>
    </tr>
  );
}

function GrandTotal({ label, amount }: { label: string; amount: number }) {
  return (
    <tbody>
      <tr className="border-t-2 border-ink">
        <td className="pt-3 pb-1 text-base font-extrabold">{label}</td>
        <td className="tnum pt-3 pb-1 text-right text-base font-extrabold whitespace-nowrap">{money(amount)}</td>
      </tr>
    </tbody>
  );
}

function Check({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <p className={cn("mt-5 flex items-center gap-1.5 text-[13px] font-semibold", ok ? "text-good" : "text-bad")}>
      {ok ? <CircleCheck className="h-4 w-4" aria-hidden /> : <CircleAlert className="h-4 w-4" aria-hidden />}
      {ok ? okText : badText}
    </p>
  );
}

type Item = { id: number | null; code: string; name: string; amount: number };

// ───────────── Isi tiap laporan ─────────────

function IncomeStatement({ r }: { r: any }) {
  const sections = (r.sections as { key: string; label: string; items: Item[]; total: number }[]).filter((s) => s.items.length);
  if (!sections.length) return <Empty title="Belum ada pendapatan atau beban pada periode ini" />;
  return (
    <table className="w-full">
      {sections.map((s) => (
        <Section key={s.key} title={s.label}>
          {s.items.map((i) => (
            <Row key={i.id} code={i.code} label={i.name} amount={i.amount} indent />
          ))}
          <Row label={`Total ${s.label.toLowerCase()}`} amount={s.total} total />
        </Section>
      ))}
      <tbody>
        <tr>
          <td colSpan={2} className="h-4" />
        </tr>
        <Row label="Total pendapatan" amount={r.totalIncome} bold />
        <Row label="Total beban" amount={r.totalExpense} bold />
      </tbody>
      <GrandTotal label={r.net >= 0 ? "Laba bersih" : "Rugi bersih"} amount={r.net} />
    </table>
  );
}

function BalanceSheet({ r }: { r: any }) {
  const list = (items: Item[]) => items.map((i, k) => <Row key={i.id ?? `x${k}`} code={i.code} label={i.name} amount={i.amount} indent />);
  return (
    <>
      <div className="grid grid-cols-1 gap-x-12 gap-y-6 md:grid-cols-2">
        <table className="w-full self-start">
          <Section title="Aset lancar">
            {list(r.assets.current)}
            <Row label="Total aset lancar" amount={r.assets.totalCurrent} total />
          </Section>
          {r.assets.fixed.length > 0 && (
            <Section title="Aset tetap">
              {list(r.assets.fixed)}
              <Row label="Total aset tetap" amount={r.assets.totalFixed} total />
            </Section>
          )}
          <GrandTotal label="Total aset" amount={r.assets.total} />
        </table>
        <table className="w-full self-start">
          <Section title="Kewajiban (utang)">
            {r.liabilities.items.length ? list(r.liabilities.items) : <Row label="Tidak ada" amount={null} indent />}
            <Row label="Total kewajiban" amount={r.liabilities.total} total />
          </Section>
          <Section title="Modal">
            {list(r.equity.items)}
            <Row label="Total modal" amount={r.equity.total} total />
          </Section>
          <GrandTotal label="Total kewajiban + modal" amount={r.totalLiabilitiesAndEquity} />
        </table>
      </div>
      <Check ok={r.balanced} okText="Seimbang: total aset sama dengan kewajiban + modal." badText="Tidak seimbang. Periksa jurnal manual yang baru dibuat." />
    </>
  );
}

function CashFlow({ r }: { r: any }) {
  return (
    <>
      <table className="w-full">
        {(r.sections as { key: string; label: string; items: Item[]; total: number }[]).map((s) => (
          <Section key={s.key} title={s.label}>
            {s.items.length ? s.items.map((i) => <Row key={i.id} code={i.code} label={i.name} amount={i.amount} indent />) : <Row label="Tidak ada" amount={null} indent />}
            <Row label="Kas bersih" amount={s.total} total />
          </Section>
        ))}
        <tbody>
          <tr>
            <td colSpan={2} className="h-4" />
          </tr>
          <Row label={r.netChange >= 0 ? "Kenaikan kas" : "Penurunan kas"} amount={r.netChange} bold />
          <Row label="Kas awal periode" amount={r.opening} />
        </tbody>
        <GrandTotal label="Kas akhir periode" amount={r.closing} />
      </table>
      <p className="mt-4 text-[13px] text-muted">Angka dalam kurung berarti uang keluar.</p>
    </>
  );
}

function Equity({ r }: { r: any }) {
  return (
    <table className="w-full">
      <tbody>
        <Row label="Modal awal periode" amount={r.opening} />
        <Row label="Tambahan modal (setoran pemilik)" amount={r.contributions} indent />
        <Row label={r.net >= 0 ? "Laba bersih periode ini" : "Rugi bersih periode ini"} amount={r.net} indent />
        <Row label="Prive (diambil pemilik)" amount={-r.drawings} indent />
      </tbody>
      <GrandTotal label="Modal akhir periode" amount={r.closing} />
    </table>
  );
}

const colHead = "border-b border-line-strong py-2 text-xs font-bold tracking-wide text-muted uppercase";

function TrialBalance({ r }: { r: any }) {
  if (!r.rows.length) return <Empty title="Belum ada saldo" />;
  return (
    <>
      {/* HP: satu baris per akun dengan label Debit/Kredit; tiga kolom angka tidak muat di layar sempit. */}
      <div className="md:hidden print:hidden">
        <ul className="divide-y divide-line border-y border-line">
          {(r.rows as { id: number; code: string; name: string; debit: number; credit: number }[]).map((a) => (
            <li key={a.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 break-words">
                <span className="tnum text-muted">{a.code} </span>
                {a.name}
              </span>
              <span className="tnum shrink-0 whitespace-nowrap">
                <span className="mr-1 text-xs text-muted">{a.debit ? "Debit" : "Kredit"}</span>
                {rp(a.debit || a.credit)}
              </span>
            </li>
          ))}
        </ul>
        <dl className="tnum mt-3 space-y-1 border-t-2 border-ink pt-3 text-sm font-extrabold">
          <div className="flex justify-between gap-3">
            <dt>Total debit</dt>
            <dd>{rp(r.totalDebit)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Total kredit</dt>
            <dd>{rp(r.totalCredit)}</dd>
          </div>
        </dl>
      </div>
      <table className="hidden w-full md:table print:table">
        <thead>
          <tr>
            <th scope="col" className={`${colHead} text-left`}>Akun</th>
            <th scope="col" className={`${colHead} text-right`}>Debit</th>
            <th scope="col" className={`${colHead} text-right`}>Kredit</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {(r.rows as { id: number; code: string; name: string; debit: number; credit: number }[]).map((a) => (
            <tr key={a.id}>
              <td className="py-2 pr-3 text-sm">
                <span className="tnum text-muted">{a.code} </span>
                {a.name}
              </td>
              <td className="tnum py-2 text-right text-sm">{a.debit ? rp(a.debit) : ""}</td>
              <td className="tnum py-2 text-right text-sm">{a.credit ? rp(a.credit) : ""}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-ink">
            <td className="pt-3 font-extrabold">Total</td>
            <td className="tnum pt-3 text-right font-extrabold">{rp(r.totalDebit)}</td>
            <td className="tnum pt-3 text-right font-extrabold">{rp(r.totalCredit)}</td>
          </tr>
        </tfoot>
      </table>
      <Check ok={r.balanced} okText="Seimbang: total debit sama dengan total kredit." badText="Tidak seimbang." />
    </>
  );
}

function Ledger({ r }: { r: any }) {
  const accounts = r.accounts as { id: number; code: string; name: string; openingBalance: number; closingBalance: number; totalDebit: number; totalCredit: number; lines: { entryId: number; date: string; description: string; debit: number; credit: number; balance: number }[] }[];
  if (!accounts.length) return <Empty title="Belum ada catatan pada periode ini" />;
  return (
    <div className="space-y-8">
      {accounts.map((a) => (
        <section key={a.id} className="break-inside-avoid">
          <h3 className="mb-2 font-bold">
            <span className="tnum mr-2 text-muted">{a.code}</span>
            {a.name}
          </h3>
          {/* HP: satu kartu per catatan, karena lima kolom tidak muat di layar sempit. */}
          <ul className="divide-y divide-line border-y border-line md:hidden print:hidden">
            <li className="flex items-baseline justify-between gap-3 py-2 text-sm text-muted">
              <span>Saldo awal</span>
              <span className="tnum">{money(a.openingBalance)}</span>
            </li>
            {a.lines.map((l, i) => (
              <li key={i} className="py-2.5 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="tnum text-xs text-muted">{fmtDate(l.date)}</span>
                  <span className="tnum font-semibold whitespace-nowrap">
                    <span className="mr-1 text-xs font-normal text-muted">{l.debit ? "Debit" : "Kredit"}</span>
                    {rp(l.debit || l.credit)}
                  </span>
                </div>
                <p className="mt-0.5 break-words">{l.description}</p>
                <p className="tnum mt-0.5 text-right text-xs text-muted">Saldo {money(l.balance)}</p>
              </li>
            ))}
            <li className="tnum space-y-0.5 py-2.5 text-sm">
              <p className="flex justify-between gap-3 font-bold">
                <span>Saldo akhir</span>
                <span>{money(a.closingBalance)}</span>
              </p>
              <p className="text-xs text-muted">
                Debit {rp(a.totalDebit)} · Kredit {rp(a.totalCredit)}
              </p>
            </li>
          </ul>
          <div className="relative hidden overflow-x-auto md:block print:block">
            <table className="w-full min-w-[34rem]">
              <thead>
                <tr>
                  <th scope="col" className={`${colHead} w-28 text-left`}>Tanggal</th>
                  <th scope="col" className={`${colHead} text-left`}>Keterangan</th>
                  <th scope="col" className={`${colHead} text-right`}>Debit</th>
                  <th scope="col" className={`${colHead} text-right`}>Kredit</th>
                  <th scope="col" className={`${colHead} text-right`}>Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <tr>
                  <td className="py-2 text-sm text-muted" />
                  <td className="py-2 text-sm text-muted">Saldo awal</td>
                  <td />
                  <td />
                  <td className="tnum py-2 text-right text-sm">{money(a.openingBalance)}</td>
                </tr>
                {a.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="tnum py-2 text-sm whitespace-nowrap text-muted">{fmtDate(l.date)}</td>
                    <td className="py-2 pr-3 text-sm wrap-anywhere">{l.description}</td>
                    <td className="tnum py-2 text-right text-sm whitespace-nowrap">{l.debit ? rp(l.debit) : ""}</td>
                    <td className="tnum py-2 text-right text-sm whitespace-nowrap">{l.credit ? rp(l.credit) : ""}</td>
                    <td className="tnum py-2 text-right text-sm whitespace-nowrap">{money(l.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-strong font-bold">
                  <td />
                  <td className="py-2 text-sm">Saldo akhir</td>
                  <td className="tnum py-2 text-right text-sm">{rp(a.totalDebit)}</td>
                  <td className="tnum py-2 text-right text-sm">{rp(a.totalCredit)}</td>
                  <td className="tnum py-2 text-right text-sm">{money(a.closingBalance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

export function JournalTable({ entries, totalDebit, totalCredit, actions }: { entries: Entry[]; totalDebit?: number; totalCredit?: number; actions?: (e: Entry) => ReactNode }) {
  return (
    <>
      {/* HP: satu kartu per catatan, debit & kredit tampil di samping tiap akun. */}
      <div className="md:hidden print:hidden">
        <ul>
          {entries.map((e) => (
            <li key={e.id} className="border-b border-line py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="tnum text-xs text-muted">{fmtDate(e.date)}</p>
                  <p className="text-sm font-semibold break-words">
                    {e.description}
                    {e.contact && <span className="font-normal text-muted"> · {e.contact.name}</span>}
                  </p>
                </div>
                {actions && <div className="no-print -my-1 -mr-2 shrink-0">{actions(e)}</div>}
              </div>
              <ul className="mt-2 space-y-1">
                {e.lines.map((l, i) => (
                  <li key={i} className={cn("flex items-baseline justify-between gap-3 text-sm", l.credit > 0 && "pl-4")}>
                    <span className="min-w-0 break-words">
                      <span className="tnum text-muted">{l.code} </span>
                      {l.name}
                    </span>
                    <span className="tnum shrink-0 whitespace-nowrap">
                      <span className="mr-1 text-xs text-muted">{l.debit ? "Debit" : "Kredit"}</span>
                      {rp(l.debit || l.credit)}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {totalDebit !== undefined && (
          <dl className="tnum mt-3 space-y-1 border-t-2 border-ink pt-3 text-sm font-extrabold">
            <div className="flex justify-between gap-3">
              <dt>Total debit</dt>
              <dd>{rp(totalDebit)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Total kredit</dt>
              <dd>{rp(totalCredit ?? 0)}</dd>
            </div>
          </dl>
        )}
      </div>
      <div className="relative hidden overflow-x-auto md:block print:block">
        <table className="w-full min-w-[34rem]">
          <thead>
            <tr>
              <th scope="col" className={`${colHead} w-28 text-left`}>Tanggal</th>
              <th scope="col" className={`${colHead} text-left`}>Akun & keterangan</th>
              <th scope="col" className={`${colHead} text-right`}>Debit</th>
              <th scope="col" className={`${colHead} text-right`}>Kredit</th>
              {actions && (
                <th scope="col" className={`${colHead} no-print w-20`}>
                  <span className="sr-only">Aksi</span>
                </th>
              )}
            </tr>
          </thead>
          {entries.map((e) => (
            <tbody key={e.id} className="border-b border-line">
              <tr>
                <td className="tnum pt-3 text-sm whitespace-nowrap text-muted">{fmtDate(e.date)}</td>
                <td className="pt-3 text-sm font-semibold wrap-anywhere" colSpan={3}>
                  {e.description}
                  {e.contact && <span className="ml-2 font-normal text-muted">· {e.contact.name}</span>}
                </td>
                {actions && (
                  <td rowSpan={e.lines.length + 1} className="no-print pt-1.5 text-right align-top">
                    {actions(e)}
                  </td>
                )}
              </tr>
              {e.lines.map((l, i) => (
                <tr key={i}>
                  <td />
                  <td className={cn("py-1 text-sm wrap-anywhere", l.credit > 0 && "pl-6", i === e.lines.length - 1 && "pb-3")}>
                    <span className="tnum mr-2 text-muted">{l.code}</span>
                    {l.name}
                  </td>
                  <td className={cn("tnum py-1 text-right text-sm whitespace-nowrap", i === e.lines.length - 1 && "pb-3")}>{l.debit ? rp(l.debit) : ""}</td>
                  <td className={cn("tnum py-1 text-right text-sm whitespace-nowrap", i === e.lines.length - 1 && "pb-3")}>{l.credit ? rp(l.credit) : ""}</td>
                </tr>
              ))}
            </tbody>
          ))}
          {totalDebit !== undefined && (
            <tfoot>
              <tr className="border-t-2 border-ink">
                <td />
                <td className="pt-3 font-extrabold">Total</td>
                <td className="tnum pt-3 text-right font-extrabold">{rp(totalDebit)}</td>
                <td className="tnum pt-3 text-right font-extrabold">{rp(totalCredit ?? 0)}</td>
                {actions && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

function DebtReport({ r }: { r: any }) {
  const block = (title: string, g: { items: Debt[]; total: number; overdue: number }) => (
    <section>
      <h3 className="mb-2 font-bold">{title}</h3>
      {g.items.length === 0 ? (
        <p className="text-sm text-muted">Tidak ada.</p>
      ) : (
        <>
          <div className="md:hidden print:hidden">
            <ul className="divide-y divide-line">
              {g.items.map((d) => (
                <li key={d.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold break-words">{d.contact?.name ?? "Tanpa nama"}</p>
                      <p className="text-[13px] break-words text-muted">{d.description}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-muted">Sisa</p>
                      <p className="tnum text-sm font-semibold whitespace-nowrap">{rp(d.remaining)}</p>
                    </div>
                  </div>
                  <p className="tnum mt-1.5 text-xs text-muted">
                    Jumlah {rp(d.amount)} · Dibayar {rp(d.paid)}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    Jatuh tempo {d.dueDate ? fmtDate(d.dueDate) : "-"}
                    {d.status === "overdue" && <Badge tone="bad">Terlambat</Badge>}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-1 flex items-baseline justify-between gap-3 border-t-2 border-ink pt-3 text-sm font-extrabold">
              <span>
                Total sisa{g.overdue > 0 && <span className="ml-2 text-[13px] font-semibold text-bad">(terlambat {rp(g.overdue)})</span>}
              </span>
              <span className="tnum whitespace-nowrap">{rp(g.total)}</span>
            </p>
          </div>
          <div className="relative hidden overflow-x-auto md:block print:block">
            <table className="w-full min-w-[36rem]">
              <thead>
                <tr>
                  <th scope="col" className={`${colHead} text-left`}>Kontak & keterangan</th>
                  <th scope="col" className={`${colHead} text-left`}>Jatuh tempo</th>
                  <th scope="col" className={`${colHead} text-right`}>Jumlah</th>
                  <th scope="col" className={`${colHead} text-right`}>Dibayar</th>
                  <th scope="col" className={`${colHead} text-right`}>Sisa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {g.items.map((d) => (
                  <tr key={d.id}>
                    <td className="py-2 pr-3 text-sm wrap-anywhere">
                      <span className="font-semibold">{d.contact?.name ?? "Tanpa nama"}</span>
                      <span className="block text-[13px] text-muted">{d.description}</span>
                    </td>
                    <td className="py-2 text-sm whitespace-nowrap">
                      {d.dueDate ? fmtDate(d.dueDate) : "-"}
                      {d.status === "overdue" && (
                        <Badge tone="bad" className="ml-2">
                          Terlambat
                        </Badge>
                      )}
                    </td>
                    <td className="tnum py-2 text-right text-sm whitespace-nowrap">{rp(d.amount)}</td>
                    <td className="tnum py-2 text-right text-sm whitespace-nowrap">{rp(d.paid)}</td>
                    <td className="tnum py-2 text-right text-sm font-semibold whitespace-nowrap">{rp(d.remaining)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink">
                  <td className="pt-3 font-extrabold" colSpan={4}>
                    Total sisa{g.overdue > 0 && <span className="ml-2 text-[13px] font-semibold text-bad">(terlambat {rp(g.overdue)})</span>}
                  </td>
                  <td className="tnum pt-3 text-right font-extrabold whitespace-nowrap">{rp(g.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </section>
  );
  return (
    <div className="space-y-8">
      {block("Utang · yang harus kamu bayar", r.payable)}
      {block("Piutang · yang harus kamu terima", r.receivable)}
    </div>
  );
}

function ReportBody({ api: name, query }: { api: string; query: string }) {
  const state = useData<any>(`/reports/${name}${query}`);
  return (
    <DataState state={state}>
      {(r) => {
        switch (name) {
          case "income-statement":
            return <IncomeStatement r={r} />;
          case "balance-sheet":
            return <BalanceSheet r={r} />;
          case "cash-flow":
            return <CashFlow r={r} />;
          case "equity":
            return <Equity r={r} />;
          case "trial-balance":
            return <TrialBalance r={r} />;
          case "ledger":
            return <Ledger r={r} />;
          case "journal":
            return r.entries.length ? (
              <>
                <JournalTable entries={r.entries} totalDebit={r.totalDebit} totalCredit={r.totalCredit} />
                {r.truncated && <p className="mt-4 text-[13px] text-muted">Hanya 2.000 catatan pertama yang ditampilkan. Persempit rentang waktunya untuk melihat sisanya.</p>}
              </>
            ) : (
              <Empty title="Belum ada catatan pada periode ini" />
            );
          default:
            return <DebtReport r={r} />;
        }
      }}
    </DataState>
  );
}

// ───────────── Halaman ─────────────

export function ReportsPage({ user, slug }: { user: User; slug: string }) {
  const { toast } = useFeedback();
  const def = REPORTS.find((r) => r.slug === slug) ?? REPORTS[0];
  const [period, setPeriod] = useState<Period>(() => makePeriod("this-year"));
  const [accountId, setAccountId] = useState("");
  const [exporting, setExporting] = useState(false);
  const accounts = useData<{ accounts: Account[] }>(def.api === "ledger" ? "/accounts" : null);

  // Untuk laporan "per tanggal", tanggal akhir yang masih di masa depan diganti hari ini.
  const t = today();
  const asOf = period.to > t ? t : period.to;
  const params = def.time === "today" ? { today: t } : def.time === "asof" ? { to: asOf, today: t } : { from: period.from, to: period.to, today: t, accountId: def.api === "ledger" ? accountId : null };
  const query = qs(params);
  const subtitle = def.time === "today" ? `Per ${fmtDate(t)}` : def.time === "asof" ? `Per ${fmtDate(asOf)}` : `${fmtDate(period.from)} – ${fmtDate(period.to)}`;

  async function exportExcel() {
    setExporting(true);
    try {
      await download(`/reports/${def.api}/export${query}`, `${def.slug}.xlsx`);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Page>
      <div className="no-print">
      <PageHeader title="Laporan" description="Semua laporan disusun otomatis dari catatanmu. Pilih jenis laporan, atur waktunya, lalu unduh atau cetak.">
        {def.time !== "today" && <PeriodPicker value={period} onChange={setPeriod} />}
        <Button variant="secondary" onClick={exportExcel} loading={exporting}>
          {!exporting && <FileSpreadsheet className="h-4 w-4" aria-hidden />} Excel
        </Button>
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer className="h-4 w-4" aria-hidden /> Cetak / PDF
        </Button>
      </PageHeader>
      </div>

      <nav aria-label="Jenis laporan" className="no-print mb-6">
        <ul className="flex flex-wrap gap-1.5">
          {REPORTS.map((r) => (
            <li key={r.slug}>
              <a
                href={`#/laporan/${r.slug}`}
                aria-current={r.slug === def.slug ? "page" : undefined}
                className={cn("inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-semibold whitespace-nowrap transition-colors sm:h-9 sm:px-4", r.slug === def.slug ? "border-ink bg-ink text-white" : "border-line-strong text-ink-soft hover:bg-paper")}
              >
                {r.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Card className="print-plain p-4 sm:p-10">
        <header className="mb-6 border-b border-line pb-6 text-center">
          <p className="text-sm font-semibold text-muted wrap-anywhere">{user.businessName || user.name}</p>
          <h2 className="mt-1 text-2xl font-extrabold tracking-tight">{def.title}</h2>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        </header>
        <p className="no-print mx-auto mb-6 max-w-2xl rounded-2xl bg-paper px-4 py-3 text-center text-[13px] text-ink-soft">{def.about}</p>

        {def.api === "ledger" && (
          <div className="no-print mb-6 max-w-xs">
            <label htmlFor="ledger-account" className="mb-1.5 block text-[13px] font-semibold">
              Akun yang ditampilkan
            </label>
            <Select id="ledger-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Semua akun yang ada catatannya</option>
              {(accounts.data?.accounts ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className={cn("mx-auto overflow-x-auto", ["income-statement", "cash-flow", "equity", "trial-balance"].includes(def.api) && "max-w-2xl")}>
          {/* key: ganti jenis laporan = mulai dari kosong, supaya data laporan lama tidak dipakai laporan baru */}
          <ReportBody key={def.api} api={def.api} query={query} />
        </div>
      </Card>
    </Page>
  );
}
