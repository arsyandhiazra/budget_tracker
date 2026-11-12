// Kerangka halaman: menu samping di kiri, isi di kanan.
import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeftRight, BookOpenText, ChartNoAxesColumn, FileUp, HandCoins, LayoutDashboard, ListTree, LogOut, Menu, Moon, PiggyBank, Receipt, Settings, Sun, UsersRound, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { useTheme } from "@/lib/theme";
import { ROLE_LABEL, type BookInfo, type Invitation, type User } from "@/lib/types";
import { Badge, Button, Select } from "./ui";

const NAV = [
  {
    label: null,
    items: [
      { path: "/dasbor", label: "Dasbor", icon: LayoutDashboard },
      { path: "/transaksi", label: "Transaksi", icon: ArrowLeftRight },
      { path: "/faktur", label: "Faktur", icon: Receipt },
      { path: "/utang-piutang", label: "Utang & Piutang", icon: HandCoins },
      { path: "/anggaran", label: "Anggaran", icon: PiggyBank },
      { path: "/laporan", label: "Laporan", icon: ChartNoAxesColumn },
    ],
  },
  {
    label: "Pembukuan",
    items: [
      { path: "/jurnal", label: "Jurnal Umum", icon: BookOpenText },
      { path: "/akun", label: "Daftar Akun", icon: ListTree },
      { path: "/kontak", label: "Kontak", icon: UsersRound },
      { path: "/impor", label: "Impor Data", icon: FileUp },
    ],
  },
];

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-lg font-extrabold tracking-tight", className)}>
      <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-ink" aria-hidden>
        <svg viewBox="0 0 32 32" className="h-8 w-8">
          <path d="M8 22V16h3.5v6zM14.25 22V10h3.5v12zM20.5 22v-8H24v8z" className="fill-white" />
        </svg>
      </span>
      Budget Tracker
    </span>
  );
}

function NavLinks({ route, onNavigate }: { route: string; onNavigate?: () => void }) {
  const link = (item: { path: string; label: string; icon: typeof Settings }) => {
    const active = route === item.path || route.startsWith(`${item.path}/`);
    return (
      <li key={item.path}>
        <a
          href={`#${item.path}`}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={cn("flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] transition-colors", active ? "bg-paper font-bold text-ink" : "font-medium text-ink-soft hover:bg-paper/70")}
        >
          <item.icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
          {item.label}
        </a>
      </li>
    );
  };
  return (
    <nav aria-label="Menu utama" className="flex-1 space-y-6 overflow-y-auto px-4 py-2">
      {NAV.map((group, i) => (
        <div key={i}>
          {group.label && <p className="mb-1.5 px-3 text-xs font-semibold tracking-wide text-faint uppercase">{group.label}</p>}
          <ul className="space-y-0.5">{group.items.map(link)}</ul>
        </div>
      ))}
      <ul>{link({ path: "/pengaturan", label: "Pengaturan", icon: Settings })}</ul>
    </nav>
  );
}

/** Tombol cepat terang/gelap. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <Button variant="ghost" size="icon" onClick={toggle} className={className} aria-label={dark ? "Ganti ke tampilan terang" : "Ganti ke tampilan gelap"} title={dark ? "Tampilan terang" : "Tampilan gelap"}>
      {dark ? <Sun className="h-[18px] w-[18px]" aria-hidden /> : <Moon className="h-[18px] w-[18px]" aria-hidden />}
    </Button>
  );
}

/** Pemilih pembukuan: muncul kalau ada pembukuan lain yang dibagikan, dan menjelaskan peranmu di sana. */
function BookSwitcher({ user, books, onSwitch }: { user: User; books: BookInfo[]; onSwitch: (id: number) => void }) {
  if (books.length <= 1 && user.role === "owner") return null;
  return (
    <div className="px-4 pb-3">
      <label htmlFor="book-switch" className="mb-1 block px-1 text-xs font-semibold tracking-wide text-faint uppercase">
        Sedang dibuka
      </label>
      <Select id="book-switch" value={user.bookId} onChange={(e) => onSwitch(Number(e.target.value))} className="h-10 text-[13px] font-semibold">
        {books.map((b) => (
          <option key={b.id} value={b.id}>
            {b.own ? `${b.ready ? b.name : "Pembukuan saya"} (milikku)${b.ready ? "" : " · belum diatur"}` : `${b.name} · ${ROLE_LABEL[b.role]}`}
          </option>
        ))}
      </Select>
      {user.role !== "owner" && (
        <p className="mt-1.5 px-1 text-xs text-muted">
          Peranmu: <strong className="text-ink">{ROLE_LABEL[user.role]}</strong>
          {user.role === "viewer" ? " · hanya bisa melihat" : ""}
        </p>
      )}
    </div>
  );
}

