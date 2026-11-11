// Halaman akun: masuk, daftar, verifikasi email, lupa kata sandi, dan pengaturan awal.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Briefcase, Check, ChartNoAxesColumn, Eye, EyeOff, HandCoins, Info, MailCheck, Sparkles, UserRound } from "lucide-react";
import { cn } from "@/utils/cn";
import { api, ApiError, errorMessage } from "@/lib/api";
import { today } from "@/lib/format";
import { go } from "@/lib/router";
import type { User } from "@/lib/types";
import { Brand } from "@/components/Layout";
import { Button, ErrorBox, Field, Input, MoneyInput, useFeedback } from "@/components/ui";

const PENDING_KEY = "bt_pending_email";
const DEVCODE_KEY = "bt_dev_code";

function remember(email: string, devCode?: string) {
  try {
    sessionStorage.setItem(PENDING_KEY, email);
    if (devCode) sessionStorage.setItem(DEVCODE_KEY, devCode);
    else sessionStorage.removeItem(DEVCODE_KEY);
  } catch {
    /* penyimpanan browser dimatikan: tidak masalah */
  }
}
const recall = (key: string) => {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};

// ───────────── Kerangka halaman akun ─────────────

const STEPS = ["Buat akun", "Verifikasi email", "Atur pembukuan"];

function Steps({ current }: { current: number }) {
  return (
    <ol className="mb-8 flex items-center gap-2 text-xs font-semibold" aria-label="Langkah pembuatan akun">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-2" aria-current={i === current ? "step" : undefined}>
          <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-[11px]", i < current ? "bg-ink text-white" : i === current ? "bg-ink text-white" : "bg-paper-deep text-muted")}>
            {i < current ? <Check className="h-3.5 w-3.5" aria-label="selesai" /> : i + 1}
          </span>
          <span className={cn("hidden sm:inline", i === current ? "text-ink" : "text-muted")}>{label}</span>
          {i < STEPS.length - 1 && <span className="h-px w-5 bg-line-strong sm:w-6" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

function Shell({ children, step }: { children: ReactNode; step?: number }) {
  return (
    <div className="grid grid-cols-1 min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-7 sm:px-12">
        <a href="#/masuk" className="self-start">
          <Brand />
        </a>
        <div className="flex flex-1 items-center py-10">
          <div className="mx-auto w-full max-w-[26rem]">
            {step !== undefined && <Steps current={step} />}
            {children}
          </div>
        </div>
        <p className="text-xs text-faint">Data keuanganmu tersimpan di server aplikasi ini dan hanya bisa dibuka dengan akunmu.</p>
      </div>

      <aside className="relative hidden flex-col justify-between overflow-hidden bg-paper p-14 lg:flex" aria-hidden>
        <div>
          <p className="max-w-md text-[2.5rem] leading-[1.1] font-extrabold tracking-tight">Catat hari ini, paham keuanganmu besok.</p>
          <p className="mt-4 max-w-sm text-[15px] text-muted">Pemasukan, pengeluaran, utang-piutang, sampai laporan keuangan — rapi di satu tempat, tanpa perlu paham akuntansi.</p>
        </div>
        <div className="my-10 rounded-3xl border border-line bg-white p-6 shadow-[0_24px_60px_-30px_rgb(23_23_22/0.35)]">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-bold">Pemasukan vs pengeluaran</p>
            <p className="flex items-center gap-3 text-xs text-muted">
              <span className="flex items-center gap-1.5">
                <i className="h-2 w-2 rounded-sm bg-masuk" /> Masuk
              </span>
              <span className="flex items-center gap-1.5">
                <i className="h-2 w-2 rounded-sm bg-keluar" /> Keluar
              </span>
            </p>
          </div>
          <div className="mt-6 flex h-36 items-end justify-between gap-3 border-b border-line-strong px-2">
            {[
              [52, 38],
              [64, 47],
              [58, 61],
              [78, 44],
              [86, 52],
              [100, 57],
            ].map(([a, b], i) => (
              <div key={i} className="flex h-full flex-1 items-end justify-center gap-0.5">
                <span className="w-4 rounded-t-[4px] bg-masuk" style={{ height: `${a}%` }} />
                <span className="w-4 rounded-t-[4px] bg-keluar" style={{ height: `${b}%` }} />
              </div>
            ))}
          </div>
        </div>
        <ul className="grid grid-cols-3 gap-6 text-[13px] font-medium text-ink-soft">
          <li className="flex flex-col gap-2">
            <ChartNoAxesColumn className="h-5 w-5" /> Laporan keuangan otomatis
          </li>
          <li className="flex flex-col gap-2">
            <HandCoins className="h-5 w-5" /> Pengingat utang & piutang
          </li>
          <li className="flex flex-col gap-2">
            <Sparkles className="h-5 w-5" /> Asisten yang bisa ditanya
          </li>
        </ul>
      </aside>
    </div>
  );
}

function Heading({ title, text }: { title: string; text: ReactNode }) {
  return (
    <div className="mb-7">
      <h1 className="text-[1.75rem] leading-tight font-extrabold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted">{text}</p>
    </div>
  );
}

function PasswordInput({ id, value, onChange, autoComplete, autoFocus }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} autoFocus={autoFocus} required className="pr-11" />
      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"} aria-pressed={show} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted hover:text-ink">
        {show ? <EyeOff className="h-[18px] w-[18px]" aria-hidden /> : <Eye className="h-[18px] w-[18px]" aria-hidden />}
      </button>
    </div>
  );
}

const linkClass = "font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink";

function DevCodeNote({ code }: { code: string }) {
  if (!code) return null;
  return (
    <div className="mb-5 flex gap-2.5 rounded-2xl border border-line bg-paper px-4 py-3 text-[13px] text-ink-soft">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p>
        <strong>Mode percobaan.</strong> Pengiriman email belum diatur, jadi kodenya ditampilkan di sini: <strong className="tnum text-base tracking-widest text-ink">{code}</strong>
      </p>
    </div>
  );
}

function CodeInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <Input
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="••••••"
      autoFocus
      required
      className="tnum h-14 text-center text-2xl font-bold tracking-[0.5em] placeholder:tracking-[0.5em]"
    />
  );
}

