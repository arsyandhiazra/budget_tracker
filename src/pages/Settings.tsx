// Halaman Pengaturan: profil, email, pembukuan & faktur, anggota, kata sandi, tampilan,
// status asisten & email, cadangan, hapus akun.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Download, Monitor, Moon, Sparkles, Sun, TriangleAlert } from "lucide-react";
import { api, download, errorMessage, useData } from "@/lib/api";
import { useBook } from "@/lib/book";
import { today } from "@/lib/format";
import { useTheme, type ThemePref } from "@/lib/theme";
import type { BookInfo, User } from "@/lib/types";
import { EmailChangeModal } from "@/components/EmailChange";
import { Page } from "@/components/Layout";
import { TeamSettings } from "@/components/TeamSettings";
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Segmented, useFeedback } from "@/components/ui";

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

type BookProfile = { name: string | null; address: string | null; phone: string | null; paymentInfo: string | null };

/** Nama pembukuan dan kop faktur. Hanya pemilik yang bisa mengubah. */
function BookProfileForm({ onSaved }: { onSaved: (name: string | null) => void }) {
  const { toast } = useFeedback();
  const book = useData<BookProfile>("/book");
  const [form, setForm] = useState({ name: "", address: "", phone: "", paymentInfo: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (book.data) setForm({ name: book.data.name ?? "", address: book.data.address ?? "", phone: book.data.phone ?? "", paymentInfo: book.data.paymentInfo ?? "" });
  }, [book.data]);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/book", { method: "PATCH", body: { name: form.name.trim() || null, address: form.address.trim() || null, phone: form.phone.trim() || null, paymentInfo: form.paymentInfo.trim() || null } });
      onSaved(form.name.trim() || null);
      toast("Pengaturan pembukuan disimpan.");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  if (book.error) return <ErrorBox message={book.error} onRetry={book.reload} />;
  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Nama pembukuan / usaha" hint="Muncul di kop laporan dan faktur.">
        {(id) => <Input id={id} value={form.name} onChange={set("name")} maxLength={80} />}
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Alamat" hint="Untuk kop faktur. Boleh dikosongkan.">
          {(id) => <Input id={id} value={form.address} onChange={set("address")} maxLength={300} />}
        </Field>
        <Field label="Telepon" hint="Boleh dikosongkan.">
          {(id) => <Input id={id} value={form.phone} onChange={set("phone")} maxLength={40} />}
        </Field>
      </div>
      <Field label="Info pembayaran di faktur" hint="Contoh: BCA 123456789 a.n. Sari Dewi. Boleh dikosongkan.">
        {(id) => <Input id={id} value={form.paymentInfo} onChange={set("paymentInfo")} maxLength={400} />}
      </Field>
      <Button type="submit" loading={busy}>
        Simpan
      </Button>
    </form>
  );
}

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "light", label: "Terang" },
  { value: "dark", label: "Gelap" },
  { value: "system", label: "Ikuti perangkat" },
];

function ThemeSetting() {
  const { pref, theme, setPref } = useTheme();
  const Icon = pref === "system" ? Monitor : theme === "dark" ? Moon : Sun;
  return (
    <div className="space-y-3">
      <Segmented label="Tampilan" value={pref} onChange={setPref} options={THEME_OPTIONS} />
      <p className="flex items-center gap-2 text-[13px] text-muted">
        <Icon className="h-4 w-4" aria-hidden />
        {pref === "system" ? `Mengikuti pengaturan perangkatmu (sekarang ${theme === "dark" ? "gelap" : "terang"}).` : `Selalu ${theme === "dark" ? "gelap" : "terang"}.`} Pilihan ini hanya berlaku di browser ini.
      </p>
    </div>
  );
}

type Props = {
  user: User;
  books: BookInfo[];
  onUser: (u: User) => void;
  onSwitchBook: (id: number) => void;
  onLoggedOut: () => void;
  onBooksChanged: () => void;
};

