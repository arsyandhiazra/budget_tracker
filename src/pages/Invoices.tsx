// Halaman Faktur: daftar faktur, formulir buat/ubah, dan tampilan faktur yang siap dicetak / disimpan sebagai PDF.
// Setiap faktur otomatis menjadi piutang di menu Utang & Piutang, dan pembayarannya tercatat di sana.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, CircleCheck, Pencil, Plus, Printer, Receipt, Search, Trash2, Wallet } from "lucide-react";
import { cn } from "@/utils/cn";
import { api, errorMessage, qs, useData } from "@/lib/api";
import { WriteOnly } from "@/lib/book";
import { dec, fmtDate, num, rp, today } from "@/lib/format";
import { go } from "@/lib/router";
import type { Account, Contact, Invoice, InvoiceDetail, InvoiceStatus, Seller } from "@/lib/types";
import { Page } from "@/components/Layout";
import { Badge, Button, Card, DataState, Empty, ErrorBox, Field, Input, Modal, MoneyInput, PageHeader, Segmented, Select, th, td, useFeedback } from "@/components/ui";

const STATUS: Record<InvoiceStatus, { label: string; tone: "neutral" | "warn" | "bad" | "good" }> = {
  unpaid: { label: "Belum dibayar", tone: "neutral" },
  partial: { label: "Dibayar sebagian", tone: "warn" },
  overdue: { label: "Terlambat", tone: "bad" },
  paid: { label: "Lunas", tone: "good" },
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone}>
      {status === "paid" && <CircleCheck className="h-3 w-3" aria-hidden />}
      {s.label}
    </Badge>
  );
}

// ───────────── Hitungan (sama persis dengan yang dipakai server) ─────────────

type Draft = { key: number; description: string; quantity: string; unitPrice: number };
let nextKey = 1;
const blankItem = (): Draft => ({ key: nextKey++, description: "", quantity: "1", unitPrice: 0 });
const toNumber = (text: string) => Number(String(text).trim().replace(",", "."));

export function calcTotals(items: { quantity: number; unitPrice: number }[], discount: number, taxPercent: number) {
  const subtotal = items.reduce((s, i) => s + Math.round(i.quantity * i.unitPrice), 0);
  const net = Math.max(subtotal - discount, 0);
  const tax = Math.round((net * Math.round(taxPercent * 100)) / 10_000);
  return { subtotal, net, tax, total: net + tax };
}

// ───────────── Formulir faktur ─────────────

