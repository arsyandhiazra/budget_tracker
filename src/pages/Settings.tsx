// Halaman Pengaturan: profil, kata sandi, status asisten & email, cadangan, hapus akun.
import { useState, type FormEvent, type ReactNode } from "react";
import { Download, Sparkles, TriangleAlert } from "lucide-react";
import { api, download, errorMessage, useData } from "@/lib/api";
import { today } from "@/lib/format";
import type { User } from "@/lib/types";
import { Page } from "@/components/Layout";
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, useFeedback } from "@/components/ui";

function Block({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <Card className="grid grid-cols-1 gap-x-10 gap-y-5 p-6 md:grid-cols-[16rem_minmax(0,1fr)]">
      <div>
        <h2 className="font-bold tracking-tight">{title}</h2>
        <p className="mt-1 text-[13px] text-muted">{text}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </Card>
  );
}

export function SettingsPage({ user, onUser, onLoggedOut }: { user: User; onUser: (u: User) => void; onLoggedOut: () => void }) {
  const { toast } = useFeedback();
  const chat = useData<{ mode: "ai" | "basic"; provider: string | null }>("/chat");
  const me = useData<{ mailMode: "smtp" | "console" }>("/auth/me");

  const [name, setName] = useState(user.name);
  const [businessName, setBusinessName] = useState(user.businessName ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [savingPass, setSavingPass] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState(false);
  const [deletePass, setDeletePass] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const r = await api<{ user: User }>("/auth/profile", { method: "PATCH", body: { name, businessName } });
      onUser(r.user);
      toast("Profil disimpan.");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setSavingPass(true);
    setPassError(null);
    try {
      await api("/auth/change-password", { method: "POST", body: { current, next } });
      setCurrent("");
      setNext("");
      toast("Kata sandi diganti. Perangkat lain otomatis keluar.");
    } catch (err) {
      setPassError(errorMessage(err));
    } finally {
      setSavingPass(false);
    }
  }

  async function backup() {
    try {
      await download("/backup", `budget-tracker-cadangan-${today()}.json`);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function deleteAccount(e: FormEvent) {
    e.preventDefault();
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api("/auth/account", { method: "DELETE", body: { password: deletePass } });
      toast("Akun dan semua datanya sudah dihapus.");
      onLoggedOut();
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <Page className="max-w-4xl">
      <PageHeader title="Pengaturan" />
      <div className="space-y-6">
        <Block title="Profil" text="Nama pembukuan muncul di kop laporan.">
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Nama">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />}</Field>
              <Field label="Nama pembukuan / usaha">{(id) => <Input id={id} value={businessName} onChange={(e) => setBusinessName(e.target.value)} maxLength={80} />}</Field>
            </div>
            <Field label="Email" hint="Email dipakai untuk masuk dan belum bisa diganti dari sini.">
              {(id) => <Input id={id} value={user.email} disabled readOnly />}
            </Field>
            <Button type="submit" loading={savingProfile}>
              Simpan profil
            </Button>
          </form>
        </Block>

        <Block title="Kata sandi" text="Setelah diganti, perangkat lain yang sedang masuk akan otomatis keluar.">
          <form onSubmit={savePassword} className="space-y-4">
            {passError && <ErrorBox message={passError} />}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Kata sandi saat ini">{(id) => <Input id={id} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />}</Field>
              <Field label="Kata sandi baru" hint="Minimal 8 karakter.">
                {(id) => <Input id={id} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />}
              </Field>
            </div>
            <Button type="submit" loading={savingPass} disabled={!current || next.length < 8}>
              Ganti kata sandi
            </Button>
          </form>
        </Block>

        <Block title="Asisten & email" text="Dua fitur ini diatur oleh pengelola aplikasi lewat file .env di server.">
          <dl className="space-y-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <dt className="flex items-center gap-2 font-semibold">
                  <Sparkles className="h-4 w-4" aria-hidden /> Asisten keuangan
                </dt>
                <dd className="mt-1 text-[13px] text-muted">
                  {chat.data?.mode === "ai"
                    ? `Dijawab oleh model AI (${chat.data.provider}). Ringkasan keuanganmu dikirim ke penyedia AI itu setiap kali kamu bertanya.`
                    : "Mode dasar: menjawab pertanyaan umum langsung dari datamu, tanpa mengirim apa pun ke luar. Untuk jawaban yang lebih luwes, isi AI_PROVIDER dan AI_API_KEY di file .env lalu mulai ulang server."}
                </dd>
              </div>
              <Badge tone={chat.data?.mode === "ai" ? "good" : "neutral"}>{chat.data?.mode === "ai" ? "AI aktif" : "Mode dasar"}</Badge>
            </div>
            <div className="flex flex-wrap items-start justify-between gap-3 border-t border-line pt-4">
              <div className="min-w-0 flex-1">
                <dt className="font-semibold">Pengiriman email</dt>
                <dd className="mt-1 text-[13px] text-muted">
                  {me.data?.mailMode === "smtp" ? "Kode verifikasi dan atur ulang kata sandi dikirim lewat email sungguhan." : "Mode percobaan: kode verifikasi ditampilkan di layar dan di terminal server. Isi SMTP_HOST dan kawan-kawannya di file .env sebelum aplikasi dipakai orang lain."}
                </dd>
              </div>
              <Badge tone={me.data?.mailMode === "smtp" ? "good" : "warn"}>{me.data?.mailMode === "smtp" ? "Email aktif" : "Mode percobaan"}</Badge>
            </div>
          </dl>
        </Block>

        <Block title="Cadangan data" text="Unduh semua datamu (akun, transaksi, utang-piutang, anggaran) dalam satu file.">
          <Button variant="secondary" onClick={backup}>
            <Download className="h-4 w-4" aria-hidden /> Unduh cadangan (.json)
          </Button>
        </Block>

        <Block title="Hapus akun" text="Menghapus akun beserta semua catatan di dalamnya, selamanya.">
          <Button variant="danger" onClick={() => setDeleting(true)}>
            Hapus akun saya
          </Button>
        </Block>
      </div>

      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Hapus akun selamanya?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(false)}>
              Batal
            </Button>
            <Button variant="danger" type="submit" form="delete-form" loading={deleteBusy} disabled={!deletePass}>
              Ya, hapus semuanya
            </Button>
          </>
        }
      >
        <form id="delete-form" onSubmit={deleteAccount} className="space-y-4">
          <p className="flex gap-2.5 rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Semua transaksi, laporan, kontak, dan riwayat obrolan akan hilang dan tidak bisa dikembalikan. Unduh cadangan dulu kalau masih perlu.
          </p>
          {deleteError && <ErrorBox message={deleteError} />}
          <Field label="Ketik kata sandimu untuk memastikan">{(id) => <Input id={id} type="password" value={deletePass} onChange={(e) => setDeletePass(e.target.value)} autoComplete="current-password" autoFocus />}</Field>
        </form>
      </Modal>
    </Page>
  );
}