export function SettingsPage({ user, books, onUser, onSwitchBook, onLoggedOut, onBooksChanged }: Props) {
  const { toast } = useFeedback();
  const { isOwner } = useBook();
  const chat = useData<{ mode: "ai" | "basic"; provider: string | null }>("/chat");
  const me = useData<{ mailMode: "smtp" | "console" }>("/auth/me");

  const [name, setName] = useState(user.name);
  const [savingProfile, setSavingProfile] = useState(false);
  const [changingEmail, setChangingEmail] = useState(false);

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
      const r = await api<{ user: User }>("/auth/profile", { method: "PATCH", body: { name } });
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
        <Block title="Profil" text="Nama kamu dan alamat email untuk masuk.">
          <form onSubmit={saveProfile} className="space-y-4">
            <Field label="Nama">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />}</Field>
            <Field label="Email" hint="Dipakai untuk masuk dan menerima kode verifikasi.">
              {(id) => (
                <div className="flex gap-2">
                  <Input id={id} value={user.email} disabled readOnly />
                  <Button variant="secondary" onClick={() => setChangingEmail(true)}>
                    Ganti email
                  </Button>
                </div>
              )}
            </Field>
            <Button type="submit" loading={savingProfile}>
              Simpan profil
            </Button>
          </form>
        </Block>

        <Block title="Pembukuan & faktur" text="Nama dan kop yang muncul di laporan dan faktur.">
          {isOwner ? (
            <BookProfileForm
              onSaved={(n) => {
                onUser({ ...user, businessName: n });
                onBooksChanged();
              }}
            />
          ) : (
            <p className="text-sm text-muted">
              Kamu membuka pembukuan <strong className="text-ink">{user.businessName}</strong>. Nama dan kop pembukuan hanya bisa diubah oleh pemiliknya.
            </p>
          )}
        </Block>

        <Block title="Anggota & akses" text="Pembukuan bisa dipakai bersama. Pemilik mengundang orang lewat email dan menentukan perannya.">
          <TeamSettings user={user} books={books} onSwitchBook={onSwitchBook} onChanged={onBooksChanged} />
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

        <Block title="Tampilan" text="Pilih tampilan terang atau gelap, atau biarkan mengikuti perangkatmu.">
          <ThemeSetting />
        </Block>

        <Block title="Asisten & email" text="Dua fitur ini diatur oleh pengelola aplikasi lewat pengaturan di server.">
          <dl className="space-y-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <dt className="flex items-center gap-2 font-semibold">
                  <Sparkles className="h-4 w-4" aria-hidden /> Asisten keuangan
                </dt>
                <dd className="mt-1 text-[13px] text-muted">
                  {chat.data?.mode === "ai"
                    ? `Dijawab oleh model AI (${chat.data.provider}). Ringkasan keuanganmu dikirim ke penyedia AI itu setiap kali kamu bertanya.`
                    : "Mode dasar: menjawab pertanyaan umum langsung dari datamu, tanpa mengirim apa pun ke luar. Untuk jawaban yang lebih luwes, isi AI_PROVIDER dan AI_API_KEY di pengaturan server lalu mulai ulang."}
                </dd>
              </div>
              <Badge tone={chat.data?.mode === "ai" ? "good" : "neutral"}>{chat.data?.mode === "ai" ? "AI aktif" : "Mode dasar"}</Badge>
            </div>
            <div className="flex flex-wrap items-start justify-between gap-3 border-t border-line pt-4">
              <div className="min-w-0 flex-1">
                <dt className="font-semibold">Pengiriman email</dt>
                <dd className="mt-1 text-[13px] text-muted">
                  {me.data?.mailMode === "smtp" ? "Kode verifikasi, atur ulang kata sandi, dan undangan anggota dikirim lewat email sungguhan." : "Mode percobaan: kode verifikasi ditampilkan di layar dan di terminal server. Isi SMTP_HOST dan kawan-kawannya di pengaturan server sebelum aplikasi dipakai orang lain."}
                </dd>
              </div>
              <Badge tone={me.data?.mailMode === "smtp" ? "good" : "warn"}>{me.data?.mailMode === "smtp" ? "Email aktif" : "Mode percobaan"}</Badge>
            </div>
          </dl>
        </Block>

        <Block title="Cadangan data" text="Unduh semua data pembukuan (akun, transaksi, utang-piutang, anggaran) dalam satu file.">
          {isOwner ? (
            <Button variant="secondary" onClick={backup}>
              <Download className="h-4 w-4" aria-hidden /> Unduh cadangan (.json)
            </Button>
          ) : (
            <p className="text-sm text-muted">Cadangan hanya bisa diunduh oleh pemilik pembukuan.</p>
          )}
        </Block>

        <Block title="Hapus akun" text="Menghapus akun beserta semua catatan di dalamnya, selamanya.">
          <Button variant="danger" onClick={() => setDeleting(true)}>
            Hapus akun saya
          </Button>
        </Block>
      </div>

      <EmailChangeModal open={changingEmail} user={user} onClose={() => setChangingEmail(false)} onChanged={onUser} />

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
            Semua transaksi, faktur, laporan, kontak, dan riwayat obrolan di pembukuan milikmu akan hilang dan tidak bisa dikembalikan. Kalau pembukuanmu dibagikan ke orang lain, keluarkan dulu semua anggotanya. Unduh cadangan dulu kalau masih perlu.
          </p>
          {deleteError && <ErrorBox message={deleteError} />}
          <Field label="Ketik kata sandimu untuk memastikan">{(id) => <Input id={id} type="password" value={deletePass} onChange={(e) => setDeletePass(e.target.value)} autoComplete="current-password" autoFocus />}</Field>
        </form>
      </Modal>
    </Page>
  );
}
