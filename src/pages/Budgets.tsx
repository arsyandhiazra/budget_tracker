// Halaman Anggaran: batas pengeluaran bulanan per kategori.
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api, errorMessage, useData } from "@/lib/api";
import { addMonths, fmtMonth, rp, today } from "@/lib/format";
import type { BudgetItem, BudgetStatus } from "@/lib/types";
import { BudgetStatusLabel, Meter, budgetTone } from "@/components/charts";
import { Page } from "@/components/Layout";
import { Button, Card, DataState, MoneyInput, PageHeader, useFeedback } from "@/components/ui";

export function BudgetsPage() {
  const { toast } = useFeedback();
  const thisMonth = today().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [drafts, setDrafts] = useState<Record<number, number>>({});
  const state = useData<BudgetStatus>(`/budgets?month=${month}`);

  async function save(item: BudgetItem) {
    const value = drafts[item.accountId];
    if (value === undefined || value === item.budget) return;
    try {
      await api(`/budgets/${item.accountId}`, { method: "PUT", body: { amount: value } });
      toast(value ? `Anggaran ${item.name} disimpan.` : `Anggaran ${item.name} dihapus.`);
      await state.reload();
      setDrafts((d) => {
        const { [item.accountId]: _removed, ...rest } = d;
        return rest;
      });
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <Page>
      <PageHeader title="Anggaran" description="Pasang batas pengeluaran tiap bulan per kategori. Batas yang sama berlaku setiap bulan sampai kamu mengubahnya.">
        <div className="flex items-center gap-1 rounded-xl border border-line-strong p-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Bulan sebelumnya" onClick={() => setMonth((m) => addMonths(m, -1))}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <span className="min-w-[8.5rem] text-center text-sm font-semibold" aria-live="polite">
            {fmtMonth(month, true)}
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Bulan berikutnya" disabled={month >= thisMonth} onClick={() => setMonth((m) => addMonths(m, 1))}>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </PageHeader>

      <DataState state={state}>
        {(data) => {
          const left = data.totalBudget - data.totalSpent;
          return (
            <>
              <Card className="mb-6 bg-paper p-6">
                {data.totalBudget > 0 ? (
                  <>
                    <dl className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                      <div>
                        <dt className="text-sm font-medium text-muted">Total anggaran</dt>
                        <dd className="tnum mt-1 text-2xl font-semibold tracking-tight">{rp(data.totalBudget)}</dd>
                      </div>
                      <div>
                        <dt className="text-sm font-medium text-muted">Sudah terpakai</dt>
                        <dd className="tnum mt-1 text-2xl font-semibold tracking-tight">{rp(data.totalSpent)}</dd>
                      </div>
                      <div>
                        <dt className="text-sm font-medium text-muted">{left >= 0 ? "Sisa" : "Lewat batas"}</dt>
                        <dd className="tnum mt-1 text-2xl font-semibold tracking-tight">{rp(Math.abs(left))}</dd>
                      </div>
                    </dl>
                    <div className="mt-5">
                      <Meter value={data.totalSpent} max={data.totalBudget} tone={budgetTone(data.totalSpent, data.totalBudget)} label="Total anggaran terpakai" />
                      <div className="mt-2">
                        <BudgetStatusLabel spent={data.totalSpent} budget={data.totalBudget} />
                      </div>
                    </div>
                  </>
                ) : (
                  <div>
                    <p className="font-bold">Belum ada anggaran yang dipasang</p>
                    <p className="mt-1 max-w-xl text-sm text-muted">Isi kolom “Batas per bulan” pada kategori di bawah. Mulai dari satu atau dua kategori yang paling sering bikin boros saja dulu.</p>
                  </div>
                )}
              </Card>

              <Card>
                <ul className="divide-y divide-line">
                  {data.items.map((item) => {
                    const draft = drafts[item.accountId] ?? item.budget;
                    return (
                      <li key={item.accountId} className="grid grid-cols-1 items-center gap-x-6 gap-y-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_12rem]">
                        <div className="min-w-0">
                          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
                            <p className="truncate font-semibold">{item.name}</p>
                            <p className="tnum text-[13px] text-muted">
                              Terpakai <span className="font-semibold text-ink">{rp(item.spent)}</span>
                              {item.budget > 0 && <> dari {rp(item.budget)}</>}
                            </p>
                          </div>
                          {item.budget > 0 ? (
                            <>
                              <Meter value={item.spent} max={item.budget} tone={budgetTone(item.spent, item.budget)} label={`Anggaran ${item.name}`} />
                              <div className="mt-1.5">
                                <BudgetStatusLabel spent={item.spent} budget={item.budget} />
                              </div>
                            </>
                          ) : (
                            <p className="text-[13px] text-faint">Belum ada batas untuk kategori ini.</p>
                          )}
                        </div>
                        <div className="no-print">
                          <MoneyInput ariaLabel={`Batas per bulan untuk ${item.name}`} value={draft} placeholder="Batas per bulan" onChange={(n) => setDrafts((d) => ({ ...d, [item.accountId]: n }))} onBlur={() => save(item)} onEnter={() => save(item)} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
              <p className="mt-3 text-[13px] text-muted">Perubahan tersimpan otomatis saat kamu pindah dari kolomnya atau menekan Enter. Kosongkan kolom untuk menghapus batas.</p>
            </>
          );
        }}
      </DataState>
    </Page>
  );
}
