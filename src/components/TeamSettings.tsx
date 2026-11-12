// Pengaturan "Anggota": pemilik mengundang orang lewat email dan mengatur perannya.
// Anggota biasa hanya melihat peran sendiri dan bisa keluar dari pembukuan itu.
import { useState, type FormEvent } from "react";
import { Mail, Trash2, UserPlus } from "lucide-react";
import { api, errorMessage, useData } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { ROLE_HELP, ROLE_LABEL, type BookInfo, type Member, type PendingInvite, type Role, type User } from "@/lib/types";
import { Badge, Button, ErrorBox, Field, Input, Select, useFeedback } from "./ui";

type Assignable = Exclude<Role, "owner">;

function RolePicker({ id, value, onChange, label, compact }: { id?: string; value: Assignable; onChange: (r: Assignable) => void; label?: string; compact?: boolean }) {
  return (
    <Select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value as Assignable)} className={compact ? "h-9 w-auto text-[13px]" : undefined}>
      <option value="editor">{ROLE_LABEL.editor}: boleh mencatat</option>
      <option value="viewer">{ROLE_LABEL.viewer}: hanya melihat</option>
    </Select>
  );
}

function OwnerTeam() {
  const { toast, confirm } = useFeedback();
  const team = useData<{ owner: { name: string; email: string }; members: Member[]; invitations: PendingInvite[] }>("/team");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Assignable>("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ emailSent: boolean }>("/team/invitations", { method: "POST", body: { email, role } });
      toast(r.emailSent ? "Undangan dikirim lewat email." : "Undangan dibuat, tetapi emailnya gagal terkirim. Minta orangnya masuk ke aplikasi dengan email itu.", r.emailSent ? "success" : "error");
      setEmail("");
      team.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast(ok);
      team.reload();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  const data = team.data;
  return (
    <div className="space-y-6">
      <form onSubmit={invite} className="space-y-3" noValidate>
        {error && <ErrorBox message={error} />}
        <Field label="Undang lewat email" hint="Orangnya masuk (atau daftar) dengan email ini, lalu menerima undangan.">
          {(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@email.com" autoComplete="off" />}
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Peran" className="min-w-[13rem] flex-1">
            {(id) => <RolePicker id={id} value={role} onChange={setRole} />}
          </Field>
          <Button type="submit" loading={busy} disabled={!email.includes("@")}>
            <UserPlus className="h-4 w-4" aria-hidden /> Undang
          </Button>
        </div>
        <p className="text-[13px] text-muted">{ROLE_HELP[role]}</p>
      </form>

      {data && (
        <div>
          <h3 className="mb-2 text-sm font-bold">Yang punya akses</h3>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span className="min-w-0 wrap-anywhere">
                <strong>{data.owner.name}</strong> <span className="text-muted">· {data.owner.email}</span>
              </span>
              <Badge>{ROLE_LABEL.owner} (kamu)</Badge>
            </li>
            {data.members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 wrap-anywhere">
                  <strong>{m.name}</strong> <span className="text-muted">· {m.email}</span>
                  <span className="block text-[13px] text-muted">Bergabung {fmtDate(m.joinedAt.slice(0, 10))}</span>
                </span>
                <span className="flex items-center gap-2">
                  <RolePicker compact label={`Peran ${m.name}`} value={m.role} onChange={(r) => act(() => api(`/team/members/${m.userId}`, { method: "PATCH", body: { role: r } }), "Peran diubah.")} />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Keluarkan ${m.name}`}
                    title="Keluarkan"
                    onClick={async () => {
                      if (await confirm({ title: `Keluarkan ${m.name}?`, message: "Orang ini langsung tidak bisa membuka pembukuanmu lagi. Catatan yang pernah dibuatnya tetap ada.", confirmLabel: "Keluarkan", danger: true })) {
                        await act(() => api(`/team/members/${m.userId}`, { method: "DELETE" }), "Anggota dikeluarkan.");
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </span>
              </li>
            ))}
          </ul>

          {data.invitations.length > 0 && (
            <>
              <h3 className="mt-5 mb-2 text-sm font-bold">Undangan yang menunggu</h3>
              <ul className="divide-y divide-line rounded-2xl border border-line">
                {data.invitations.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <Mail className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                      <span className="min-w-0">
                        <strong className="break-all">{i.email}</strong>
                        <span className="block text-[13px] text-muted">
                          {ROLE_LABEL[i.role]} · {i.expired ? "sudah kedaluwarsa" : `berlaku sampai ${fmtDate(i.expiresAt.slice(0, 10))}`}
                        </span>
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {i.expired && <Badge tone="warn">Kedaluwarsa</Badge>}
                      <Button variant="secondary" size="sm" onClick={() => act(() => api("/team/invitations", { method: "POST", body: { email: i.email, role: i.role } }), "Undangan dikirim ulang.")}>
                        Kirim ulang
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`Batalkan undangan ${i.email}`} title="Batalkan" onClick={() => act(() => api(`/team/invitations/${i.id}`, { method: "DELETE" }), "Undangan dibatalkan.")}>
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function TeamSettings({ user, books, onSwitchBook, onChanged }: { user: User; books: BookInfo[]; onSwitchBook: (id: number) => void; onChanged: () => void }) {
  const { toast, confirm } = useFeedback();
  if (user.role === "owner") return <OwnerTeam />;

  const mine = books.find((b) => b.own);
  async function leave() {
    const ok = await confirm({ title: "Keluar dari pembukuan ini?", message: <>Kamu tidak akan bisa membuka <strong>{user.businessName}</strong> lagi, kecuali diundang ulang oleh pemiliknya.</>, confirmLabel: "Keluar", danger: true });
    if (!ok) return;
    try {
      await api(`/auth/books/${user.bookId}`, { method: "DELETE" });
      toast("Kamu sudah keluar dari pembukuan itu.");
      onChanged();
      if (mine) onSwitchBook(mine.id);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }
  return (
    <div className="space-y-3 text-sm">
      <p>
        Kamu membuka pembukuan <strong className="wrap-anywhere">{user.businessName}</strong> sebagai <Badge>{ROLE_LABEL[user.role]}</Badge>
      </p>
      <p className="text-muted">{ROLE_HELP[user.role as Assignable]} Hanya pemilik yang bisa mengundang atau mengeluarkan anggota.</p>
      <Button variant="secondary" onClick={leave}>
        Keluar dari pembukuan ini
      </Button>
    </div>
  );
}