function InvitationBanner({ invitations, onAnswer }: { invitations: Invitation[]; onAnswer: (id: number, accept: boolean) => void }) {
  if (!invitations.length) return null;
  return (
    <div className="no-print mx-auto w-full max-w-6xl space-y-2 px-4 pt-4 sm:px-8" role="region" aria-label="Undangan pembukuan">
      {invitations.map((i) => (
        <div key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-masuk/40 bg-masuk-soft px-4 py-3 text-sm">
          <UsersRound className="h-4 w-4 shrink-0 text-masuk-ink" aria-hidden />
          <p className="min-w-0 flex-1 text-ink">
            <strong>{i.ownerName}</strong> mengundangmu ke pembukuan <strong>{i.bookName}</strong> sebagai <Badge tone="neutral">{ROLE_LABEL[i.role]}</Badge>
          </p>
          <span className="flex gap-2">
            <Button size="sm" onClick={() => onAnswer(i.id, true)}>
              Terima
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onAnswer(i.id, false)}>
              Tolak
            </Button>
          </span>
        </div>
      ))}
    </div>
  );
}

function UserFooter({ user, onLogout }: { user: User; onLogout: () => void }) {
  const initials = user.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
  return (
    <div className="flex items-center gap-3 border-t border-line px-5 py-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-deep text-[13px] font-bold" aria-hidden>
        {initials}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{user.name}</p>
        <p className="truncate text-xs text-muted">{user.businessName || user.email}</p>
      </div>
      <ThemeToggle />
      <Button variant="ghost" size="icon" onClick={onLogout} aria-label="Keluar dari akun" title="Keluar">
        <LogOut className="h-[18px] w-[18px]" aria-hidden />
      </Button>
    </div>
  );
}

type LayoutProps = {
  user: User;
  books: BookInfo[];
  invitations: Invitation[];
  route: string;
  onLogout: () => void;
  onSwitchBook: (id: number) => void;
  onAnswerInvitation: (id: number, accept: boolean) => void;
  children: ReactNode;
};

export function Layout({ user, books, invitations, route, onLogout, onSwitchBook, onAnswerInvitation, children }: LayoutProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [route]);

  return (
    <div className="min-h-screen">
      {/* Menu samping (layar lebar) */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-white lg:flex">
        <a href="#/dasbor" className="px-7 pt-7 pb-5">
          <Brand />
        </a>
        <BookSwitcher user={user} books={books} onSwitch={onSwitchBook} />
        <NavLinks route={route} />
        <UserFooter user={user} onLogout={onLogout} />
      </aside>

      {/* Bilah atas (layar kecil) */}
      <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-white/95 px-4 backdrop-blur lg:hidden">
        <a href="#/dasbor">
          <Brand className="text-base" />
        </a>
        <span className="flex items-center">
          <ThemeToggle />
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Buka menu" aria-expanded={open}>
            <Menu className="h-5 w-5" aria-hidden />
          </Button>
        </span>
      </header>
      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="animate-fade absolute inset-0 bg-scrim" onClick={() => setOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-pop" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="flex items-center justify-between px-5 pt-5 pb-4">
              <Brand className="text-base" />
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Tutup menu">
                <X className="h-5 w-5" aria-hidden />
              </Button>
            </div>
            <BookSwitcher user={user} books={books} onSwitch={(id) => { setOpen(false); onSwitchBook(id); }} />
            <NavLinks route={route} onNavigate={() => setOpen(false)} />
            <UserFooter user={user} onLogout={onLogout} />
          </aside>
        </div>
      )}

      <main className="lg:pl-64">
        <InvitationBanner invitations={invitations} onAnswer={onAnswerInvitation} />
        {children}
      </main>
    </div>
  );
}

/** Pembungkus isi halaman biasa (selain dasbor yang punya pita atas sendiri). */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 pt-6 pb-28 sm:px-8 sm:pt-9", className)}>{children}</div>;
}
