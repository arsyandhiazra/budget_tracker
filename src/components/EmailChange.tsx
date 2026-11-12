// Ganti alamat email akun, dua langkah: (1) email baru + kata sandi → kode dikirim ke email BARU,
// (2) masukkan kode. Email lama diberi tahu, dan perangkat lain otomatis keluar.
import { useEffect, useState, type FormEvent } from "react";
import { MailCheck } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { User } from "@/lib/types";
import { Button, ErrorBox, Field, Input, Modal, useFeedback } from "./ui";

export function EmailChangeModal({ open, user, onClose, onChanged }: { open: boolean; user: User; onClose: () => void; onChanged: (u: User) => void }) {
  const { toast } = useFeedback();
  const [stage, setStage] = useState<"request" | "confirm">("request");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStage("request");
    setEmail("");
    setPassword("");
    setCode("");
    setDevCode(null);
    setError(null);
  }, [open]);

  async function request(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ email: string; devCode?: string }>("/auth/email/request", { method: "POST", body: { email, password } });
      setEmail(r.email);
      setDevCode(r.devCode ?? null);
      setStage("confirm");
      if (stage === "confirm") toast("Kode baru dikirim.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: User }>("/auth/email/confirm", { method: "POST", body: { code } });
      onChanged(r.user);
      toast("Email akunmu sudah diganti. Perangkat lain otomatis keluar.");
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
      title="Ganti alamat email"
      description={stage === "request" ? `Email sekarang: ${user.email}` : undefined}
      footer={
        stage === "request" ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" form="email-request" loading={busy} disabled={!email || !password}>
              Kirim kode
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => { setStage("request"); setError(null); }}>
              Ganti alamat
            </Button>
            <Button type="submit" form="email-confirm" loading={busy} disabled={code.replace(/\s/g, "").length !== 6}>
              Ganti email
            </Button>
          </>
        )
      }
    >
      {stage === "request" ? (
        <form id="email-request" onSubmit={request} className="space-y-4" noValidate>
          {error && <ErrorBox message={error} />}
          <Field label="Alamat email baru" hint="Kami kirim kode 6 angka ke alamat ini untuk memastikan alamat itu milikmu.">
            {(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />}
          </Field>
          <Field label="Kata sandi kamu" hint="Untuk memastikan ini memang kamu.">
            {(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />}
          </Field>
        </form>
      ) : (
        <form id="email-confirm" onSubmit={confirm} className="space-y-4" noValidate>
          <p className="flex gap-2.5 rounded-2xl bg-paper px-4 py-3 text-sm text-ink-soft">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Kode dikirim ke <strong>{email}</strong>. Berlaku 15 menit. Cek folder Spam kalau belum terlihat.
            </span>
          </p>
          {devCode && (
            <p className="rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn" role="note">
              Mode percobaan (email belum diatur di server): kodenya <strong className="tnum tracking-widest">{devCode}</strong>
            </p>
          )}
          {error && <ErrorBox message={error} />}
          <Field label="Kode 6 angka">
            {(id) => <Input id={id} value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, "").slice(0, 7))} inputMode="numeric" autoComplete="one-time-code" className="tnum text-lg tracking-[0.4em]" autoFocus />}
          </Field>
          <p className="text-[13px] text-muted">
            Belum menerima?{" "}
            <button type="button" onClick={() => void request()} disabled={busy} className="font-semibold text-ink underline underline-offset-2 disabled:opacity-50">
              Kirim ulang kode
            </button>
          </p>
        </form>
      )}
    </Modal>
  );
}
