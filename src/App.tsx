// Pintu utama tampilan: menentukan halaman mana yang muncul.
// Belum masuk → halaman akun. Sudah masuk tapi belum diatur → pengaturan awal.
// Sudah siap → aplikasi lengkap dengan menu samping dan chatbot.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { go, useRoute } from "@/lib/router";
import type { User } from "@/lib/types";
import { ChatWidget } from "@/components/ChatWidget";
import { Brand, Layout, Page } from "@/components/Layout";
import { Empty, FeedbackProvider, Loading, useFeedback } from "@/components/ui";
import { AccountsPage } from "@/pages/Accounts";
import { Forgot, Login, Onboarding, Register, Verify } from "@/pages/Auth";
import { BudgetsPage } from "@/pages/Budgets";
import { ContactsPage } from "@/pages/Contacts";
import { DashboardPage } from "@/pages/Dashboard";
import { DebtsPage } from "@/pages/Debts";
import { JournalPage } from "@/pages/Journal";
import { ReportsPage } from "@/pages/Reports";
import { SettingsPage } from "@/pages/Settings";
import { TransactionsPage } from "@/pages/Transactions";

const AUTH_ROUTES = ["/masuk", "/daftar", "/verifikasi", "/lupa-sandi"];

function Root() {
  const route = useRoute();
  const { toast } = useFeedback();
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined = masih mengecek

  useEffect(() => {
    api<{ user: User | null }>("/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  // Kalau sesi habis di tengah jalan, kembali ke halaman masuk.
  useEffect(() => {
    const onExpired = () => {
      setUser((u) => {
        if (u) toast("Sesi kamu sudah habis. Silakan masuk lagi.", "error");
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
    setUser(null);
    go("/masuk", true);
  }, []);

  const authed = useCallback((u: User) => {
    setUser(u);
    go("/dasbor", true);
  }, []);

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

  if (!user) {
    if (route === "/daftar") return <Register />;
    if (route === "/verifikasi") return <Verify onAuthed={authed} />;
    if (route === "/lupa-sandi") return <Forgot />;
    return <Login onAuthed={authed} />;
  }

  if (!user.onboarded) return <Onboarding user={user} onDone={setUser} onLogout={logout} />;

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
    case "pengaturan":
      page = <SettingsPage user={user} onUser={setUser} onLoggedOut={() => setUser(null)} />;
      break;
    default:
      page = (
        <Page>
          <Empty title="Halaman tidak ditemukan" text="Alamat yang kamu buka tidak ada. Pilih menu di samping untuk melanjutkan." />
        </Page>
      );
  }

  return (
    <>
      <Layout user={user} route={`/${section || "dasbor"}`} onLogout={logout}>
        {page}
      </Layout>
      <ChatWidget user={user} />
    </>
  );
}

export default function App() {
  return (
    <FeedbackProvider>
      <Root />
    </FeedbackProvider>
  );
}