// ───────────── Masuk ─────────────

export function Login({ onAuthed }: { onAuthed: (u: User) => void }) {
  const [email, setEmail] = useState(recall(PENDING_KEY));
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: User }>("/auth/login", { method: "POST", body: { email, password } });
      onAuthed(r.user);
    } catch (err) {
      if (err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED") {
        remember(email.trim().toLowerCase(), err.data.devCode as string | undefined);
        go("/verifikasi");
        return;
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <Heading title="Selamat datang kembali" text="Masuk untuk melanjutkan pembukuanmu." />
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <ErrorBox message={error} />}
        <Field label="Email">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="nama@email.com" autoFocus={!email} required />}</Field>
        <Field label="Kata sandi">{(id) => <PasswordInput id={id} value={password} onChange={setPassword} autoComplete="current-password" autoFocus={Boolean(email)} />}</Field>
        <div className="text-right text-[13px]">
          <a href="#/lupa-sandi" className={linkClass}>
            Lupa kata sandi?
          </a>
        </div>
        <Button type="submit" loading={busy} className="h-11 w-full">
          Masuk
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Belum punya akun?{" "}
        <a href="#/daftar" className={linkClass}>
          Daftar gratis
        </a>
      </p>
    </Shell>
  );
}

// ───────────── Daftar ─────────────

export function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const weak = password.length > 0 && password.length < 8;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ email: string; devCode?: string }>("/auth/register", { method: "POST", body: { name, email, password } });
      remember(r.email, r.devCode);
      go("/verifikasi");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell step={0}>
      <Heading title="Buat akun baru" text="Cukup satu menit. Setelah ini kami kirim kode ke emailmu untuk memastikan email itu benar milikmu." />
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <ErrorBox message={error} />}
        <Field label="Nama">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Nama kamu" autoFocus required maxLength={80} />}</Field>
        <Field label="Email">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="nama@email.com" required />}</Field>
        <Field label="Kata sandi" hint="Minimal 8 karakter. Makin panjang makin aman." error={weak ? `Kurang ${8 - password.length} karakter lagi.` : null}>
          {(id) => <PasswordInput id={id} value={password} onChange={setPassword} autoComplete="new-password" />}
        </Field>
        <Button type="submit" loading={busy} className="h-11 w-full">
          Daftar & kirim kode
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Sudah punya akun?{" "}
        <a href="#/masuk" className={linkClass}>
          Masuk
        </a>
      </p>
    </Shell>
  );
}

