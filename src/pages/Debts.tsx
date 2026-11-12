// Halaman Utang & Piutang: siapa berutang ke siapa, kapan jatuh tempo, dan pelunasannya.
import { useEffect, useState, type FormEvent } from "react";
import { BookOpenText, CircleCheck, Info, Plus, Receipt, Trash2 } from "lucide-react";
import { cn } from "@/utils/cn";
import { api, errorMessage, useData } from "@/lib/api";
import { WriteOnly } from "@/lib/book";
import { fmtDate, rp, today } from "@/lib/format";
import type { Account, Contact, Debt } from "@/lib/types";
import { Meter } from "@/components/charts";
import { Page } from "@/components/Layout";
import { Badge, Button, Card, DataState, Empty, ErrorBox, Field, Input, Modal, MoneyInput, PageHeader, Segmented, Select, useFeedback } from "@/components/ui";

type Kind = "payable" | "receivable";
type Mode = "cash" | "credit";

const MODES: Record<Kind, { value: Mode; title: string; text: string }[]> = {
  payable: [
    { value: "cash", title: "Saya pinjam uang", text: "Uang masuk ke dompet, nanti harus dikembalikan." },
    { value: "credit", title: "Saya beli, belum bayar", text: "Barang/jasa sudah diterima, bayarnya nanti." },
  ],
  receivable: [
    { value: "cash", title: "Saya meminjamkan uang", text: "Uang keluar dari dompet, nanti dikembalikan." },
    { value: "credit", title: "Saya jual, belum dibayar", text: "Barang/jasa sudah diberikan, pembayaran menyusul." },
  ],
};

