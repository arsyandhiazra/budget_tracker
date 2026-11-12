// Komponen dasar yang dipakai berulang: tombol, kolom isian, modal, notifikasi, dll.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { AlertCircle, CheckCircle2, Inbox, Loader2, RefreshCw, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { num, parseMoney } from "@/lib/format";

// ───────────── Tombol ─────────────

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm" | "icon";
  loading?: boolean;
};

const BTN_VARIANT = {
  primary: "bg-ink text-white hover:bg-ink-soft",
  secondary: "border border-line-strong bg-white text-ink hover:bg-paper",
  ghost: "text-ink hover:bg-paper",
  danger: "bg-bad text-white hover:bg-bad/90",
};
const BTN_SIZE = { md: "h-10 px-4 text-sm gap-2", sm: "h-8 px-3 text-[13px] gap-1.5", icon: "h-9 w-9" };

export function Button({ variant = "primary", size = "md", loading, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-xl font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        BTN_VARIANT[variant],
        BTN_SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

// ───────────── Kolom isian ─────────────

export const inputClass =
  "h-10 w-full rounded-xl border border-line-strong bg-white px-3 text-sm text-ink placeholder:text-faint transition-colors focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10 disabled:bg-paper disabled:text-muted";

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-semibold text-ink">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="mt-1.5 flex items-center gap-1 text-[13px] text-bad">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden /> {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-[13px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClass, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(inputClass, "select-chevron appearance-none bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat pr-9", className)} {...rest}>
      {children}
    </select>
  );
}

/** Isian uang: otomatis diberi titik pemisah ribuan saat diketik. */
export function MoneyInput({ value, onChange, id, placeholder = "0", autoFocus, className, onBlur, onEnter, ariaLabel }: {
  value: number;
  onChange: (n: number) => void;
  id?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  onBlur?: () => void;
  onEnter?: () => void;
  ariaLabel?: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted">Rp</span>
      <input
        id={id}
        aria-label={ariaLabel}
        inputMode="numeric"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        className={cn(inputClass, "tnum pl-10", className)}
        value={value ? num(value) : ""}
        onChange={(e) => onChange(Math.min(parseMoney(e.target.value), 999_999_999_999_999))}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
      />
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label, className }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cn("inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-paper p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-8 rounded-lg px-3 text-[13px] font-semibold whitespace-nowrap transition-colors",
            o.value === value ? "bg-white text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ───────────── Wadah & penanda ─────────────

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("rounded-2xl border border-line bg-white", className)}>{children}</section>;
}

const BADGE = {
  neutral: "bg-paper text-ink-soft",
  masuk: "bg-masuk-soft text-masuk-ink",
  keluar: "bg-keluar-soft text-keluar-ink",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
};
export function Badge({ tone = "neutral", children, className }: { tone?: keyof typeof BADGE; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap", BADGE[tone], className)}>{children}</span>;
}

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {children && <div className="no-print flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function Empty({ title, text, children, icon }: { title: string; text?: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-paper text-muted">{icon ?? <Inbox className="h-5 w-5" aria-hidden />}</div>
      <p className="font-semibold">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function Loading({ label = "Memuat…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad" role="alert">
      <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 wrap-anywhere">{message}</span>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Coba lagi
        </Button>
      )}
    </div>
  );
}

/** Pembungkus isi halaman: menangani "sedang memuat" dan "gagal memuat". */
export function DataState<T>({ state, children, fallbackClassName }: { state: { data: T | null; error: string | null; loading: boolean; reload: () => void }; children: (data: T) => ReactNode; fallbackClassName?: string }) {
  if (state.data === null) return <div className={fallbackClassName}>{state.error ? <ErrorBox message={state.error} onRetry={state.reload} /> : <Loading />}</div>;
  return (
    <div className={cn("transition-opacity", state.loading && "opacity-60")} aria-busy={state.loading}>
      {state.error && (
        <div className="mb-4">
          <ErrorBox message={state.error} onRetry={state.reload} />
        </div>
      )}
      {children(state.data)}
    </div>
  );
}

export const th = "px-4 py-2.5 text-left text-xs font-semibold tracking-wide text-muted uppercase";
export const td = "px-4 py-3 align-middle text-sm";

// ───────────── Modal (jendela kecil di atas halaman) ─────────────

export function Modal({ open, onClose, title, description, children, footer, wide }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const body = document.body;
    const overflow = body.style.overflow;
    body.style.overflow = "hidden";
    const first = panel.current?.querySelector<HTMLElement>("[autofocus], input:not([type=hidden]), select, textarea");
    (first ?? panel.current)?.focus();
    return () => {
      body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    // Menjaga tombol Tab tetap berputar di dalam modal.
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" onKeyDown={onKeyDown}>
      <div className="animate-fade absolute inset-0 bg-scrim" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn("animate-pop relative flex max-h-modal w-full flex-col rounded-t-3xl bg-white shadow-pop outline-none sm:rounded-3xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold tracking-tight wrap-anywhere">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-muted wrap-anywhere">{description}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Tutup" className="-mt-1 -mr-2">
            <X className="h-5 w-5" aria-hidden />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

// ───────────── Notifikasi singkat & konfirmasi ─────────────

type Toast = { id: number; message: string; tone: "success" | "error" };
type ConfirmOptions = { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean };

const FeedbackContext = createContext<{ toast: (message: string, tone?: Toast["tone"]) => void; confirm: (o: ConfirmOptions) => Promise<boolean> } | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ask, setAsk] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const nextId = useRef(1);

  const toast = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === "error" ? 6000 : 3200);
  }, []);

  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setAsk({ ...o, resolve })), []);
  const answer = (ok: boolean) => {
    ask?.resolve(ok);
    setAsk(null);
  };

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      <div className="no-print pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={cn("animate-pop pointer-events-auto flex max-w-md items-start gap-2 rounded-xl px-4 py-2.5 text-sm font-medium shadow-pop", t.tone === "error" ? "bg-bad text-white" : "bg-ink text-white")}>
            {t.tone === "error" ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
            <span className="min-w-0 wrap-anywhere">{t.message}</span>
          </div>
        ))}
      </div>
      <Modal
        open={Boolean(ask)}
        onClose={() => answer(false)}
        title={ask?.title ?? ""}
        footer={
          <>
            <Button variant="secondary" onClick={() => answer(false)}>
              Batal
            </Button>
            <Button variant={ask?.danger ? "danger" : "primary"} onClick={() => answer(true)} autoFocus>
              {ask?.confirmLabel ?? "Ya, lanjutkan"}
            </Button>
          </>
        }
      >
        <div className="text-sm text-ink-soft wrap-anywhere">{ask?.message}</div>
      </Modal>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback harus dipakai di dalam FeedbackProvider");
  return ctx;
}
