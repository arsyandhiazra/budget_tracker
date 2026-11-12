// Halaman Daftar Akun: dompet, kategori pemasukan/pengeluaran, utang, modal.
import { useEffect, useState, type FormEvent } from "react";
import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from "lucide-react";
import { WriteOnly } from "@/lib/book";
import { api, errorMessage, useData } from "@/lib/api";
import { rp } from "@/lib/format";
import { SUBTYPE_LABEL, SUBTYPES, TYPE_LABEL, type Account, type AccountType } from "@/lib/types";
import { Page } from "@/components/Layout";
import { Badge, Button, Card, DataState, ErrorBox, Field, Input, Modal, PageHeader, Select, td, th, useFeedback } from "@/components/ui";

const GROUPS: { type: AccountType; title: string; about: string }[] = [
  { type: "asset", title: "Aset (harta)", about: "Yang kamu miliki: uang di dompet/bank, piutang, barang, peralatan." },
  { type: "liability", title: "Kewajiban (utang)", about: "Yang harus kamu bayar ke pihak lain." },
  { type: "equity", title: "Modal", about: "Bagian milik pemilik sendiri." },
  { type: "income", title: "Pendapatan", about: "Kategori uang masuk." },
  { type: "expense", title: "Beban (pengeluaran)", about: "Kategori uang keluar." },
];

