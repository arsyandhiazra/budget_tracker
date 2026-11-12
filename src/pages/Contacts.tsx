// Halaman Kontak: pelanggan, pemasok, karyawan, dan lainnya.
import { useEffect, useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { WriteOnly } from "@/lib/book";
import { api, errorMessage, useData } from "@/lib/api";
import { rp } from "@/lib/format";
import type { Contact } from "@/lib/types";
import { Page } from "@/components/Layout";
import { Badge, Button, Card, DataState, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, td, th, useFeedback } from "@/components/ui";

const TYPE_LABEL: Record<Contact["type"], string> = { customer: "Pelanggan", supplier: "Pemasok", employee: "Karyawan", other: "Lainnya" };

function ContactForm({ open, edit, onClose, onSaved }: { open: boolean; edit: Contact | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useFeedback();
  const [name, setName] = useState("");
  const [type, setType] = useState<Contact["type"]>("customer");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(edit?.name ?? "");
    setType(edit?.type ?? "customer");
    setEmail(edit?.email ?? "");
    setPhone(edit?.phone ?? "");
    setNote(edit?.note ?? "");
  }, [open, edit]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name, type, email: email.trim() || null, phone, note };
      if (edit) await api(`/contacts/${edit.id}`, { method: "PATCH", body });
      else await api("/contacts", { method: "POST", body });
      toast(edit ? "Kontak diperbarui." : "Kontak ditambahkan.");
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
      title={edit ? "Ubah kontak" : "Tambah kontak"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" form="contact-form" loading={busy}>
            Simpan
          </Button>
        </>
      }
    >
      <form id="contact-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <ErrorBox message={error} />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_11rem]">
          <Field label="Nama">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus required />}</Field>
          <Field label="Jenis">
            {(id) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value as Contact["type"])}>
                {Object.entries(TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Email" hint="Opsional.">
            {(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />}
          </Field>
          <Field label="Nomor telepon" hint="Opsional.">
            {(id) => <Input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} autoComplete="off" />}
          </Field>
        </div>
        <Field label="Catatan" hint="Opsional.">
          {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />}
        </Field>
      </form>
    </Modal>
  );
}

export function ContactsPage() {
  const { toast, confirm } = useFeedback();
  const state = useData<{ contacts: Contact[] }>("/contacts");
  const [form, setForm] = useState<{ open: boolean; edit: Contact | null }>({ open: false, edit: null });

  async function remove(c: Contact) {
    if (!(await confirm({ title: `Hapus kontak ${c.name}?`, message: c.entries ? `Kontak ini terhubung ke ${c.entries} catatan. Catatannya tetap ada, hanya nama kontaknya yang dilepas.` : "Kontak ini belum terhubung ke catatan mana pun.", confirmLabel: "Hapus", danger: true }))) return;
    try {
      await api(`/contacts/${c.id}`, { method: "DELETE" });
      toast("Kontak dihapus.");
      state.reload();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <Page>
      <PageHeader title="Kontak" description="Orang atau pihak yang sering bertransaksi denganmu. Berguna untuk melacak utang dan piutang per nama.">
        <WriteOnly>
          <Button onClick={() => setForm({ open: true, edit: null })}>
            <Plus className="h-4 w-4" aria-hidden /> Tambah kontak
          </Button>
        </WriteOnly>
      </PageHeader>
      <DataState state={state}>
        {(data) => (
          <Card>
            {data.contacts.length === 0 ? (
              <Empty icon={<Users className="h-5 w-5" aria-hidden />} title="Belum ada kontak" text="Kontak juga otomatis dibuat saat kamu mencatat utang atau piutang dengan nama baru.">
                <WriteOnly>
                  <Button onClick={() => setForm({ open: true, edit: null })}>
                    <Plus className="h-4 w-4" aria-hidden /> Tambah kontak
                  </Button>
                </WriteOnly>
              </Empty>
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[40rem]">
                  <thead>
                    <tr className="border-b border-line">
                      <th scope="col" className={th}>Nama</th>
                      <th scope="col" className={th}>Hubungi</th>
                      <th scope="col" className={`${th} text-right`}>Utangmu</th>
                      <th scope="col" className={`${th} text-right`}>Piutangmu</th>
                      <th scope="col" className={`${th} w-24`}>
                        <span className="sr-only">Aksi</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.contacts.map((c) => (
                      <tr key={c.id} className="hover:bg-paper/50">
                        <td className={td}>
                          <span className="font-semibold">{c.name}</span>
                          <Badge className="ml-2">{TYPE_LABEL[c.type]}</Badge>
                          {c.note && <span className="mt-0.5 block text-[13px] text-muted">{c.note}</span>}
                        </td>
                        <td className={`${td} text-muted`}>
                          {c.email && <span className="block">{c.email}</span>}
                          {c.phone && <span className="tnum block">{c.phone}</span>}
                          {!c.email && !c.phone && "-"}
                        </td>
                        <td className={`${td} tnum text-right whitespace-nowrap`}>{c.payable ? <span className="font-semibold">{rp(c.payable)}</span> : <span className="text-faint">-</span>}</td>
                        <td className={`${td} tnum text-right whitespace-nowrap`}>{c.receivable ? <span className="font-semibold">{rp(c.receivable)}</span> : <span className="text-faint">-</span>}</td>
                        <td className={`${td} no-print text-right whitespace-nowrap`}>
                          <WriteOnly>
                            <Button variant="ghost" size="icon" aria-label={`Ubah ${c.name}`} title="Ubah" onClick={() => setForm({ open: true, edit: c })}>
                              <Pencil className="h-4 w-4" aria-hidden />
                            </Button>
                            <Button variant="ghost" size="icon" aria-label={`Hapus ${c.name}`} title="Hapus" onClick={() => remove(c)}>
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </Button>
                          </WriteOnly>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </DataState>
      <ContactForm open={form.open} edit={form.edit} onClose={() => setForm((f) => ({ ...f, open: false }))} onSaved={state.reload} />
    </Page>
  );
}