function InvoiceForm({ open, edit, onClose, onSaved }: { open: boolean; edit: InvoiceDetail | null; onClose: () => void; onSaved: (id: number) => void }) {
  const { toast } = useFeedback();
  const accounts = useData<{ accounts: Account[] }>(open ? "/accounts" : null);
  const contacts = useData<{ contacts: Contact[] }>(open ? "/contacts" : null);
  const [issueDate, setIssueDate] = useState(today());
  const [dueDate, setDueDate] = useState("");
  const [number, setNumber] = useState("");
  const [contact, setContact] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [address, setAddress] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [items, setItems] = useState<Draft[]>([blankItem()]);
  const [discount, setDiscount] = useState(0);
  const [taxRate, setTaxRate] = useState("0");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggested = useData<{ number: string }>(open && !edit ? `/invoices/next-number${qs({ date: issueDate })}` : null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setIssueDate(edit?.issueDate ?? today());
    setDueDate(edit?.dueDate ?? "");
    setNumber(edit?.number ?? "");
    setContact(edit?.customer.id ? String(edit.customer.id) : "");
    setCustomerName("");
    setAddress(edit?.customer.address ?? "");
    setCategoryId(edit ? String(edit.category.id) : "");
    setItems(edit ? edit.items.map((i) => ({ key: nextKey++, description: i.description, quantity: String(i.quantity), unitPrice: i.unitPrice })) : [blankItem()]);
    setDiscount(edit?.discount ?? 0);
    setTaxRate(edit ? String(edit.taxRate) : "0");
    setNotes(edit?.notes ?? "");
  }, [open, edit]);

  const incomeAccounts = (accounts.data?.accounts ?? []).filter((a) => a.type === "income" && (!a.archived || String(a.id) === categoryId));
  useEffect(() => {
    if (open && !categoryId && incomeAccounts.length) setCategoryId(String((incomeAccounts.find((a) => a.subtype === "revenue") ?? incomeAccounts[0]).id));
  }, [open, categoryId, incomeAccounts]);

  const parsed = items.map((i) => ({ ...i, q: toNumber(i.quantity) }));
  const taxPercent = toNumber(taxRate) || 0;
  const totals = useMemo(() => calcTotals(parsed.map((i) => ({ quantity: Number.isFinite(i.q) ? i.q : 0, unitPrice: i.unitPrice })), discount, taxPercent), [parsed, discount, taxPercent]);
  const patch = (key: number, change: Partial<Draft>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...change } : i)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!contact && !customerName.trim()) return setError("Pelanggan belum dipilih atau diisi.");
    if (contact === "__new" && !customerName.trim()) return setError("Nama pelanggan baru belum diisi.");
    const filled = parsed.filter((i) => i.description.trim() || i.unitPrice);
    if (!filled.length) return setError("Isi minimal satu barang atau jasa.");
    if (filled.some((i) => !i.description.trim())) return setError("Ada baris yang uraiannya masih kosong.");
    if (filled.some((i) => !(i.q > 0))) return setError("Jumlah barang harus lebih dari 0.");
    if (filled.some((i) => !i.unitPrice)) return setError("Ada baris yang harganya masih kosong.");
    if (discount > totals.subtotal) return setError("Diskon tidak boleh lebih besar dari subtotal.");
    if (taxPercent < 0 || taxPercent > 100) return setError("Pajak harus antara 0 dan 100 persen.");
    const body = {
      number: number.trim() || undefined,
      issueDate,
      dueDate: dueDate || null,
      contactId: contact && contact !== "__new" ? Number(contact) : null,
      customerName: contact === "__new" || !contact ? customerName.trim() : undefined,
      customerAddress: address.trim() || null,
      categoryId: Number(categoryId),
      items: filled.map((i) => ({ description: i.description.trim(), quantity: i.q, unitPrice: i.unitPrice })),
      discount,
      taxRate: taxPercent,
      notes: notes.trim() || null,
    };
    setBusy(true);
    setError(null);
    try {
      let id = edit?.id ?? 0;
      if (edit) await api(`/invoices/${edit.id}`, { method: "PATCH", body });
      else id = (await api<{ id: number }>("/invoices", { method: "POST", body })).id;
      toast(edit ? "Faktur diperbarui." : "Faktur dibuat.");
      onSaved(id);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const people = contacts.data?.contacts ?? [];
  return (
    <Modal
      wide
      open={open}
      onClose={onClose}
      title={edit ? `Ubah faktur ${edit.number}` : "Buat faktur"}
      description="Faktur otomatis tercatat sebagai piutang. Saat pelanggan membayar, catat pembayarannya di halaman faktur."
      footer={
        <>
          <p className="tnum mr-auto text-sm text-muted">
            Total <span className="text-lg font-bold text-ink">{rp(totals.total)}</span>
          </p>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" form="invoice-form" loading={busy}>
            {edit ? "Simpan perubahan" : "Buat faktur"}
          </Button>
        </>
      }
    >
      <form id="invoice-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <ErrorBox message={error} />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Pelanggan">
            {(id) => (
              <Select id={id} value={contact} onChange={(e) => setContact(e.target.value)}>
                <option value="">Ketik nama pelanggan baru…</option>
                {people.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {!contact && <Field label="Nama pelanggan">{(id) => <Input id={id} value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={80} placeholder="Contoh: PT Maju Jaya" />}</Field>}
        </div>
        <Field label="Alamat pelanggan" hint="Boleh dikosongkan. Muncul di faktur.">
          {(id) => <Input id={id} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} />}
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Tanggal faktur">{(id) => <Input id={id} type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required />}</Field>
          <Field label="Jatuh tempo" hint="Boleh dikosongkan.">
            {(id) => <Input id={id} type="date" value={dueDate} min={issueDate} onChange={(e) => setDueDate(e.target.value)} />}
          </Field>
          <Field label="Nomor faktur" hint={edit ? undefined : "Kosongkan untuk nomor otomatis."}>
            {(id) => <Input id={id} value={number} onChange={(e) => setNumber(e.target.value)} maxLength={40} placeholder={suggested.data?.number ?? "INV-…"} />}
          </Field>
        </div>
        <Field label="Masuk sebagai pendapatan" hint="Kategori pendapatan yang dipakai di laporan laba rugi.">
          {(id) => (
            <Select id={id} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {incomeAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div>
          <p className="mb-1.5 text-[13px] font-semibold">Barang / jasa</p>
          <div className="mb-1.5 hidden grid-cols-[minmax(0,1fr)_5.5rem_10rem_8.5rem_2.25rem] gap-2 px-0.5 text-xs font-semibold text-muted sm:grid">
            <span>Uraian</span>
            <span>Jumlah</span>
            <span>Harga satuan</span>
            <span className="text-right">Subtotal</span>
            <span />
          </div>
          <ul className="space-y-2">
            {parsed.map((i, n) => (
              <li key={i.key} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 rounded-2xl border border-line p-2 sm:grid-cols-[minmax(0,1fr)_5.5rem_10rem_8.5rem_2.25rem] sm:items-center sm:rounded-none sm:border-0 sm:p-0">
                <Input aria-label={`Uraian baris ${n + 1}`} placeholder="Contoh: Jasa desain logo" value={i.description} onChange={(e) => patch(i.key, { description: e.target.value })} maxLength={200} className="col-span-2 sm:col-span-1" />
                <Input aria-label={`Jumlah baris ${n + 1}`} inputMode="decimal" value={i.quantity} onChange={(e) => patch(i.key, { quantity: e.target.value.replace(/[^0-9.,]/g, "") })} className="tnum" />
                <MoneyInput ariaLabel={`Harga satuan baris ${n + 1}`} value={i.unitPrice} onChange={(v) => patch(i.key, { unitPrice: v })} />
                <p className="tnum col-span-2 text-right text-sm font-semibold sm:col-span-1" aria-label={`Subtotal baris ${n + 1}`}>
                  {rp(Math.round((Number.isFinite(i.q) ? i.q : 0) * i.unitPrice))}
                </p>
                <Button variant="ghost" size="icon" className="col-span-2 h-9 w-full sm:col-span-1 sm:w-9" aria-label={`Hapus baris ${n + 1}`} disabled={items.length <= 1} onClick={() => setItems((list) => list.filter((x) => x.key !== i.key))}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => setItems((list) => [...list, blankItem()])} disabled={items.length >= 100}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Tambah baris
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="space-y-4">
            <Field label="Diskon (Rp)" hint="Boleh dikosongkan.">
              {(id) => <MoneyInput id={id} value={discount} onChange={setDiscount} />}
            </Field>
            <Field label="Pajak (%)" hint="Isi 11 untuk PPN 11%. Kosongkan kalau tanpa pajak.">
              {(id) => (
                <div className="flex gap-2">
                  <Input id={id} inputMode="decimal" value={taxRate} onChange={(e) => setTaxRate(e.target.value.replace(/[^0-9.,]/g, ""))} className="tnum" />
                  <Button variant="secondary" size="sm" className="h-10" onClick={() => setTaxRate("11")}>
                    PPN 11%
                  </Button>
                  <Button variant="secondary" size="sm" className="h-10" onClick={() => setTaxRate("0")}>
                    Tanpa
                  </Button>
                </div>
              )}
            </Field>
          </div>
          <dl className="tnum space-y-1.5 rounded-2xl bg-paper p-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Subtotal</dt>
              <dd className="font-semibold">{rp(totals.subtotal)}</dd>
            </div>
            {discount > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted">Diskon</dt>
                <dd className="font-semibold">-{rp(discount)}</dd>
              </div>
            )}
            {taxPercent > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted">Pajak {dec(taxPercent)}%</dt>
                <dd className="font-semibold">{rp(totals.tax)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-line-strong pt-2 text-base">
              <dt className="font-bold">Total</dt>
              <dd className="font-bold">{rp(totals.total)}</dd>
            </div>
          </dl>
        </div>
        <Field label="Catatan di faktur" hint="Boleh dikosongkan. Contoh: terima kasih, syarat pembayaran.">
          {(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />}
        </Field>
      </form>
    </Modal>
  );
}

// ───────────── Daftar faktur ─────────────

type ListData = { items: Invoice[]; totals: { unpaid: number; overdue: number; count: number } };

export function InvoicesPage() {
  const [status, setStatus] = useState<"all" | "open" | "overdue" | "paid">("all");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const state = useData<ListData>(`/invoices${qs({ status, q, today: today() })}`);

  return (
    <Page>
      <PageHeader title="Faktur" description="Buat faktur untuk pelanggan, cetak atau simpan sebagai PDF, lalu catat saat mereka membayar. Setiap faktur otomatis menjadi piutang.">
        <WriteOnly>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Buat faktur
          </Button>
        </WriteOnly>
      </PageHeader>

      <DataState state={state}>
        {(data) => (
          <>
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Card className="p-5">
                <p className="text-sm font-medium text-muted">Belum dibayar</p>
                <p className="tnum mt-1 text-2xl font-semibold tracking-tight">{rp(data.totals.unpaid)}</p>
              </Card>
              <Card className="p-5">
                <p className="text-sm font-medium text-muted">Sudah lewat jatuh tempo</p>
                <p className={cn("tnum mt-1 text-2xl font-semibold tracking-tight", data.totals.overdue > 0 && "text-bad")}>{rp(data.totals.overdue)}</p>
              </Card>
              <Card className="p-5">
                <p className="text-sm font-medium text-muted">Jumlah faktur</p>
                <p className="tnum mt-1 text-2xl font-semibold tracking-tight">{num(data.totals.count)}</p>
              </Card>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Segmented
                label="Status faktur"
                value={status}
                onChange={setStatus}
                options={[
                  { value: "all", label: "Semua" },
                  { value: "open", label: "Belum lunas" },
                  { value: "overdue", label: "Terlambat" },
                  { value: "paid", label: "Lunas" },
                ]}
              />
              <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                <Input aria-label="Cari faktur" placeholder="Cari nomor atau pelanggan" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
              </div>
            </div>

            <Card>
              {data.items.length === 0 ? (
                <Empty
                  icon={<Receipt className="h-5 w-5" aria-hidden />}
                  title={q || status !== "all" ? "Tidak ada faktur yang cocok" : "Belum ada faktur"}
                  text={q || status !== "all" ? "Coba ubah kata pencarian atau saringannya." : "Buat faktur pertamamu. Nomornya otomatis berurutan, dan piutangnya langsung tercatat."}
                />
              ) : (
                <>
                  <div className="hidden overflow-x-auto xl:block">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-line">
                          <th scope="col" className={th}>Nomor</th>
                          <th scope="col" className={th}>Pelanggan</th>
                          <th scope="col" className={th}>Tanggal</th>
                          <th scope="col" className={th}>Jatuh tempo</th>
                          <th scope="col" className={`${th} text-right`}>Total</th>
                          <th scope="col" className={`${th} text-right`}>Sisa</th>
                          <th scope="col" className={th}>Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {data.items.map((i) => (
                          <tr key={i.id} className="hover:bg-paper/50">
                            <td className={`${td} font-semibold whitespace-nowrap`}>
                              <a href={`#/faktur/${i.id}`} className="underline-offset-2 hover:underline">
                                {i.number}
                              </a>
                            </td>
                            <td className={`${td} max-w-[14rem] truncate`}>{i.customer.name}</td>
                            <td className={`${td} tnum whitespace-nowrap text-muted`}>{fmtDate(i.issueDate)}</td>
                            <td className={`${td} tnum whitespace-nowrap text-muted`}>{i.dueDate ? fmtDate(i.dueDate) : "-"}</td>
                            <td className={`${td} tnum text-right`}>{rp(i.total)}</td>
                            <td className={`${td} tnum text-right font-semibold`}>{rp(i.remaining)}</td>
                            <td className={td}>
                              <StatusBadge status={i.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <ul className="divide-y divide-line xl:hidden">
                    {data.items.map((i) => (
                      <li key={i.id}>
                        <a href={`#/faktur/${i.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-paper/50">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">
                              {i.number} · {i.customer.name}
                            </p>
                            <p className="text-[13px] text-muted">
                              {fmtDate(i.issueDate)}
                              {i.dueDate ? ` · jatuh tempo ${fmtDate(i.dueDate)}` : ""}
                            </p>
                            <p className="tnum mt-0.5 text-sm font-semibold">{rp(i.total)}</p>
                          </div>
                          <StatusBadge status={i.status} />
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          </>
        )}
      </DataState>

      <InvoiceForm open={creating} edit={null} onClose={() => setCreating(false)} onSaved={(id) => go(`/faktur/${id}`)} />
    </Page>
  );
}

// ───────────── Pembayaran faktur ─────────────

function PayModal({ invoice, onClose, onSaved }: { invoice: InvoiceDetail | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useFeedback();
  const accounts = useData<{ accounts: Account[] }>(invoice ? "/accounts" : null);
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(today());
  const [cashId, setCashId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wallets = (accounts.data?.accounts ?? []).filter((a) => a.subtype === "cash" && !a.archived);

  useEffect(() => {
    if (!invoice) return;
    setAmount(invoice.remaining);
    setDate(today() < invoice.issueDate ? invoice.issueDate : today());
    setError(null);
  }, [invoice]);
  useEffect(() => {
    if (invoice && !cashId && wallets.length) setCashId(String(wallets[0].id));
  }, [invoice, cashId, wallets]);

  if (!invoice) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!amount) return setError("Jumlah belum diisi.");
    setBusy(true);
    setError(null);
    try {
      await api(`/invoices/${invoice!.id}/payments`, { method: "POST", body: { amount, date, cashAccountId: Number(cashId) } });
      toast(amount >= invoice!.remaining ? "Lunas! Pembayaran dicatat." : "Pembayaran dicatat.");
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
      title="Catat pembayaran"
      description={`${invoice.number} · ${invoice.customer.name} · sisa ${rp(invoice.remaining)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" form="invoice-pay-form" loading={busy}>
            Simpan
          </Button>
        </>
      }
    >
      <form id="invoice-pay-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <ErrorBox message={error} />}
        <Field label="Jumlah dibayar" hint={amount < invoice.remaining && amount > 0 ? `Dibayar sebagian. Sisa setelah ini ${rp(invoice.remaining - amount)}.` : "Sudah diisi sisa tagihan. Ubah kalau dibayar sebagian."}>
          {(id) => <MoneyInput id={id} value={amount} onChange={(n) => setAmount(Math.min(n, invoice.remaining))} autoFocus />}
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Tanggal">{(id) => <Input id={id} type="date" value={date} min={invoice.issueDate} onChange={(e) => setDate(e.target.value)} required />}</Field>
          <Field label="Masuk ke dompet">
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

// ───────────── Tampilan satu faktur (siap cetak) ─────────────

export function InvoiceViewPage({ id }: { id: string }) {
  const { toast, confirm } = useFeedback();
  const state = useData<{ invoice: InvoiceDetail; seller: Seller }>(`/invoices/${id}${qs({ today: today() })}`);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);

  async function remove(inv: InvoiceDetail) {
    const ok = await confirm({
      title: "Hapus faktur ini?",
      message: (
        <>
          Faktur <strong>{inv.number}</strong> ({rp(inv.total)}) dihapus beserta piutangnya
          {inv.payments.length ? ` dan ${inv.payments.length} pembayarannya, sehingga saldo dompet ikut menyesuaikan` : ""}. Tindakan ini tidak bisa dibatalkan.
        </>
      ),
      confirmLabel: "Hapus",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/invoices/${inv.id}`, { method: "DELETE" });
      toast("Faktur dihapus.");
      go("/faktur");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function removePayment(inv: InvoiceDetail, paymentId: number) {
    if (!inv.debtId) return;
    if (!(await confirm({ title: "Hapus pembayaran ini?", message: "Sisa tagihan faktur akan bertambah lagi sebesar pembayaran itu.", confirmLabel: "Hapus", danger: true }))) return;
    try {
      await api(`/debts/${inv.debtId}/payments/${paymentId}`, { method: "DELETE" });
      toast("Pembayaran dihapus.");
      state.reload();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  // Judul tab dipakai sebagai nama file saat "simpan sebagai PDF".
  function print(number: string) {
    const original = document.title;
    document.title = number;
    const restore = () => {
      document.title = original;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  }

  return (
    <Page className="max-w-4xl">
      <DataState state={state}>
        {({ invoice: inv, seller }) => (
          <>
            <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
              <a href="#/faktur" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
                <ArrowLeft className="h-4 w-4" aria-hidden /> Semua faktur
              </a>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => print(inv.number)}>
                  <Printer className="h-4 w-4" aria-hidden /> Cetak / simpan PDF
                </Button>
                <WriteOnly>
                  {inv.remaining > 0 && (
                    <Button onClick={() => setPaying(true)}>
                      <Wallet className="h-4 w-4" aria-hidden /> Catat pembayaran
                    </Button>
                  )}
                  {inv.paid === 0 && (
                    <Button variant="secondary" onClick={() => setEditing(true)}>
                      <Pencil className="h-4 w-4" aria-hidden /> Ubah
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => remove(inv)}>
                    <Trash2 className="h-4 w-4" aria-hidden /> Hapus
                  </Button>
                </WriteOnly>
              </div>
            </div>

            <Card className="print-plain p-6 sm:p-10">
              <header className="flex flex-wrap items-start justify-between gap-6 border-b border-line pb-6">
                <div className="min-w-0">
                  <h1 className="text-2xl font-extrabold tracking-tight wrap-anywhere">{seller.name}</h1>
                  {seller.address && <p className="mt-1 max-w-sm text-sm whitespace-pre-line text-muted wrap-anywhere">{seller.address}</p>}
                  {seller.phone && <p className="text-sm text-muted wrap-anywhere">Telp. {seller.phone}</p>}
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tracking-[0.2em] text-muted uppercase">Faktur</p>
                  <p className="tnum text-xl font-bold">{inv.number}</p>
                  <p className="no-print mt-1">
                    <StatusBadge status={inv.status} />
                  </p>
                </div>
              </header>

              <section className="grid grid-cols-1 gap-6 py-6 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold tracking-wide text-muted uppercase">Ditagihkan kepada</p>
                  <p className="mt-1 font-bold wrap-anywhere">{inv.customer.name}</p>
                  {inv.customer.address && <p className="text-sm whitespace-pre-line text-muted wrap-anywhere">{inv.customer.address}</p>}
                  {inv.customer.phone && <p className="text-sm text-muted wrap-anywhere">{inv.customer.phone}</p>}
                  {inv.customer.email && <p className="text-sm text-muted wrap-anywhere">{inv.customer.email}</p>}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm sm:justify-self-end">
                  <dt className="text-muted">Tanggal faktur</dt>
                  <dd className="tnum text-right font-semibold">{fmtDate(inv.issueDate)}</dd>
                  <dt className="text-muted">Jatuh tempo</dt>
                  <dd className="tnum text-right font-semibold">{inv.dueDate ? fmtDate(inv.dueDate) : "-"}</dd>
                </dl>
              </section>

              {/* HP: tiap uraian jadi satu baris kartu. Tabel tetap dipakai di layar lebar dan saat dicetak. */}
              <ul className="divide-y divide-line border-y border-line-strong md:hidden print:hidden">
                {inv.items.map((i, n) => (
                  <li key={n} className="py-3 text-sm">
                    <p className="wrap-anywhere">{i.description}</p>
                    <p className="tnum mt-1 flex items-baseline justify-between gap-3 text-muted">
                      <span>
                        {dec(i.quantity)} × {rp(i.unitPrice)}
                      </span>
                      <span className="font-semibold whitespace-nowrap text-ink">{rp(i.amount)}</span>
                    </p>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto md:block print:block">
                <table className="w-full min-w-[32rem] text-sm">
                  <thead>
                    <tr className="border-y border-line-strong">
                      <th scope="col" className={th}>Uraian</th>
                      <th scope="col" className={`${th} text-right`}>Jumlah</th>
                      <th scope="col" className={`${th} text-right`}>Harga</th>
                      <th scope="col" className={`${th} text-right`}>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {inv.items.map((i, n) => (
                      <tr key={n}>
                        <td className={`${td} wrap-anywhere`}>{i.description}</td>
                        <td className={`${td} tnum text-right`}>{dec(i.quantity)}</td>
                        <td className={`${td} tnum text-right`}>{rp(i.unitPrice)}</td>
                        <td className={`${td} tnum text-right font-semibold`}>{rp(i.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <dl className="tnum mt-4 ml-auto w-full max-w-xs space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">Subtotal</dt>
                  <dd className="font-semibold">{rp(inv.subtotal)}</dd>
                </div>
                {inv.discount > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted">Diskon</dt>
                    <dd className="font-semibold">-{rp(inv.discount)}</dd>
                  </div>
                )}
                {inv.taxRate > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted">Pajak {dec(inv.taxRate)}%</dt>
                    <dd className="font-semibold">{rp(inv.tax)}</dd>
                  </div>
                )}
                <div className="flex justify-between border-t border-line-strong pt-2 text-base">
                  <dt className="font-bold">Total</dt>
                  <dd className="font-bold">{rp(inv.total)}</dd>
                </div>
                {inv.paid > 0 && (
                  <>
                    <div className="flex justify-between">
                      <dt className="text-muted">Sudah dibayar</dt>
                      <dd className="font-semibold">-{rp(inv.paid)}</dd>
                    </div>
                    <div className="flex justify-between text-base">
                      <dt className="font-bold">Sisa tagihan</dt>
                      <dd className="font-bold">{rp(inv.remaining)}</dd>
                    </div>
                  </>
                )}
              </dl>

              {(inv.notes || seller.paymentInfo) && (
                <section className="mt-8 grid grid-cols-1 gap-6 border-t border-line pt-6 text-sm sm:grid-cols-2">
                  {seller.paymentInfo && (
                    <div>
                      <p className="text-xs font-semibold tracking-wide text-muted uppercase">Pembayaran ke</p>
                      <p className="mt-1 whitespace-pre-line wrap-anywhere">{seller.paymentInfo}</p>
                    </div>
                  )}
                  {inv.notes && (
                    <div>
                      <p className="text-xs font-semibold tracking-wide text-muted uppercase">Catatan</p>
                      <p className="mt-1 whitespace-pre-line wrap-anywhere">{inv.notes}</p>
                    </div>
                  )}
                </section>
              )}
            </Card>

            {inv.payments.length > 0 && (
              <Card className="no-print mt-6 p-5">
                <h2 className="font-bold tracking-tight">Riwayat pembayaran</h2>
                <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
                  {inv.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="text-muted">{fmtDate(p.date)}</span>
                      <span className="flex items-center gap-2">
                        <span className="tnum font-semibold">{rp(p.amount)}</span>
                        <WriteOnly>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Hapus pembayaran ${fmtDate(p.date)}`} onClick={() => removePayment(inv, p.id)}>
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        </WriteOnly>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[13px] text-muted">
                  Pembayaran faktur juga tercatat di <a href="#/utang-piutang" className="font-semibold underline underline-offset-2">Utang &amp; Piutang</a>.
                </p>
              </Card>
            )}

            <InvoiceForm open={editing} edit={inv} onClose={() => setEditing(false)} onSaved={() => state.reload()} />
            <PayModal invoice={paying ? inv : null} onClose={() => setPaying(false)} onSaved={state.reload} />
          </>
        )}
      </DataState>
    </Page>
  );
}