function AccountForm({ open, edit, defaultType, onClose, onSaved }: { open: boolean; edit: Account | null; defaultType: AccountType; onClose: () => void; onSaved: () => void }) {
  const { toast } = useFeedback();
  const [type, setType] = useState<AccountType>(defaultType);
  const [subtype, setSubtype] = useState(SUBTYPES[defaultType][0]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setType(edit?.type ?? defaultType);
    setSubtype(edit?.subtype ?? SUBTYPES[defaultType][0]);
    setName(edit?.name ?? "");
    setCode(edit?.code ?? "");
  }, [open, edit, defaultType]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (edit) await api(`/accounts/${edit.id}`, { method: "PATCH", body: { name, code, ...(edit.system ? {} : { subtype }) } });
      else await api("/accounts", { method: "POST", body: { name, type, subtype, code: code.trim() || undefined } });
      toast(edit ? "Akun diperbarui." : "Akun ditambahkan.");
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
      title={edit ? "Ubah akun" : "Tambah akun"}
      description={edit ? undefined : "Akun bisa berupa dompet baru (misalnya e-wallet) atau kategori pemasukan/pengeluaran."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" form="account-form" loading={busy}>
            Simpan
          </Button>
        </>
      }
    >
      <form id="account-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <ErrorBox message={error} />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Kelompok">
            {(id) => (
              <Select
                id={id}
                value={type}
                disabled={Boolean(edit)}
                onChange={(e) => {
                  const t = e.target.value as AccountType;
                  setType(t);
                  setSubtype(SUBTYPES[t][0]);
                }}
              >
                {GROUPS.map((g) => (
                  <option key={g.type} value={g.type}>
                    {g.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Jenis">
            {(id) => (
              <Select id={id} value={subtype} disabled={Boolean(edit?.system)} onChange={(e) => setSubtype(e.target.value)}>
                {SUBTYPES[type].map((s) => (
                  <option key={s} value={s}>
                    {SUBTYPE_LABEL[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Nama">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={type === "asset" ? "Contoh: GoPay, Bank BCA" : "Contoh: Ongkos kirim"} autoFocus required />}</Field>
        <Field label="Kode akun" hint={edit ? "Dipakai untuk mengurutkan akun di laporan." : "Boleh dikosongkan, nanti diisi otomatis."}>
          {(id) => <Input id={id} value={code} onChange={(e) => setCode(e.target.value)} maxLength={12} className="tnum max-w-[10rem]" />}
        </Field>
      </form>
    </Modal>
  );
}

export function AccountsPage() {
  const { toast, confirm } = useFeedback();
  const state = useData<{ accounts: Account[] }>("/accounts");
  const [form, setForm] = useState<{ open: boolean; edit: Account | null; type: AccountType }>({ open: false, edit: null, type: "expense" });

  async function toggleArchive(a: Account) {
    try {
      await api(`/accounts/${a.id}`, { method: "PATCH", body: { archived: !a.archived } });
      toast(a.archived ? `${a.name} diaktifkan lagi.` : `${a.name} diarsipkan.`);
      state.reload();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function remove(a: Account) {
    if (!(await confirm({ title: `Hapus akun ${a.name}?`, message: "Akun yang belum pernah dipakai bisa dihapus tanpa memengaruhi laporan.", confirmLabel: "Hapus", danger: true }))) return;
    try {
      await api(`/accounts/${a.id}`, { method: "DELETE" });
      toast("Akun dihapus.");
      state.reload();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <Page>
      <PageHeader title="Daftar Akun" description="Akun adalah “laci-laci” pembukuan: tiap uang masuk atau keluar dicatat ke laci yang sesuai. Dompet dan kategori juga termasuk akun.">
        <WriteOnly>
          <Button onClick={() => setForm({ open: true, edit: null, type: "expense" })}>
            <Plus className="h-4 w-4" aria-hidden /> Tambah akun
          </Button>
        </WriteOnly>
      </PageHeader>
      <DataState state={state}>
        {(data) => (
          <div className="space-y-6">
            {GROUPS.map((g) => {
              const rows = data.accounts.filter((a) => a.type === g.type);
              return (
                <Card key={g.type}>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
                    <div>
                      <h2 className="font-bold tracking-tight">{g.title}</h2>
                      <p className="text-[13px] text-muted">{g.about}</p>
                    </div>
                    <WriteOnly>
                      <Button variant="secondary" size="sm" className="no-print" onClick={() => setForm({ open: true, edit: null, type: g.type })}>
                        <Plus className="h-3.5 w-3.5" aria-hidden /> Tambah
                      </Button>
                    </WriteOnly>
                  </div>
                  <div className="relative overflow-x-auto">
                    <table className="w-full min-w-[32rem]">
                      <thead className="sr-only">
                        <tr>
                          <th scope="col" className={th}>Kode</th>
                          <th scope="col" className={th}>Nama</th>
                          <th scope="col" className={th}>Saldo</th>
                          <th scope="col" className={th}>Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {rows.map((a) => (
                          <tr key={a.id} className={a.archived ? "text-faint" : undefined}>
                            <td className={`${td} tnum w-20 text-muted`}>{a.code}</td>
                            <td className={td}>
                              <span className="font-semibold">{a.name}</span>
                              <span className="ml-2 text-[13px] text-muted">{SUBTYPE_LABEL[a.subtype]}</span>
                              {a.system && <Badge className="ml-2">Bawaan</Badge>}
                              {a.archived && <Badge className="ml-2">Diarsipkan</Badge>}
                            </td>
                            <td className={`${td} tnum text-right font-semibold whitespace-nowrap`}>{rp(a.balance)}</td>
                            <td className={`${td} no-print w-32 text-right whitespace-nowrap`}>
                              <WriteOnly>
                                <Button variant="ghost" size="icon" aria-label={`Ubah ${a.name}`} title="Ubah" onClick={() => setForm({ open: true, edit: a, type: a.type })}>
                                  <Pencil className="h-4 w-4" aria-hidden />
                                </Button>
                                {!a.system &&
                                  (a.used ? (
                                    <Button variant="ghost" size="icon" aria-label={a.archived ? `Aktifkan lagi ${a.name}` : `Arsipkan ${a.name}`} title={a.archived ? "Aktifkan lagi" : "Arsipkan (sembunyikan dari pilihan)"} onClick={() => toggleArchive(a)}>
                                      {a.archived ? <ArchiveRestore className="h-4 w-4" aria-hidden /> : <Archive className="h-4 w-4" aria-hidden />}
                                    </Button>
                                  ) : (
                                    <Button variant="ghost" size="icon" aria-label={`Hapus ${a.name}`} title="Hapus" onClick={() => remove(a)}>
                                      <Trash2 className="h-4 w-4" aria-hidden />
                                    </Button>
                                  ))}
                              </WriteOnly>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              );
            })}
            <p className="text-[13px] text-muted">Akun yang sudah dipakai di transaksi tidak bisa dihapus, tapi bisa diarsipkan supaya tidak muncul lagi di pilihan. Saldo {TYPE_LABEL.income.toLowerCase()} dan {TYPE_LABEL.expense.toLowerCase()} di sini adalah jumlah sejak awal pencatatan.</p>
          </div>
        )}
      </DataState>
      <AccountForm open={form.open} edit={form.edit} defaultType={form.type} onClose={() => setForm((f) => ({ ...f, open: false }))} onSaved={state.reload} />
    </Page>
  );
}