// ───────────── Verifikasi email ─────────────

function useCountdown(seconds: number) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft] as const;
}

export function Verify({ onAuthed }: { onAuthed: (u: User) => void }) {
  const { toast } = useFeedback();
  const email = recall(PENDING_KEY);
  const [devCode, setDevCode] = useState(recall(DEVCODE_KEY));
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useCountdown(60);

  useEffect(() => {
    if (!email) go("/daftar", true);
  }, [email]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return setError("Kode terdiri dari 6 angka.");
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: User }>("/auth/verify", { method: "POST", body: { email, code } });
      try {
        sessionStorage.removeItem(DEVCODE_KEY);
      } catch {
        /* abaikan */
      }
      onAuthed(r.user);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.code === "ALREADY_VERIFIED") go("/masuk");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    try {
      const r = await api<{ devCode?: string }>("/auth/resend", { method: "POST", body: { email } });
      if (r.devCode) setDevCode(r.devCode);
      setCode("");
      setError(null);
      setWait(60);
      toast("Kode baru sudah dikirim.");
    } catch (err) {
      if (err instanceof ApiError && typeof err.data.retryAfter === "number") setWait(err.data.retryAfter);
      toast(errorMessage(err), "error");
    }
  }

  return (
    <Shell step={1}>
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-paper">
        <MailCheck className="h-6 w-6" aria-hidden />
      </div>
      <Heading
        title="Cek emailmu"
        text={
          <>
            Kami mengirim kode 6 angka ke <strong className="text-ink">{email}</strong>. Kode berlaku 15 menit.
          </>
        }
      />
      <DevCodeNote code={devCode} />
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <ErrorBox message={error} />}
        <Field label="Kode verifikasi">{(id) => <CodeInput id={id} value={code} onChange={setCode} />}</Field>
        <Button type="submit" loading={busy} disabled={code.length !== 6} className="h-11 w-full">
          Verifikasi & lanjut
        </Button>
      </form>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        {wait > 0 ? (
          <span>Belum dapat kode? Kirim ulang dalam {wait} detik</span>
        ) : (
          <button type="button" onClick={resend} className={linkClass}>
            Kirim ulang kode
          </button>
        )}
        <a href="#/daftar" className={linkClass}>
          Ganti email
        </a>
      </div>
      <p className="mt-4 text-[13px] text-muted">Tidak ada di kotak masuk? Coba cek folder Spam atau Promosi.</p>
    </Shell>
  );
}

// ───────────── Lupa kata sandi ─────────────

export function Forgot() {
  const { toast } = useFeedback();
  const [stage, setStage] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState(recall(PENDING_KEY));
  const [devCode, setDevCode] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ devCode?: string }>("/auth/forgot", { method: "POST", body: { email } });
      setDevCode(r.devCode ?? "");
      setStage("reset");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function reset(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/reset", { method: "POST", body: { email, code, password } });
      remember(email.trim().toLowerCase());
      toast("Kata sandi berhasil diganti. Silakan masuk.");
      go("/masuk");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <a href="#/masuk" className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Kembali ke halaman masuk
      </a>
      {stage === "email" ? (
        <>
          <Heading title="Lupa kata sandi?" text="Tenang. Tulis emailmu, nanti kami kirim kode untuk membuat kata sandi baru." />
          <form onSubmit={requestCode} className="space-y-4" noValidate>
            {error && <ErrorBox message={error} />}
            <Field label="Email">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="nama@email.com" autoFocus required />}</Field>
            <Button type="submit" loading={busy} className="h-11 w-full">
              Kirim kode
            </Button>
          </form>
        </>
      ) : (
        <>
          <Heading
            title="Buat kata sandi baru"
            text={
              <>
                Kalau <strong className="text-ink">{email}</strong> terdaftar, kode 6 angka sudah kami kirim ke sana.
              </>
            }
          />
          <DevCodeNote code={devCode} />
          <form onSubmit={reset} className="space-y-4" noValidate>
            {error && <ErrorBox message={error} />}
            <Field label="Kode dari email">{(id) => <CodeInput id={id} value={code} onChange={setCode} />}</Field>
            <Field label="Kata sandi baru" hint="Minimal 8 karakter.">
              {(id) => <PasswordInput id={id} value={password} onChange={setPassword} autoComplete="new-password" />}
            </Field>
            <Button type="submit" loading={busy} disabled={code.length !== 6 || password.length < 8} className="h-11 w-full">
              Simpan kata sandi baru
            </Button>
          </form>
        </>
      )}
    </Shell>
  );
}

