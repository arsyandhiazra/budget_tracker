// Halaman Transaksi: daftar semua catatan + tambah/ubah/hapus.
import { useEffect, useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { api, errorMessage, qs } from "@/lib/api";
import { useBook, WriteOnly } from "@/lib/book";
import { fmtDate, rp } from "@/lib/format";
import { makePeriod } from "@/lib/period";
import type { Entry } from "@/lib/types";
import { Amount, KindBadge, KindIcon, TransactionForm } from "@/components/common";
import { Page } from "@/components/Layout";
import { PeriodPicker } from "@/components/PeriodPicker";
import { Button, Card, Empty, ErrorBox, Input, Loading, PageHeader, Segmented, td, th, useFeedback } from "@/components/ui";

const SIMPLE = ["income", "expense", "transfer", "capital_in", "drawing"];
const PAGE_SIZE = 50;

type Filter = "all" | "income" | "expense" | "transfer";
type Result = { items: Entry[]; total: number; totals: { income: number; expense: number } };

export function TransactionsPage() {
  const { toast, confirm } = useFeedback();
  const { userId } = useBook();
  const [period, setPeriod] = useState(() => makePeriod("this-month"));
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ open: boolean; edit: Entry | null }>({ open: false, edit: null });
  const [version, setVersion] = useState(0);

  // Pencarian menunggu sebentar setelah mengetik, supaya tidak memanggil server tiap huruf.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const base = { from: period.from, to: period.to, kind: filter === "all" ? null : filter, q: query };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<Result>(`/transactions${qs({ ...base, limit: PAGE_SIZE })}`)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setError(null);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.from, period.to, filter, query, version]);

  const reload = () => setVersion((v) => v + 1);

  async function loadMore() {
    if (!data) return;
    setLoading(true);
    try {
      const r = await api<Result>(`/transactions${qs({ ...base, limit: PAGE_SIZE, offset: data.items.length })}`);
      setData({ ...r, items: [...data.items, ...r.items] });
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setLoading(false);
    }
  }

  async function remove(e: Entry) {
    const ok = await confirm({
      title: "Hapus catatan ini?",
      message: (
        <>
          <strong>{e.description}</strong> ({rp(e.amount)}, {fmtDate(e.date)}) akan dihapus dan saldo ikut menyesuaikan. Tindakan ini tidak bisa dibatalkan.
        </>
      ),
      confirmLabel: "Hapus",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/entries/${e.id}`, { method: "DELETE" });
      toast("Catatan dihapus.");
      reload();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  const detail = (e: Entry) => {
    const base = e.kind === "transfer" ? `${e.cashAccount?.name ?? "?"} → ${e.toAccount?.name ?? "?"}` : e.category && e.cashAccount ? `${e.category.name} · ${e.cashAccount.name}` : e.lines.map((l) => l.name).join(" · ");
    // Di pembukuan yang dipakai bersama: tampilkan siapa yang mencatat, kalau bukan kamu sendiri.
    return e.createdBy && e.createdBy.id !== userId ? `${base} · dicatat ${e.createdBy.name}` : base;
  };

  const actions = (e: Entry) => {
    const linked = e.kind === "debt" || e.kind === "debt_payment";
    if (linked) {
      return (
        <a href="#/utang-piutang" className="text-[13px] font-semibold text-muted underline underline-offset-2 hover:text-ink">
          Kelola
        </a>
      );
    }
    return (
      <span className="inline-flex gap-1">
        <WriteOnly>
          {SIMPLE.includes(e.kind) ? (
            <Button variant="ghost" size="icon" aria-label={`Ubah ${e.description}`} title="Ubah" onClick={() => setForm({ open: true, edit: e })}>
              <Pencil className="h-4 w-4" aria-hidden />
            </Button>
          ) : (
            <a href="#/jurnal" title="Ubah di Jurnal Umum" aria-label={`Ubah ${e.description} di Jurnal Umum`} className="inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-paper">
              <Pencil className="h-4 w-4" aria-hidden />
            </a>
          )}
          <Button variant="ghost" size="icon" aria-label={`Hapus ${e.description}`} title="Hapus" onClick={() => remove(e)}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </WriteOnly>
      </span>
    );
  };

  return (
    <Page>
      <PageHeader title="Transaksi" description="Semua catatan uang masuk, uang keluar, dan perpindahan antar dompet.">
        <PeriodPicker value={period} onChange={setPeriod} />
        <WriteOnly>
          <Button onClick={() => setForm({ open: true, edit: null })}>
            <Plus className="h-4 w-4" aria-hidden /> Tambah transaksi
          </Button>
        </WriteOnly>
      </PageHeader>

      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Saring jenis"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "Semua" },
            { value: "income", label: "Pemasukan" },
            { value: "expense", label: "Pengeluaran" },
            { value: "transfer", label: "Transfer" },
          ]}
        />
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari keterangan…" aria-label="Cari keterangan" className="pl-9" />
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorBox message={error} onRetry={reload} />
        </div>
      )}

      {data === null ? (
        !error && <Loading />
      ) : (
        <Card className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 border-b border-line px-5 py-4 text-sm">
            <p className="text-muted">
              <span className="font-semibold text-ink">{data.total}</span> catatan · {period.label}
            </p>
            <p className="flex items-center gap-1.5 text-muted">
              <span className="h-2.5 w-2.5 rounded-[3px] bg-masuk" aria-hidden /> Pemasukan <span className="tnum font-semibold text-ink">{rp(data.totals.income)}</span>
            </p>
            <p className="flex items-center gap-1.5 text-muted">
              <span className="h-2.5 w-2.5 rounded-[3px] bg-keluar" aria-hidden /> Pengeluaran <span className="tnum font-semibold text-ink">{rp(data.totals.expense)}</span>
            </p>
          </div>

          {data.items.length === 0 ? (
            <Empty title={query || filter !== "all" ? "Tidak ada yang cocok" : "Belum ada catatan pada periode ini"} text={query || filter !== "all" ? "Coba ubah kata pencarian, saringan, atau rentang waktunya." : "Tekan Tambah transaksi untuk mulai mencatat."} />
          ) : (
            <>
              {/* Tabel untuk layar lebar */}
              <div className="relative hidden overflow-x-auto md:block">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line">
                      <th scope="col" className={th}>Tanggal</th>
                      <th scope="col" className={th}>Keterangan</th>
                      <th scope="col" className={th}>Jenis</th>
                      <th scope="col" className={`${th} text-right`}>Jumlah</th>
                      <th scope="col" className={`${th} w-24 text-right`}>
                        <span className="sr-only">Aksi</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.items.map((e) => (
                      <tr key={e.id} className="hover:bg-paper/50">
                        <td className={`${td} tnum whitespace-nowrap text-muted`}>{fmtDate(e.date)}</td>
                        <td className={`${td} max-w-0 w-full`}>
                          <p className="truncate font-semibold">{e.description}</p>
                          <p className="truncate text-[13px] text-muted">
                            {detail(e)}
                            {e.contact ? ` · ${e.contact.name}` : ""}
                          </p>
                        </td>
                        <td className={td}>
                          <KindBadge kind={e.kind} />
                        </td>
                        <td className={`${td} text-right`}>
                          <Amount kind={e.kind} amount={e.amount} />
                        </td>
                        <td className={`${td} no-print text-right`}>{actions(e)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Daftar untuk layar kecil */}
              <ul className="divide-y divide-line md:hidden">
                {data.items.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                    <KindIcon kind={e.kind} />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-semibold break-words">{e.description}</p>
                      <p className="truncate text-[13px] text-muted">
                        {fmtDate(e.date)} · {detail(e)}
                      </p>
                      <Amount kind={e.kind} amount={e.amount} className="text-sm" />
                    </div>
                    <div className="no-print shrink-0">{actions(e)}</div>
                  </li>
                ))}
              </ul>

              {data.items.length < data.total && (
                <div className="no-print border-t border-line p-4 text-center">
                  <Button variant="secondary" onClick={loadMore} loading={loading}>
                    Muat {Math.min(PAGE_SIZE, data.total - data.items.length)} catatan berikutnya
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      )}

      <TransactionForm open={form.open} edit={form.edit} onClose={() => setForm((f) => ({ ...f, open: false }))} onSaved={reload} />
    </Page>
  );
}