function DebtForm({ open, kind: initialKind, onClose, onSaved }: { open: boolean; kind: Kind; onClose: () => void; onSaved: () => void }) {
  const { toast } = useFeedback();
  const accounts = useData<{ accounts: Account[] }>(open ? "/accounts" : null);
  const contacts = useData<{ contacts: Contact[] }>(open ? "/contacts" : null);
  const [kind, setKind] = useState<Kind>(initialKind);
  const [mode, setMode] = useState<Mode>("cash");
  const [contact, setContact] = useState("");
  const [contactName, setContactName] = useState("");
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(today());
  const [dueDate, setDueDate] = useState("");
  const [cashId, setCashId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setMode("cash");
    setContact("");
    setContactName("");
    setAmount(0);
    setDate(today());
    setDueDate("");
    setCategoryId("");
    setDescription("");
    setError(null);
  }, [open, initialKind]);

  const all = (accounts.data?.accounts ?? []).filter((a) => !a.archived);
  const wallets = all.filter((a) => a.subtype === "cash");
  const categories = kind === "payable" ? all.filter((a) => a.type === "expense" || (a.type === "asset" && a.subtype !== "cash" && a.subtype !== "receivable")) : all.filter((a) => a.type === "income");
  const people = contacts.data?.contacts ?? [];

  useEffect(() => {
    if (open && !cashId && wallets.length) setCashId(String(wallets[0].id));
  }, [open, cashId, wallets]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!amount) return setError("Jumlah belum diisi.");
    if (mode === "credit" && !categoryId) return setError("Pilih kategorinya dulu.");
    if (contact === "__new" && !contactName.trim()) return setError("Nama kontak belum diisi.");
    const title = MODES[kind].find((m) => m.value === mode)!.title;
    setBusy(true);
    setError(null);
    try {
      await api("/debts", {
        method: "POST",
        body: {
          kind,
          mode,
          amount,
          date,
          dueDate: dueDate || null,
          description: description.trim() || title.replace(/^Saya /, "").replace(/^./, (c) => c.toUpperCase()),
          contactId: contact && contact !== "__new" ? Number(contact) : null,
          contactName: contact === "__new" ? contactName.trim() : null,
          cashAccountId: mode === "cash" ? Number(cashId) : undefined,
          categoryId: mode === "credit" ? Number(categoryId) : undefined,
        },
      });
      toast(kind === "payable" ? "Utang dicatat." : "Piutang dicatat.");
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Catat utang / piutang"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" form="debt-form" loading={busy}>
            Simpan
          </Button>
        </>
      }
    >
      <form id="debt-form" onSubmit={submit} className="space-y-4" noValidate>
        <Segmented
          label="Jenis"
          value={kind}
          onChange={(k) => {
            setKind(k);
            setCategoryId("");
          }}
          options={[
            { value: "payable", label: "Utang (saya yang bayar)" },
            { value: "receivable", label: "Piutang (saya yang terima)" },
          ]}
        />
        <div role="radiogroup" aria-label="Bagaimana terjadinya" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {MODES[kind].map((m) => (
            <button key={m.value} type="button" role="radio" aria-checked={mode === m.value} onClick={() => setMode(m.value)} className={cn("rounded-2xl border p-3 text-left transition-colors", mode === m.value ? "border-ink bg-paper ring-1 ring-ink" : "border-line-strong hover:bg-paper/60")}>
              <p className="text-sm font-bold">{m.title}</p>
              <p className="mt-0.5 text-[13px] text-muted">{m.text}</p>
            </button>
          ))}
        </div>
        {error && <ErrorBox message={error} />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={kind === "payable" ? "Utang kepada" : "Piutang dari"}>
            {(id) => (
              <Select id={id} value={contact} onChange={(e) => setContact(e.target.value)}>
                <option value="">Tanpa nama</option>
                {people.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="__new">+ Kontak baru…</option>
              </Select>
            )}
          </Field>
          {contact === "__new" && <Field label="Nama kontak baru">{(id) => <Input id={id} value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={80} autoFocus />}</Field>}
        </div>
        <Field label="Jumlah">{(id) => <MoneyInput id={id} value={amount} onChange={setAmount} />}</Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Tanggal">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />}</Field>
          <Field label="Jatuh tempo" hint="Boleh dikosongkan.">
            {(id) => <Input id={id} type="date" value={dueDate} min={date} onChange={(e) => setDueDate(e.target.value)} />}
          </Field>
        </div>
        {mode === "cash" ? (
          <Field label={kind === "payable" ? "Uang masuk ke dompet" : "Uang keluar dari dompet"}>
            {(id) => (
              <Select id={id} value={cashId} onChange={(e) => setCashId(e.target.value)}>
                {wallets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {rp(a.balance)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <Field label={kind === "payable" ? "Untuk keperluan (kategori)" : "Dari pendapatan (kategori)"}>
            {(id) => (
              <Select id={id} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Pilih kategori…</option>
                {categories.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Keterangan" hint="Boleh dikosongkan.">
          {(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Contoh: pinjam untuk modal, jual 10 kaos" maxLength={200} />}
        </Field>
      </form>
    </Modal>
  );
}

function PayForm({ debt, onClose, onSaved }: { debt: Debt | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useFeedback();
  const accounts = useData<{ accounts: Account[] }>(debt ? "/accounts" : null);
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(today());
  const [cashId, setCashId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wallets = (accounts.data?.accounts ?? []).filter((a) => a.subtype === "cash" && !a.archived);

  useEffect(() => {
    if (!debt) return;
    setAmount(debt.remaining);
    setDate(today() < debt.date ? debt.date : today());
    setError(null);
  }, [debt]);
  useEffect(() => {
    if (debt && !cashId && wallets.length) setCashId(String(wallets[0].id));
  }, [debt, cashId, wallets]);

  if (!debt) return null;
  const payable = debt.kind === "payable";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!amount) return setError("Jumlah belum diisi.");
    setBusy(true);
    setError(null);
    try {
      await api(`/debts/${debt!.id}/payments`, { method: "POST", body: { amount, date, cashAccountId: Number(cashId) } });
      toast(amount >= debt!.remaining ? "Lunas! Pembayaran dicatat." : "Pembayaran dicatat.");
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={payable ? "Bayar utang" : "Terima pembayaran piutang"}
      description={`${debt.contact?.name ?? debt.description} · sisa ${rp(debt.remaining)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" form="pay-form" loading={busy}>
            Simpan
          </Button>
        </>
      }
    >
      <form id="pay-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <ErrorBox message={error} />}
        <Field label="Jumlah" hint={amount < debt.remaining && amount > 0 ? `Bayar sebagian. Sisa setelah ini ${rp(debt.remaining - amount)}.` : "Sudah diisi dengan sisa tagihan. Ubah kalau bayar sebagian."}>
          {(id) => <MoneyInput id={id} value={amount} onChange={(n) => setAmount(Math.min(n, debt.remaining))} autoFocus />}
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Tanggal">{(id) => <Input id={id} type="date" value={date} min={debt.date} onChange={(e) => setDate(e.target.value)} required />}</Field>
          <Field label={payable ? "Dibayar dari dompet" : "Masuk ke dompet"}>
            {(id) => (
              <Select id={id} value={cashId} onChange={(e) => setCashId(e.target.value)}>
                {wallets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {rp(a.balance)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </form>
    </Modal>
  );
}

export function DebtsPage() {
  const { toast, confirm } = useFeedback();
  const state = useData<{ debts: Debt[]; totals: Record<Kind, number>; unlinked: Record<Kind, number> }>(`/debts?today=${today()}`);
  const [tab, setTab] = useState<Kind>("payable");
  const [showPaid, setShowPaid] = useState(false);
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<Debt | null>(null);

  async function remove(d: Debt) {
    const ok = await confirm({
      title: "Hapus catatan ini?",
      message: (
        <>
          <strong>{d.description}</strong> ({rp(d.amount)}) beserta {d.payments.length ? `${d.payments.length} pembayarannya` : "semua datanya"} akan dihapus, dan saldo ikut menyesuaikan. Tindakan ini tidak bisa dibatalkan.
        </>
      ),
      confirmLabel: "Hapus",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/debts/${d.id}`, { method: "DELETE" });
      toast("Catatan dihapus.");
      state.reload();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function removePayment(d: Debt, paymentId: number) {
    if (!(await confirm({ title: "Hapus pembayaran ini?", message: "Sisa tagihan akan bertambah lagi sebesar pembayaran yang dihapus.", confirmLabel: "Hapus", danger: true }))) return;
    try {
      await api(`/debts/${d.id}/payments/${paymentId}`, { method: "DELETE" });
      toast("Pembayaran dihapus.");
      state.reload();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <Page>
      <PageHeader title="Utang & Piutang" description="Utang = uang yang harus kamu bayar. Piutang = uang yang harus kamu terima dari orang lain. Termasuk yang dicatat lewat faktur atau jurnal manual.">
        <WriteOnly>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Catat baru
          </Button>
        </WriteOnly>
      </PageHeader>

      <DataState state={state}>
        {(data) => {
          const mine = data.debts.filter((d) => d.kind === tab);
          const open = mine.filter((d) => d.status !== "paid");
          const paid = mine.filter((d) => d.status === "paid");
          const overdue = open.filter((d) => d.status === "overdue");
          const list = showPaid ? [...open, ...paid] : open;
          return (
            <>
              <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {(["payable", "receivable"] as Kind[]).map((k) => (
                  <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k} className={cn("rounded-2xl border p-5 text-left transition-colors", tab === k ? "border-ink bg-paper ring-1 ring-ink" : "border-line hover:bg-paper/60")}>
                    <p className="text-sm font-medium text-muted">{k === "payable" ? "Utang · harus kamu bayar" : "Piutang · harus kamu terima"}</p>
                    <p className="tnum mt-1 text-3xl font-semibold tracking-tight">{rp(data.totals[k])}</p>
                    <p className="mt-1 text-[13px] text-muted">{data.debts.filter((d) => d.kind === k && d.status !== "paid").length} catatan belum lunas</p>
                  </button>
                ))}
              </div>

              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-bold tracking-tight">
                  {tab === "payable" ? "Daftar utang" : "Daftar piutang"}
                  {overdue.length > 0 && (
                    <Badge tone="bad" className="ml-2 align-middle">
                      {overdue.length} terlambat
                    </Badge>
                  )}
                </h2>
                {paid.length > 0 && (
                  <label className="no-print flex items-center gap-2 text-sm text-muted">
                    <input type="checkbox" checked={showPaid} onChange={(e) => setShowPaid(e.target.checked)} className="h-4 w-4 accent-ink" />
                    Tampilkan yang sudah lunas ({paid.length})
                  </label>
                )}
              </div>

              {Math.abs(data.unlinked[tab]) > 0 && (
                <p className="mb-3 flex gap-2.5 rounded-2xl border border-warn/40 bg-warn-soft px-4 py-3 text-[13px] text-ink-soft" role="note">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
                  <span>
                    {data.unlinked[tab] > 0 ? (
                      <>
                        Neraca mencatat <strong>{rp(data.unlinked[tab])}</strong> {tab === "payable" ? "utang" : "piutang"} lebih banyak daripada daftar ini, misalnya dari saldo awal atau jurnal yang akunnya diubah.
                      </>
                    ) : (
                      <>
                        Ada pelunasan lewat jurnal sebesar <strong>{rp(-data.unlinked[tab])}</strong> yang belum bisa dicocokkan dengan catatan {tab === "payable" ? "utang" : "piutang"} mana pun (belum ada catatannya, atau tanggal/kontaknya tidak cocok).
                      </>
                    )}{" "}
                    Periksa di <a href="#/jurnal" className="font-semibold underline underline-offset-2">Jurnal Umum</a>.
                  </span>
                </p>
              )}

              {list.length === 0 ? (
                <Card>
                  <Empty icon={<CircleCheck className="h-5 w-5" aria-hidden />} title={tab === "payable" ? "Tidak ada utang yang belum lunas" : "Tidak ada piutang yang belum diterima"} text="Catatan baru akan muncul di sini, diurutkan dari jatuh tempo terdekat." />
                </Card>
              ) : (
                <ul className="space-y-3">
                  {list.map((d) => (
                    <li key={d.id}>
                      <Card className="p-5">
                        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-2 font-bold">
                              {d.contact?.name ?? "Tanpa nama"}
                              {d.source === "journal" && (
                                <a href="#/jurnal" title="Dicatat lewat jurnal manual. Ubah di Jurnal Umum.">
                                  <Badge tone="neutral">
                                    <BookOpenText className="h-3 w-3" aria-hidden /> Dari jurnal manual
                                  </Badge>
                                </a>
                              )}
                              {d.invoice && (
                                <a href={`#/faktur/${d.invoice.id}`} title="Lihat faktur">
                                  <Badge tone="masuk">
                                    <Receipt className="h-3 w-3" aria-hidden /> Faktur {d.invoice.number}
                                  </Badge>
                                </a>
                              )}
                              {d.status === "overdue" && <Badge tone="bad">Terlambat</Badge>}
                              {d.status === "paid" && (
                                <Badge tone="good">
                                  <CircleCheck className="h-3 w-3" aria-hidden /> Lunas
                                </Badge>
                              )}
                            </p>
                            <p className="mt-0.5 text-sm text-ink-soft">{d.description}</p>
                            <p className="mt-1 text-[13px] text-muted">
                              Dicatat {fmtDate(d.date)} · {d.dueDate ? `jatuh tempo ${fmtDate(d.dueDate)}` : "tanpa jatuh tempo"}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-[13px] text-muted">Sisa</p>
                            <p className="tnum text-xl font-bold">{rp(d.remaining)}</p>
                          </div>
                        </div>
                        <div className="mt-4">
                          <Meter value={d.paid} max={d.amount} label={`Sudah dibayar untuk ${d.description}`} />
                          <p className="tnum mt-1.5 text-[13px] text-muted">
                            Sudah dibayar <span className="font-semibold text-ink">{rp(d.paid)}</span> dari {rp(d.amount)}
                          </p>
                        </div>
                        {d.payments.length > 0 && (
                          <details className="mt-3 text-sm">
                            <summary className="font-semibold text-ink-soft select-none">Riwayat pembayaran ({d.payments.length})</summary>
                            <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                              {d.payments.map((p) => (
                                <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                                  <span className="text-muted">
                                    {fmtDate(p.date)}
                                    {p.source === "journal" && " · lewat jurnal manual"}
                                  </span>
                                  <span className="flex items-center gap-2">
                                    <span className="tnum font-semibold">{rp(p.amount)}</span>
                                    {p.source === "menu" ? (
                                      <WriteOnly>
                                        <Button variant="ghost" size="icon" className="no-print h-8 w-8" aria-label={`Hapus pembayaran ${fmtDate(p.date)}`} onClick={() => removePayment(d, p.id)}>
                                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                        </Button>
                                      </WriteOnly>
                                    ) : (
                                      <a href="#/jurnal" className="no-print text-[13px] font-semibold text-muted underline underline-offset-2 hover:text-ink">
                                        Jurnal
                                      </a>
                                    )}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                        <div className="no-print mt-4 flex items-center justify-end gap-2">
                          {d.source === "menu" ? (
                            <WriteOnly>
                              <Button variant="ghost" size="sm" onClick={() => remove(d)}>
                                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Hapus
                              </Button>
                            </WriteOnly>
                          ) : (
                            <a href={d.invoice ? `#/faktur/${d.invoice.id}` : "#/jurnal"} className="text-[13px] font-semibold text-muted underline underline-offset-2 hover:text-ink">
                              {d.invoice ? "Kelola di Faktur" : "Kelola di Jurnal Umum"}
                            </a>
                          )}
                          {d.status !== "paid" && (
                            <WriteOnly>
                              <Button size="sm" onClick={() => setPaying(d)}>
                                {d.kind === "payable" ? "Bayar" : "Terima pembayaran"}
                              </Button>
                            </WriteOnly>
                          )}
                        </div>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </>
          );
        }}
      </DataState>

      <DebtForm open={creating} kind={tab} onClose={() => setCreating(false)} onSaved={state.reload} />
      <PayForm debt={paying} onClose={() => setPaying(null)} onSaved={state.reload} />
    </Page>
  );
}
