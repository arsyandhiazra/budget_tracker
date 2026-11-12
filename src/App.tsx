// Pintu utama tampilan: menentukan halaman mana yang muncul.
// Belum masuk → halaman akun. Sudah masuk tapi belum diatur → pengaturan awal.
// Sudah siap → aplikasi lengkap dengan menu samping dan chatbot.
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { BookProvider } from "@/lib/book";
import { go, useRoute } from "@/lib/router";
import type { Me, User } from "@/lib/types";
import { ChatWidget } from "@/components/ChatWidget";
import { Brand, Layout, Page } from "@/components/Layout";
import { Empty, FeedbackProvider, Loading, useFeedback } from "@/components/ui";
import { AccountsPage } from "@/pages/Accounts";
import { Forgot, Login, Onboarding, Register, Verify } from "@/pages/Auth";
import { BudgetsPage } from "@/pages/Budgets";
import { ContactsPage } from "@/pages/Contacts";
import { DashboardPage } from "@/pages/Dashboard";
import { DebtsPage } from "@/pages/Debts";
import { ImportPage } from "@/pages/Import";
import { InvoicesPage, InvoiceViewPage } from "@/pages/Invoices";
import { JournalPage } from "@/pages/Journal";
import { ReportsPage } from "@/pages/Reports";
import { SettingsPage } from "@/pages/Settings";
import { TransactionsPage } from "@/pages/Transactions";

const AUTH_ROUTES = ["/masuk", "/daftar", "/verifikasi", "/lupa-sandi"];

function Root() {
  const route = useRoute();
  const { toast } = useFeedback();
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = masih mengecek
  const user = me === undefined ? undefined : (me?.user ?? null);

  const refresh = useCallback(async () => {
    const r = await api<Me>("/auth/me");
    setMe(r);
    return r;
  }, []);

  useEffect(() => {
    refresh().catch(() => setMe(null));
  }, [refresh]);

  // Kalau sesi habis di tengah jalan, kembali ke halaman masuk.
  useEffect(() => {
    const onExpired = () => {
      setMe((m) => {
        if (m?.user) toast("Sesi kamu sudah habis. Silakan masuk lagi.", "error");
        return null;
      });
    };
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, [toast]);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* tetap keluar di sisi tampilan */
    }
    setMe(null);
    go("/masuk", true);
  }, []);

  // Setelah masuk/verifikasi/pengaturan awal: tampilkan dulu, lalu lengkapi daftar pembukuan & undangan.
  const authed = useCallback(
    (u: User) => {
      setMe((m) => ({ books: [], invitations: [], mailMode: "smtp", ...(m ?? {}), user: u }));
      go("/dasbor", true);
      void refresh().catch(() => undefined);
    },
    [refresh],
  );

  const updateUser = useCallback(
    (u: User) => {
      setMe((m) => (m ? { ...m, user: u } : m));
      void refresh().catch(() => undefined);
    },
    [refresh],
  );

  // Berpindah pembukuan: seluruh halaman dimuat ulang (lihat "key" di bawah) supaya data tidak tercampur.
  const switchBook = useCallback(
    async (bookId: number) => {
      try {
        const r = await api<Me>("/auth/book", { method: "POST", body: { bookId } });
        setMe(r);
        go("/dasbor", true);
      } catch (err) {
        toast(errorMessage(err), "error");
      }
    },
    [toast],
  );

  const answerInvitation = useCallback(
    async (id: number, accept: boolean) => {
      try {
        if (accept) {
          const r = await api<Me>(`/auth/invitations/${id}/accept`, { method: "POST" });
          setMe(r);
          go("/dasbor", true);
          toast("Kamu sudah bergabung. Pembukuannya sedang terbuka.");
        } else {
          await api(`/auth/invitations/${id}/decline`, { method: "POST" });
          await refresh();
          toast("Undangan ditolak.");
        }
      } catch (err) {
        toast(errorMessage(err), "error");
      }
    },
    [refresh, toast],
  );

  // Pengguna yang sudah masuk tidak perlu melihat halaman masuk/daftar lagi.
  useEffect(() => {
    if (user?.onboarded && (route === "/" || AUTH_ROUTES.includes(route))) go("/dasbor", true);
  }, [user, route]);

  // Pindah halaman = mulai dari atas.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  if (user === undefined) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <Brand />
        <Loading label="Menyiapkan aplikasi…" />
      </div>
    );
  }

  if (!user || !me) {
    if (route === "/daftar") return <Register />;
    if (route === "/verifikasi") return <Verify onAuthed={authed} />;
    if (route === "/lupa-sandi") return <Forgot />;
    return <Login onAuthed={authed} />;
  }

  if (!user.onboarded) {
    return <Onboarding user={user} books={me.books} invitations={me.invitations} onDone={authed} onSwitchBook={switchBook} onAnswerInvitation={answerInvitation} onLogout={logout} />;
  }

  const [, section, sub] = route.split("/");
  let page;
  switch (section) {
    case "":
    case "dasbor":
    case "masuk":
    case "daftar":
    case "verifikasi":
    case "lupa-sandi":
      page = <DashboardPage user={user} />;
      break;
    case "transaksi":
      page = <TransactionsPage />;
      break;
    case "faktur":
      page = sub ? <InvoiceViewPage id={sub} /> : <InvoicesPage />;
      break;
    case "utang-piutang":
      page = <DebtsPage />;
      break;
    case "anggaran":
      page = <BudgetsPage />;
      break;
    case "laporan":
      page = <ReportsPage user={user} slug={sub ?? "laba-rugi"} />;
      break;
    case "jurnal":
      page = <JournalPage />;
      break;
    case "akun":
      page = <AccountsPage />;
      break;
    case "kontak":
      page = <ContactsPage />;
      break;
    case "impor":
      page = <ImportPage />;
      break;
    case "pengaturan":
      page = <SettingsPage user={user} books={me.books} onUser={updateUser} onSwitchBook={switchBook} onLoggedOut={() => setMe(null)} onBooksChanged={() => void refresh().catch(() => undefined)} />;
      break;
    default:
      page = (
        <Page>
          <Empty title="Halaman tidak ditemukan" text="Alamat yang kamu buka tidak ada. Pilih menu di samping untuk melanjutkan." />
        </Page>
      );
  }

  return (
    <BookProvider role={user.role} userId={user.id}>
      {/* key = id pembukuan: berpindah pembukuan memuat ulang semua halaman dari nol */}
      <div key={user.bookId}>
        <Layout user={user} books={me.books} invitations={me.invitations} route={`/${section || "dasbor"}`} onLogout={logout} onSwitchBook={switchBook} onAnswerInvitation={answerInvitation}>
          {page}
        </Layout>
        <ChatWidget user={user} />
      </div>
    </BookProvider>
  );
}

export default function App() {
  return (
    <FeedbackProvider>
      <Root />
    </FeedbackProvider>
  );
}
