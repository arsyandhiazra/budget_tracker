// Halaman Jurnal Umum: semua catatan dalam bentuk debit-kredit, plus jurnal manual.
import { useEffect, useState, type FormEvent } from "react";
import { CircleAlert, CircleCheck, HandCoins, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/utils/cn";
import { api, errorMessage, qs, useData } from "@/lib/api";
import { WriteOnly } from "@/lib/book";
import { fmtDate, rp, today } from "@/lib/format";
import { makePeriod } from "@/lib/period";
import { TYPE_LABEL, type Account, type AccountType, type Contact, type Entry } from "@/lib/types";
import { Page } from "@/components/Layout";
import { PeriodPicker } from "@/components/PeriodPicker";
import { Button, Card, DataState, Empty, ErrorBox, Field, Input, Modal, MoneyInput, PageHeader, Select, useFeedback } from "@/components/ui";
import { JournalTable } from "./Reports";

type DraftLine = { key: number; accountId: string; debit: number; credit: number };
const TYPES: AccountType[] = ["asset", "liability", "equity", "income", "expense"];
// Akun yang dianggap utang/piutang (sama dengan aturan di server): jurnal yang menyentuhnya
// otomatis tercatat juga di menu Utang & Piutang.
const isDebtAccount = (a: Account) => (a.type === "liability" && (a.subtype === "payable" || a.subtype === "loan")) || (a.type === "asset" && a.subtype === "receivable");
let nextKey = 1;
const blank = (): DraftLine => ({ key: nextKey++, accountId: "", debit: 0, credit: 0 });

function JournalForm({ open, edit, onClose, onSaved }: { open: boolean; edit: Entry | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useFeedback();
  const accounts = useData<{ accounts: Account[] }>(open ? "/accounts" : null);
  const contacts = useData<{ contacts: Contact[] }>(open ? "/contacts" : null);
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState("");
  const [contactId, setContactId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blank(), blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDate(edit?.date ?? today());
    setDescription(edit?.description ?? "");
    setContactId(edit?.contact ? String(edit.contact.id) : "");
    setDueDate(edit?.debts?.[0]?.dueDate ?? "");
    setLines(edit ? edit.lines.map((l) => ({ key: nextKey++, accountId: String(l.accountId), debit: l.debit, credit: l.credit })) : [blank(), blank()]);
  }, [open, edit]);

  const all = accounts.data?.accounts ?? [];
  const debtIds = new Set(all.filter(isDebtAccount).map((a) => String(a.id)));
  const touchesDebt = lines.some((l) => debtIds.has(l.accountId));
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  const balanced = totalDebit === totalCredit && totalDebit > 0;
  const patch = (key: number, change: Partial<DraftLine>) => setLines((list) => list.map((l) => (l.key === key ? { ...l, ...change } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const filled = lines.filter((l) => l.accountId || l.debit || l.credit);
    if (!description.trim()) return setError("Keterangan belum diisi.");
    if (filled.length < 2) return setError("Isi minimal dua baris.");
    if (filled.some((l) => !l.accountId)) return setError("Ada baris yang akunnya belum dipilih.");
    if (filled.some((l) => !l.debit && !l.credit)) return setError("Ada baris yang jumlahnya masih kosong.");
    if (!balanced) return setError("Total debit dan kredit harus sama.");
    const body = {
      date,
      description,
      lines: filled.map((l) => ({ accountId: Number(l.accountId), debit: l.debit, credit: l.credit })),
      // Kontak & jatuh tempo hanya ditanyakan untuk jurnal utang/piutang; kontak lama tetap dipertahankan kalau tidak.
      contactId: touchesDebt ? (contactId ? Number(contactId) : null) : (edit?.contact?.id ?? null),
      ...(touchesDebt ? { dueDate: dueDate || null } : {}),
    };
    setBusy(true);
    setError(null);
    try {
      if (edit) await api(`/journal/${edit.id}`, { method: "PATCH", body });
      else await api("/journal", { method: "POST", body });
      toast(edit ? "Jurnal diperbarui." : "Jurnal tersimpan.");
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
      wide
      open={open}
      onClose={onClose}
      title={edit ? "Ubah jurnal" : "Tambah jurnal manual"}
      description="Untuk transaksi khusus yang tidak ada di form biasa, misalnya membeli peralatan dengan mencicil."
      footer={
        <>
          <p className={cn("mr-auto flex items-center gap-1.5 text-[13px] font-semibold", balanced ? "text-good" : "text-bad")} aria-live="polite">
            {balanced ? <CircleCheck className="h-4 w-4" aria-hidden /> : <CircleAlert className="h-4 w-4" aria-hidden />}
            {balanced ? "Seimbang" : totalDebit === totalCredit ? "Belum ada jumlah" : `Selisih ${rp(Math.abs(totalDebit - totalCredit))}`}
          </p>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" form="journal-form" loading={busy}>
            Simpan
          </Button>
        </>
      }
    >
      <form id="journal-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <ErrorBox message={error} />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[11rem_1fr]">
          <Field label="Tanggal">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />}</Field>
          <Field label="Keterangan">{(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="Contoh: beli etalase, sebagian dicicil" autoFocus />}</Field>
        </div>

        <div>
          <div className="mb-1.5 hidden grid-cols-[minmax(0,1fr)_9.5rem_9.5rem_2.25rem] gap-2 text-[13px] font-semibold sm:grid">
            <span>Akun</span>
            <span>Debit</span>
            <span>Kredit</span>
            <span />
          </div>
          <ul className="space-y-2">
            {lines.map((l, i) => (
              <li key={l.key} className="grid grid-cols-2 gap-2 rounded-2xl border border-line p-2 sm:grid-cols-[minmax(0,1fr)_9.5rem_9.5rem_2.25rem] sm:rounded-none sm:border-0 sm:p-0">
                <Select aria-label={`Akun baris ${i + 1}`} value={l.accountId} onChange={(e) => patch(l.key, { accountId: e.target.value })} className="col-span-2 sm:col-span-1">
                  <option value="">Pilih akun…</option>
                  {TYPES.map((t) => (
                    <optgroup key={t} label={TYPE_LABEL[t]}>
                      {all
                        .filter((a) => a.type === t && (!a.archived || String(a.id) === l.accountId))
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} · {a.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </Select>
                <MoneyInput ariaLabel={`Debit baris ${i + 1}`} placeholder="Debit" value={l.debit} onChange={(n) => patch(l.key, { debit: n, credit: n ? 0 : l.credit })} />
                <MoneyInput ariaLabel={`Kredit baris ${i + 1}`} placeholder="Kredit" value={l.credit} onChange={(n) => patch(l.key, { credit: n, debit: n ? 0 : l.debit })} />
                <Button variant="ghost" size="icon" className="col-span-2 h-10 w-full sm:col-span-1 sm:w-9" aria-label={`Hapus baris ${i + 1}`} disabled={lines.length <= 2} onClick={() => setLines((list) => list.filter((x) => x.key !== l.key))}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <Button variant="secondary" size="sm" onClick={() => setLines((list) => [...list, blank()])} disabled={lines.length >= 40}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> Tambah baris
            </Button>
            <p className="tnum text-[13px] text-muted">
              Total debit <span className="font-semibold text-ink">{rp(totalDebit)}</span> · kredit <span className="font-semibold text-ink">{rp(totalCredit)}</span>
            </p>
          </div>
        </div>
        {touchesDebt && (
          <div className="rounded-2xl border border-masuk/40 bg-masuk-soft p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <HandCoins className="h-4 w-4 text-masuk-ink" aria-hidden /> Jurnal ini menyentuh akun utang/piutang
            </p>
            <p className="mt-1 text-[13px] text-ink-soft">
              Otomatis tercatat juga di menu <strong>Utang & Piutang</strong>. Kalau jurnal ini berupa pembayaran, jumlahnya memotong utang yang paling lama (atau milik kontak yang dipilih).
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Kontak" hint="Boleh dikosongkan.">
                {(id) => (
                  <Select id={id} value={contactId} onChange={(e) => setContactId(e.target.value)}>
                    <option value="">Tanpa nama</option>
                    {(contacts.data?.contacts ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Jatuh tempo" hint="Untuk utang/piutang baru. Boleh dikosongkan.">
                {(id) => <Input id={id} type="date" value={dueDate} min={date} onChange={(e) => setDueDate(e.target.value)} />}
              </Field>
            </div>
          </div>
        )}
        <p className="rounded-2xl bg-paper px-4 py-3 text-[13px] text-ink-soft">
          <strong>Cara gampang mengingatnya:</strong> harta atau beban yang <em>bertambah</em> ditulis di debit. Utang, modal, atau pendapatan yang <em>bertambah</em> ditulis di kredit. Kalau berkurang, kebalikannya.
        </p>
      </form>
    </Modal>
  );
}

export function JournalPage() {
  const { toast, confirm } = useFeedback();
  const [period, setPeriod] = useState(() => makePeriod("this-month"));
  const state = useData<{ entries: Entry[]; totalDebit: number; totalCredit: number; truncated: boolean }>(`/reports/journal${qs({ from: period.from, to: period.to })}`);
  const [form, setForm] = useState<{ open: boolean; edit: Entry | null }>({ open: false, edit: null });

  async function remove(e: Entry) {
    const ok = await confirm({
      title: "Hapus jurnal ini?",
      message: (
        <>
          <strong>{e.description}</strong> ({fmtDate(e.date)}) akan dihapus dan saldo akun ikut menyesuaikan. Tindakan ini tidak bisa dibatalkan.
        </>
      ),
      confirmLabel: "Hapus",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/entries/${e.id}`, { method: "DELETE" });
      toast("Jurnal dihapus.");
      state.reload();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  const actions = (e: Entry) => {
    if (e.kind === "debt" || e.kind === "debt_payment") {
      return (
        <a href="#/utang-piutang" className="text-[13px] font-semibold text-muted underline underline-offset-2 hover:text-ink">
          Kelola
        </a>
      );
    }
    const editable = e.kind === "manual" || e.kind === "opening";
    return (
      <span className="inline-flex">
        {e.debts && e.debts.length > 0 && (
          <a href="#/utang-piutang" title="Tercatat juga di Utang & Piutang" aria-label={`${e.description} tercatat di Utang & Piutang`} className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-masuk-ink hover:bg-paper">
            <HandCoins className="h-4 w-4" aria-hidden />
          </a>
        )}
        <WriteOnly>
          {editable ? (
            <Button variant="ghost" size="icon" aria-label={`Ubah ${e.description}`} title="Ubah" onClick={() => setForm({ open: true, edit: e })}>
              <Pencil className="h-4 w-4" aria-hidden />
            </Button>
          ) : (
            <a href="#/transaksi" title="Ubah di halaman Transaksi" aria-label={`Ubah ${e.description} di halaman Transaksi`} className="inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-paper">
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
      <PageHeader title="Jurnal Umum" description="Setiap transaksi otomatis ditulis di sini sebagai debit dan kredit. Kamu juga bisa menambah jurnal manual untuk transaksi khusus.">
        <PeriodPicker value={period} onChange={setPeriod} />
        <WriteOnly>
          <Button onClick={() => setForm({ open: true, edit: null })}>
            <Plus className="h-4 w-4" aria-hidden /> Tambah jurnal
          </Button>
        </WriteOnly>
      </PageHeader>
      <DataState state={state}>
        {(data) => (
          <Card className="p-5 sm:p-6">
            {data.entries.length ? (
              <>
                <JournalTable entries={data.entries} totalDebit={data.totalDebit} totalCredit={data.totalCredit} actions={actions} />
                {data.truncated && <p className="mt-4 text-[13px] text-muted">Hanya 2.000 catatan pertama yang ditampilkan. Persempit rentang waktunya untuk melihat sisanya.</p>}
              </>
            ) : (
              <Empty title="Belum ada jurnal pada periode ini" text="Catatan dari halaman Transaksi dan Utang & Piutang otomatis muncul di sini." />
            )}
          </Card>
        )}
      </DataState>
      <JournalForm open={form.open} edit={form.edit} onClose={() => setForm((f) => ({ ...f, open: false }))} onSaved={state.reload} />
    </Page>
  );
}
