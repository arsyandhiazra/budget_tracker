// Bentuk data yang dikirim server.

export type User = {
  id: number;
  name: string;
  email: string;
  businessName: string | null;
  usage: "pribadi" | "usaha" | null;
  onboarded: boolean;
  createdAt: string;
};

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export type Account = {
  id: number;
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  system: boolean;
  archived: boolean;
  used: boolean;
  balance: number;
};

export type Ref = { id: number; name: string };

export type Line = { accountId: number; code: string; name: string; type: AccountType; subtype: string; debit: number; credit: number };

export type EntryKind = "income" | "expense" | "transfer" | "capital_in" | "drawing" | "debt" | "debt_payment" | "manual" | "opening";

export type Entry = {
  id: number;
  date: string;
  description: string;
  kind: EntryKind;
  amount: number;
  contact: Ref | null;
  lines: Line[];
  category?: Ref | null;
  cashAccount?: Ref | null;
  toAccount?: Ref | null;
};

export type Contact = {
  id: number;
  name: string;
  type: "customer" | "supplier" | "employee" | "other";
  email: string | null;
  phone: string | null;
  note: string | null;
  entries: number;
  payable: number;
  receivable: number;
};

export type Debt = {
  id: number;
  kind: "payable" | "receivable";
  amount: number;
  paid: number;
  remaining: number;
  date: string;
  dueDate: string | null;
  description: string;
  contact: Ref | null;
  account: string;
  status: "open" | "overdue" | "paid";
  payments: { id: number; amount: number; date: string }[];
};

export type BudgetItem = { accountId: number; code: string; name: string; budget: number; spent: number };
export type BudgetStatus = { month: string; items: BudgetItem[]; totalBudget: number; totalSpent: number };

export type Totals = { income: number; expense: number; net: number };

export type Dashboard = {
  from: string;
  to: string;
  kpis: Totals & { cashBalance: number };
  previous: Totals | null;
  wallets: { id: number; name: string; balance: number }[];
  monthly: { month: string; income: number; expense: number }[];
  expenseByCategory: { id: number; name: string; amount: number }[];
  incomeByCategory: { id: number; name: string; amount: number }[];
  budget: BudgetStatus;
  cashTrend: { date: string; balance: number }[];
  recent: Omit<Entry, "lines">[];
  debts: { payable: number; receivable: number; upcoming: Omit<Debt, "payments">[] };
  hasData: boolean;
};

export type ChatMessage = { id: number | string; role: "user" | "assistant"; content: string; mode?: string | null; createdAt?: string };

export const KIND_LABEL: Record<EntryKind, string> = {
  income: "Pemasukan",
  expense: "Pengeluaran",
  transfer: "Transfer",
  capital_in: "Setor modal",
  drawing: "Prive",
  debt: "Utang/piutang",
  debt_payment: "Pelunasan",
  manual: "Jurnal",
  opening: "Saldo awal",
};

export const TYPE_LABEL: Record<AccountType, string> = {
  asset: "Aset (harta)",
  liability: "Kewajiban (utang)",
  equity: "Modal",
  income: "Pendapatan",
  expense: "Beban (pengeluaran)",
};

export const SUBTYPE_LABEL: Record<string, string> = {
  cash: "Dompet (kas/bank)",
  receivable: "Piutang",
  inventory: "Persediaan barang",
  other_current: "Aset lancar lain",
  fixed: "Aset tetap",
  payable: "Utang usaha",
  loan: "Utang pinjaman",
  other: "Kewajiban lain",
  capital: "Modal pemilik",
  drawing: "Prive",
  revenue: "Pendapatan utama",
  other_income: "Pendapatan lain",
  cogs: "Harga pokok penjualan",
  operating: "Beban operasional",
  other_expense: "Beban lain",
};

export const SUBTYPES: Record<AccountType, string[]> = {
  asset: ["cash", "receivable", "inventory", "other_current", "fixed"],
  liability: ["payable", "loan", "other"],
  equity: ["capital", "drawing"],
  income: ["revenue", "other_income"],
  expense: ["operating", "cogs", "other_expense"],
};
