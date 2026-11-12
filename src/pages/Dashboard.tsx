// Dasbor: ringkasan keuangan dalam satu layar.
import { useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import { qs, useData } from "@/lib/api";
import { WriteOnly } from "@/lib/book";
import { fmtDate, fmtMonth, monthShort, rp, today } from "@/lib/format";
import { makePeriod } from "@/lib/period";
import type { Dashboard, User } from "@/lib/types";
import { BudgetRow, ChartCard, COLORS, ColumnChart, Delta, Legend, LineChart, Meter, RankedBars, budgetTone } from "@/components/charts";
import { Amount, KindIcon, TransactionForm } from "@/components/common";
import { PeriodPicker } from "@/components/PeriodPicker";
import { Badge, Button, Card, DataState, Empty } from "@/components/ui";

const moreLink = "inline-flex items-center gap-1 text-[13px] font-semibold text-ink-soft hover:text-ink";

export function DashboardPage({ user }: { user: User }) {
  const [period, setPeriod] = useState(() => makePeriod("this-month"));
  const [adding, setAdding] = useState(false);
  const state = useData<Dashboard>(`/dashboard${qs({ from: period.from, to: period.to, pfrom: period.pfrom, pto: period.pto, today: today() })}`);
  const business = user.usage === "usaha";

  return (
    <>
      <DataState state={state} fallbackClassName="mx-auto max-w-6xl px-4 py-9 sm:px-8">
        {(d) => {
          const net = d.kpis.net;
          const budgeted = d.budget.items.filter((b) => b.budget > 0).sort((a, b) => b.spent / b.budget - a.spent / a.budget);
          const totalExpense = d.expenseByCategory.reduce((s, c) => s + c.amount, 0);
          const months = d.monthly;
          return (
            <>
              {/* Pita atas: angka-angka utama */}
              <div className="bg-paper">
                <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-8 sm:px-8 sm:pt-9">
                  <header className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
                    <div className="min-w-0">
                      <h1 className="text-2xl font-bold tracking-tight">Dasbor</h1>
                      <p className="mt-1 text-sm text-muted wrap-anywhere">
                        {user.businessName || user.name} · {period.label}
                      </p>
                    </div>
                    <div className="no-print flex flex-wrap items-center gap-2">
                      <PeriodPicker value={period} onChange={setPeriod} />
                      <WriteOnly>
                        <Button onClick={() => setAdding(true)}>
                          <Plus className="h-4 w-4" aria-hidden /> Tambah transaksi
                        </Button>
                      </WriteOnly>
                    </div>
                  </header>

                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                    <div className="lg:col-span-5">
                      <p className="text-sm font-medium text-muted">Total uang (kas, bank, dompet digital)</p>
                      <p className="mt-1 text-[clamp(1.875rem,9vw,2.75rem)] leading-none font-semibold tracking-tight break-words">{rp(d.kpis.cashBalance)}</p>
                      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
                        {d.wallets.map((w) => (
                          <li key={w.id}>
                            {w.name} <span className="tnum font-semibold text-ink-soft">{rp(w.balance)}</span>
                          </li>
                        ))}
                      </ul>

                      <dl className="mt-7 grid grid-cols-1 gap-x-6 gap-y-6 border-t border-line-strong pt-6 min-[440px]:grid-cols-2">
                        <div>
                          <dt className="flex items-center gap-1.5 text-sm font-medium text-muted">
                            <span className="h-2.5 w-2.5 rounded-[3px] bg-masuk" aria-hidden /> Pemasukan
                          </dt>
                          <dd className="mt-1 text-2xl font-semibold tracking-tight">{rp(d.kpis.income)}</dd>
                          <Delta now={d.kpis.income} before={d.previous?.income} goodWhenUp label={period.compareLabel} />
                        </div>
                        <div>
                          <dt className="flex items-center gap-1.5 text-sm font-medium text-muted">
                            <span className="h-2.5 w-2.5 rounded-[3px] bg-keluar" aria-hidden /> Pengeluaran
                          </dt>
                          <dd className="mt-1 text-2xl font-semibold tracking-tight">{rp(d.kpis.expense)}</dd>
                          <Delta now={d.kpis.expense} before={d.previous?.expense} goodWhenUp={false} label={period.compareLabel} />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white px-4 py-3 min-[440px]:col-span-2">
                          <dt className="text-sm font-medium text-muted">{business ? (net >= 0 ? "Laba bersih" : "Rugi bersih") : net >= 0 ? "Sisa (pemasukan − pengeluaran)" : "Kurang (pengeluaran lebih besar)"}</dt>
                          <dd className="flex items-center gap-2">
                            <span className="tnum text-lg font-bold">{rp(net)}</span>
                            {d.kpis.income > 0 && net !== 0 && <Badge tone={net > 0 ? "good" : "bad"}>{Math.round((Math.abs(net) / d.kpis.income) * 100)}% dari pemasukan</Badge>}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <ChartCard
                      className="lg:col-span-7"
                      title="Pemasukan vs pengeluaran"
                      subtitle={`6 bulan terakhir, sampai ${fmtMonth(months[months.length - 1].month, true)}`}
                      legend={<Legend items={[{ name: "Pemasukan", color: COLORS.masuk }, { name: "Pengeluaran", color: COLORS.keluar }]} />}
                      table={{ columns: ["Bulan", "Pemasukan", "Pengeluaran", "Selisih"], rows: months.map((m) => [fmtMonth(m.month), m.income, m.expense, m.income - m.expense]) }}
                    >
                      <ColumnChart
                        ariaLabel="Grafik batang pemasukan dan pengeluaran per bulan"
                        categories={months.map((m) => ({ label: monthShort(m.month), full: fmtMonth(m.month, true) }))}
                        series={[
                          { name: "Pemasukan", color: COLORS.masuk, values: months.map((m) => m.income) },
                          { name: "Pengeluaran", color: COLORS.keluar, values: months.map((m) => m.expense) },
                        ]}
                      />
                    </ChartCard>
                  </div>
                </div>
              </div>

              <div className="mx-auto grid grid-cols-1 w-full max-w-6xl items-start gap-6 px-4 pt-8 pb-28 sm:px-8 lg:grid-cols-2">
                {!d.hasData && (
                  <Card className="lg:col-span-2">
                    <Empty title="Belum ada catatan" text="Mulai dengan mencatat satu pemasukan atau pengeluaran. Grafik dan laporan akan terisi sendiri.">
                      <WriteOnly>
                        <Button onClick={() => setAdding(true)}>
                          <Plus className="h-4 w-4" aria-hidden /> Catat transaksi pertama
                        </Button>
                      </WriteOnly>
                    </Empty>
                  </Card>
                )}

                <ChartCard
                  title="Pengeluaran per kategori"
                  subtitle={`${period.label} · total ${rp(totalExpense)}`}
                  table={d.expenseByCategory.length ? { columns: ["Kategori", "Jumlah"], rows: d.expenseByCategory.map((c) => [c.name, c.amount]) } : undefined}
                >
                  {d.expenseByCategory.length ? <RankedBars items={d.expenseByCategory} total={totalExpense} /> : <Empty title="Belum ada pengeluaran" text="Pengeluaran pada periode ini akan muncul di sini, diurutkan dari yang terbesar." />}
                </ChartCard>

                <Card className="flex flex-col p-5">
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                      <h2 className="font-bold tracking-tight">Anggaran {fmtMonth(d.budget.month, true)}</h2>
                      {d.budget.totalBudget > 0 && (
                        <p className="mt-0.5 text-[13px] text-muted">
                          Terpakai <span className="tnum font-semibold text-ink">{rp(d.budget.totalSpent)}</span> dari {rp(d.budget.totalBudget)}
                        </p>
                      )}
                    </div>
                    <a href="#/anggaran" className={moreLink}>
                      Atur <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  </div>
                  {budgeted.length ? (
                    <>
                      <div className="mb-5">
                        <Meter value={d.budget.totalSpent} max={d.budget.totalBudget} tone={budgetTone(d.budget.totalSpent, d.budget.totalBudget)} label="Total anggaran" />
                      </div>
                      <ul className="space-y-4">
                        {budgeted.slice(0, 5).map((b) => (
                          <BudgetRow key={b.accountId} name={b.name} spent={b.spent} budget={b.budget} />
                        ))}
                      </ul>
                      {budgeted.length > 5 && <p className="mt-4 text-[13px] text-muted">+{budgeted.length - 5} kategori lain di halaman Anggaran</p>}
                    </>
                  ) : (
                    <Empty title="Belum ada anggaran" text="Pasang batas pengeluaran per kategori supaya ketahuan kalau mulai boros.">
                      <a href="#/anggaran">
                        <Button variant="secondary" size="sm">
                          Pasang anggaran
                        </Button>
                      </a>
                    </Empty>
                  )}
                </Card>

                <ChartCard
                  className="lg:col-span-2"
                  title="Tren total uang"
                  subtitle={d.cashTrend.length ? `Saldo kas & bank dari ${fmtDate(d.cashTrend[0].date)} sampai ${fmtDate(d.cashTrend[d.cashTrend.length - 1].date)}` : "Saldo kas & bank dari hari ke hari"}
                  table={d.cashTrend.length ? { columns: ["Tanggal", "Saldo"], rows: d.cashTrend.map((p) => [fmtDate(p.date), p.balance]) } : undefined}
                >
                  {d.cashTrend.length > 1 ? (
                    <LineChart ariaLabel="Grafik garis saldo kas dan bank dari hari ke hari" name="Total uang" points={d.cashTrend.map((p) => ({ date: p.date, value: p.balance }))} />
                  ) : (
                    <Empty title="Belum cukup data" text="Tren akan muncul setelah ada catatan di lebih dari satu hari pada periode ini." />
                  )}
                </ChartCard>

                <Card className="p-5">
                  <div className="mb-2 flex items-center justify-between gap-4">
                    <h2 className="font-bold tracking-tight">Catatan terbaru</h2>
                    <a href="#/transaksi" className={moreLink}>
                      Lihat semua <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  </div>
                  {d.recent.length ? (
                    <ul className="divide-y divide-line">
                      {d.recent.map((e) => (
                        <li key={e.id} className="flex items-center gap-3 py-3">
                          <KindIcon kind={e.kind} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{e.description}</p>
                            <p className="truncate text-[13px] text-muted">
                              {fmtDate(e.date)}
                              {e.category ? ` · ${e.category.name}` : ""}
                            </p>
                          </div>
                          <Amount kind={e.kind} amount={e.amount} className="text-sm" />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty title="Belum ada catatan pada periode ini" />
                  )}
                </Card>

                <Card className="p-5">
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <h2 className="font-bold tracking-tight">Utang & piutang</h2>
                    <a href="#/utang-piutang" className={moreLink}>
                      Kelola <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  </div>
                  <dl className="grid grid-cols-2 gap-4">
                    <div className="rounded-2xl bg-paper px-4 py-3">
                      <dt className="text-[13px] text-muted">Harus kamu bayar</dt>
                      <dd className="tnum mt-0.5 text-lg font-bold">{rp(d.debts.payable)}</dd>
                    </div>
                    <div className="rounded-2xl bg-paper px-4 py-3">
                      <dt className="text-[13px] text-muted">Harus kamu terima</dt>
                      <dd className="tnum mt-0.5 text-lg font-bold">{rp(d.debts.receivable)}</dd>
                    </div>
                  </dl>
                  {d.debts.upcoming.length ? (
                    <ul className="mt-2 divide-y divide-line">
                      {d.debts.upcoming.map((x) => (
                        <li key={x.id} className="flex items-center justify-between gap-3 py-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{x.contact?.name ?? x.description}</p>
                            <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
                              {x.kind === "payable" ? "Utang" : "Piutang"}
                              {x.dueDate ? ` · jatuh tempo ${fmtDate(x.dueDate)}` : " · tanpa jatuh tempo"}
                              {x.status === "overdue" && <Badge tone="bad">Terlambat</Badge>}
                            </p>
                          </div>
                          <span className="tnum text-sm font-semibold whitespace-nowrap">{rp(x.remaining)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-4 text-sm text-muted">Tidak ada utang atau piutang yang belum lunas.</p>
                  )}
                </Card>
              </div>
            </>
          );
        }}
      </DataState>
      <TransactionForm open={adding} onClose={() => setAdding(false)} onSaved={state.reload} />
    </>
  );
}