// ───────────── Pengaturan awal ─────────────

export function Onboarding({ user, onDone, onLogout }: { user: User; onDone: (u: User) => void; onLogout: () => void }) {
  const [stage, setStage] = useState(0);
  const [usage, setUsage] = useState<"pribadi" | "usaha">("pribadi");
  const [businessName, setBusinessName] = useState("");
  const [openingCash, setOpeningCash] = useState(0);
  const [openingBank, setOpeningBank] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: User }>("/auth/onboarding", { method: "POST", body: { usage, businessName, openingCash, openingBank, date: today() } });
      onDone(r.user);
      go("/dasbor", true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const choices = [
    { value: "pribadi" as const, icon: UserRound, title: "Keuangan pribadi", text: "Gaji, belanja, tagihan, tabungan." },
    { value: "usaha" as const, icon: Briefcase, title: "Usaha / bisnis", text: "Penjualan, pembelian, gaji karyawan." },
  ];

  return (
    <Shell step={2}>
      {stage === 0 ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setStage(1);
          }}
          className="space-y-5"
        >
          <Heading title={`Hai ${user.name.split(" ")[0]}, mau dipakai untuk apa?`} text="Pilihan ini menentukan daftar kategori awal. Semuanya masih bisa diubah nanti." />
          <div role="radiogroup" aria-label="Penggunaan" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {choices.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={usage === c.value}
                onClick={() => setUsage(c.value)}
                className={cn("rounded-2xl border p-4 text-left transition-colors", usage === c.value ? "border-ink bg-paper ring-1 ring-ink" : "border-line-strong hover:bg-paper/60")}
              >
                <c.icon className="mb-3 h-5 w-5" aria-hidden />
                <p className="text-sm font-bold">{c.title}</p>
                <p className="mt-0.5 text-[13px] text-muted">{c.text}</p>
              </button>
            ))}
          </div>
          <Field label={usage === "usaha" ? "Nama usaha" : "Nama pembukuan"} hint="Boleh dikosongkan. Akan muncul di kop laporan.">
            {(id) => <Input id={id} value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder={usage === "usaha" ? "Contoh: Toko Berkah" : `Contoh: Keuangan ${user.name.split(" ")[0]}`} maxLength={80} />}
          </Field>
          <Button type="submit" className="h-11 w-full">
            Lanjut
          </Button>
        </form>
      ) : (
        <form onSubmit={finish} className="space-y-5">
          <Heading title="Berapa uangmu saat ini?" text="Ini jadi titik awal pembukuan, supaya saldo di aplikasi sama dengan uang aslimu. Kalau belum tahu pasti, isi perkiraan dulu atau biarkan kosong." />
          {error && <ErrorBox message={error} />}
          <Field label="Uang tunai (kas)" hint="Uang di dompet, laci, atau celengan.">
            {(id) => <MoneyInput id={id} value={openingCash} onChange={setOpeningCash} autoFocus />}
          </Field>
          <Field label="Saldo rekening bank" hint="Jumlahkan semua rekening. Dompet digital bisa ditambahkan nanti.">
            {(id) => <MoneyInput id={id} value={openingBank} onChange={setOpeningBank} />}
          </Field>
          <div className="flex gap-2">
            <Button variant="secondary" className="h-11" onClick={() => setStage(0)}>
              Kembali
            </Button>
            <Button type="submit" loading={busy} className="h-11 flex-1">
              Selesai, buka dasbor
            </Button>
          </div>
        </form>
      )}
      <p className="mt-8 text-center text-[13px] text-muted">
        Masuk sebagai {user.email}.{" "}
        <button type="button" onClick={onLogout} className={linkClass}>
          Keluar
        </button>
      </p>
    </Shell>
  );
}
