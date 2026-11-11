// Potongan tampilan yang dipakai di beberapa halaman: label jenis, jumlah uang, form transaksi.
import { useEffect, useState, type FormEvent } from "react";
import { ArrowDownLeft, ArrowUpRight, Repeat2 } from "lucide-react";
import { cn } from "@/utils/cn";
import { api, errorMessage, useData } from "@/lib/api";
import { rp, today } from "@/lib/format";
import { KIND_LABEL, type Account, type Contact, type Entry, type EntryKind } from "@/lib/types";
import { Badge, Button, ErrorBox, Field, Input, Modal, MoneyInput, Segmented, Select, useFeedback } from "./ui";

export function KindBadge({ kind }: { kind: EntryKind }) {
  const tone = kind === "income" ? "masuk" : kind === "expense" ? "keluar" : "neutral";
  return <Badge tone={tone}>{KIND_LABEL[kind]}</Badge>;
}

/** Ikon bulat penanda arah uang: masuk (biru), keluar (oranye), lainnya (abu). */
export function KindIcon({ kind }: { kind: EntryKind }) {
  const incoming = kind === "income" || kind === "capital_in";
  const outgoing = kind === "expense" || kind === "drawing";
  const Icon = incoming ? ArrowDownLeft : outgoing ? ArrowUpRight : Repeat2;
  return (
    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", incoming ? "bg-masuk-soft text-[#1c5cab]" : outgoing ? "bg-keluar-soft text-[#a8431a]" : "bg-paper text-muted")} aria-hidden>
      <Icon className="h-4 w-4" />
    </span>
  );
}

/** Jumlah dengan tanda: +Rp untuk uang masuk, -Rp untuk uang keluar. */
export function Amount({ kind, amount, className }: { kind: EntryKind; amount: number; className?: string }) {
  const sign = kind === "income" || kind === "capital_in" ? "+" : kind === "expense" || kind === "drawing" ? "-" : "";
  return <span className={cn("tnum font-semibold whitespace-nowrap", className)}>{`${sign}${rp(amount)}`}</span>;
}

export type SimpleKind = "income" | "expense" | "transfer" | "capital_in" | "drawing";

const KIND_OPTIONS: { value: SimpleKind; label: string }[] = [
  { value: "expense", label: "Pengeluaran" },
  { value: "income", label: "Pemasukan" },
  { value: "transfer", label: "Transfer" },
  { value: "capital_in", label: "Setor modal" },
  { value: "drawing", label: "Prive" },
];

const KIND_HINT: Record<SimpleKind, string> = {
  expense: "Uang keluar untuk membayar sesuatu.",
  income: "Uang masuk dari gaji, penjualan, atau sumber lain.",
  transfer: "Memindahkan uang antar dompet, misalnya tarik tunai dari bank ke kas.",
  capital_in: "Pemilik menambah uang ke pembukuan (bukan pendapatan).",
  drawing: "Pemilik mengambil uang untuk keperluan pribadi (bukan beban usaha).",
};

export function TransactionForm({ open, onClose, onSaved, edit, defaultKind = "expense" }: { open: boolean; onClose: () => void; onSaved: () => void; edit?: Entry | null; defaultKind?: SimpleKind }) {
  const { toast } = useFeedback();
  const accounts = useData<{ accounts: Account[] }>(open ? "/accounts" : null);
  const contacts = useData<{ contacts: Contact[] }>(open ? "/contacts" : null);
  const [kind, setKind] = useState<SimpleKind>(defaultKind);
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [cashId, setCashId] = useState("");
  const [toId, setToId] = useState("");
  const [contactId, setContactId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setKind((edit?.kind as SimpleKind) ?? defaultKind);
    setAmount(edit?.amount ?? 0);
    setDate(edit?.date ?? today());
    setDescription(edit?.description ?? "");
    setCategoryId(edit?.category ? String(edit.category.id) : "");
    setCashId(edit?.cashAccount ? String(edit.cashAccount.id) : "");
    setToId(edit?.toAccount ? String(edit.toAccount.id) : "");
    setContactId(edit?.contact ? String(edit.contact.id) : "");
  }, [open, edit, defaultKind]);

  const all = accounts.data?.accounts ?? [];
  const usable = (a: Account, selected: string) => !a.archived || String(a.id) === selected;
  const wallets = all.filter((a) => a.subtype === "cash" && usable(a, cashId));
  const categories = all.filter((a) => a.type === (kind === "income" ? "income" : "expense") && usable(a, categoryId));
  const needsCategory = kind === "income" || kind === "expense";

  // Dompet pertama dipilih otomatis supaya pengisian lebih cepat.
  useEffect(() => {
    if (open && !cashId && wallets.length) setCashId(String(wallets[0].id));
  }, [open, cashId, wallets]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!amount) return setError("Jumlah belum diisi.");
    if (needsCategory && !categoryId) return setError("Pilih kategorinya dulu.");
    if (kind === "transfer" && !toId) return setError("Pilih dompet tujuan.");
    const category = all.find((a) => String(a.id) === categoryId);
    const body = {
      kind,
      amount,
      date,
      description: description.trim() || (needsCategory ? category?.name : KIND_LABEL[kind]) || KIND_LABEL[kind],
      categoryId: needsCategory ? Number(categoryId) : undefined,
      cashAccountId: Number(cashId),
      toAccountId: kind === "transfer" ? Number(toId) : undefined,
      contactId: contactId ? Number(contactId) : null,
    };
    setBusy(true);
    setError(null);
    try {
      if (edit) await api(`/transactions/${edit.id}`, { method: "PATCH", body });
      else await api("/transactions", { method: "POST", body });
      toast(edit ? "Perubahan tersimpan." : "Transaksi tersimpan.");
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
      title={edit ? "Ubah transaksi" : "Tambah transaksi"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" form="tx-form" loading={busy}>
            Simpan
          </Button>
        </>
      }
    >
      <form id="tx-form" onSubmit={submit} className="space-y-4" noValidate>
        {!edit && (
          <div>
            <Segmented
              label="Jenis transaksi"
              options={KIND_OPTIONS}
              value={kind}
              onChange={(k) => {
                setKind(k);
                setCategoryId("");
              }}
            />
            <p className="mt-2 text-[13px] text-muted">{KIND_HINT[kind]}</p>
          </div>
        )}
        {error && <ErrorBox message={error} />}
        {accounts.error && <ErrorBox message={accounts.error} onRetry={accounts.reload} />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Jumlah">{(id) => <MoneyInput id={id} value={amount} onChange={setAmount} autoFocus />}</Field>
          <Field label="Tanggal">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />}</Field>
        </div>
        {needsCategory && (
          <Field
            label="Kategori"
            hint={
              <>
                Belum ada yang cocok?{" "}
                <a href="#/akun" className="font-semibold text-ink underline underline-offset-2">
                  Tambah kategori
                </a>
              </>
            }
          >
            {(id) => (
              <Select id={id} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
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
        <div className={cn("grid grid-cols-1 gap-4", kind === "transfer" && "sm:grid-cols-2")}>
          <Field label={kind === "transfer" ? "Dari dompet" : kind === "income" || kind === "capital_in" ? "Masuk ke dompet" : "Dibayar dari dompet"}>
            {(id) => (
              <Select id={id} value={cashId} onChange={(e) => setCashId(e.target.value)} required>
                {wallets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {rp(a.balance)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {kind === "transfer" && (
            <Field label="Ke dompet">
              {(id) => (
                <Select id={id} value={toId} onChange={(e) => setToId(e.target.value)} required>
                  <option value="">Pilih dompet…</option>
                  {all
                    .filter((a) => a.subtype === "cash" && String(a.id) !== cashId && usable(a, toId))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {rp(a.balance)}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          )}
        </div>
        <Field label="Keterangan" hint="Boleh dikosongkan.">
          {(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Contoh: makan siang, bayar listrik" maxLength={200} />}
        </Field>
        {(contacts.data?.contacts.length ?? 0) > 0 && (
          <Field label="Kontak terkait" hint="Opsional. Misalnya pelanggan atau pemasok.">
            {(id) => (
              <Select id={id} value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">Tidak ada</option>
                {contacts.data!.contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </form>
    </Modal>
  );
}
