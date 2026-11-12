// Halaman Impor Data: memasukkan banyak transaksi sekaligus dari file Excel (.xlsx) atau CSV.
// Alurnya dua tahap supaya aman: pratinjau dulu (belum menyimpan apa pun), baru impor.
import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Copy, Download, FileSpreadsheet, Lock, RotateCcw, Upload } from "lucide-react";
import { cn } from "@/utils/cn";
import { download, errorMessage, qs, uploadFile, useData } from "@/lib/api";
import { useBook } from "@/lib/book";
import { fmtDate, num, rp } from "@/lib/format";
import type { Account } from "@/lib/types";
import { Page } from "@/components/Layout";
import { Badge, Button, Card, ErrorBox, Field, PageHeader, Select, th, td, useFeedback } from "@/components/ui";

type Row = { row: number; status: "ok" | "error" | "duplicate"; message: string; date: string | null; kind: "income" | "expense" | null; amount: number; category: string; wallet: string; description: string; newCategory: boolean };
type Preview = {
  summary: {
    total: number; ok: number; errors: number; duplicates: number; income: number; expense: number; from: string | null; to: string | null;
    newCategories: { name: string; type: string }[];
    /** Kalau diimpor, saldo dompet ini jadi minus pada tanggal tersebut. */
    overdraft: { wallet: string; date: string; shortage: number; available: number } | null;
  };
  rows: Row[];
  truncated: boolean;
};
type Done = { imported: number; duplicatesSkipped: number; errorsSkipped: number; categoriesCreated: string[] };

const STEPS = ["Siapkan file", "Periksa pratinjau", "Selesai"];

function RowStatus({ r }: { r: Row }) {
  if (r.status === "ok") {
    return (
      <span className="inline-flex items-center gap-1 text-good">
        <CircleCheck className="h-3.5 w-3.5" aria-hidden /> Siap
      </span>
    );
  }
  if (r.status === "duplicate") {
    return (
      <span className="inline-flex items-start gap-1 text-warn">
        <Copy className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {r.message}
      </span>
    );
  }
  return (
    <span className="inline-flex items-start gap-1 text-bad">
      <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {r.message}
    </span>
  );
}

export function ImportPage() {
  const { canWrite } = useBook();
  const { toast } = useFeedback();
  const accounts = useData<{ accounts: Account[] }>("/accounts");
  const wallets = (accounts.data?.accounts ?? []).filter((a) => a.subtype === "cash" && !a.archived);
  const input = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [walletId, setWalletId] = useState("");
  const [createCategories, setCreateCategories] = useState(true);
  const [skipErrors, setSkipErrors] = useState(false);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!walletId && wallets.length) setWalletId(String(wallets[0].id));
  }, [walletId, wallets]);

  const params = useCallback(
    () => ({ defaultWalletId: walletId || null, createCategories: createCategories ? 1 : null }),
    [walletId, createCategories],
  );

  // Setiap file atau pilihan yang mengubah hasil pemeriksaan → periksa ulang (belum menyimpan apa pun).
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    uploadFile<Preview>(`/import/preview${qs(params())}`, file)
      .then((p) => !cancelled && setPreview(p))
      .catch((err) => {
        if (cancelled) return;
        setPreview(null);
        setError(errorMessage(err));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [file, params]);

  function choose(f: File | undefined | null) {
    if (!f) return;
    setDone(null);
    setPreview(null);
    setSkipErrors(false);
    setIncludeDuplicates(false);
    setFile(f);
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setDone(null);
    setError(null);
    if (input.current) input.current.value = "";
  }

  async function commit() {
    if (!file) return;
    setSaving(true);
    setError(null);
    try {
      const r = await uploadFile<Done>(`/import/commit${qs({ ...params(), skipErrors: skipErrors ? 1 : null, duplicates: includeDuplicates ? "include" : null })}`, file);
      setDone(r);
      toast(`${num(r.imported)} transaksi diimpor.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const s = preview?.summary;
  const importable = s ? s.ok + (includeDuplicates ? s.duplicates : 0) : 0;
  const blocked = Boolean(s && s.errors > 0 && !skipErrors);
  const overdraft = s?.overdraft ?? null;
  const step = done ? 2 : preview || loading ? 1 : 0;

  if (!canWrite) {
    return (
      <Page className="max-w-3xl">
        <PageHeader title="Impor Data" />
        <Card>
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <Lock className="mb-3 h-6 w-6 text-muted" aria-hidden />
            <p className="font-semibold">Kamu hanya bisa melihat pembukuan ini</p>
            <p className="mt-1 max-w-sm text-sm text-muted">Impor data hanya bisa dilakukan oleh pemilik atau pencatat.</p>
          </div>
        </Card>
      </Page>
    );
  }

  return (
    <Page className="max-w-5xl">
      <PageHeader title="Impor Data" description="Masukkan banyak transaksi sekaligus dari file Excel (.xlsx) atau CSV, misalnya hasil unduhan mutasi rekening atau catatan lamamu." />

      <ol className="mb-6 flex items-center gap-2 text-xs font-semibold" aria-label="Langkah impor">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2" aria-current={i === step ? "step" : undefined}>
            <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-[11px]", i <= step ? "bg-ink text-white" : "bg-paper-deep text-muted")}>{i + 1}</span>
            <span className={cn(i === step ? "text-ink" : "hidden text-muted sm:inline")}>{label}</span>
            {i < STEPS.length - 1 && <span className="h-px w-6 bg-line-strong" aria-hidden />}
          </li>
        ))}
      </ol>

      {done ? (
        <Card className="p-8 text-center">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-good-soft text-good">
            <CircleCheck className="h-6 w-6" aria-hidden />
          </span>
          <h2 className="text-xl font-bold tracking-tight">{num(done.imported)} transaksi berhasil diimpor</h2>
          <ul className="mt-3 space-y-1 text-sm text-muted">
            {done.categoriesCreated.length > 0 && <li>Kategori baru dibuat: {done.categoriesCreated.join(", ")}</li>}
            {done.duplicatesSkipped > 0 && <li>{num(done.duplicatesSkipped)} baris duplikat dilewati</li>}
            {done.errorsSkipped > 0 && <li>{num(done.errorsSkipped)} baris bermasalah dilewati</li>}
          </ul>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <a href="#/transaksi" className="inline-flex h-10 items-center rounded-xl bg-ink px-4 text-sm font-semibold text-white hover:bg-ink-soft">
              Lihat transaksi
            </a>
            <Button variant="secondary" onClick={reset}>
              <RotateCcw className="h-4 w-4" aria-hidden /> Impor file lain
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card className="p-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_16rem]">
              <div>
                <button
                  type="button"
                  onClick={() => input.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    choose(e.dataTransfer.files[0]);
                  }}
                  className={cn("flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors", dragging ? "border-ink bg-paper" : "border-line-strong hover:bg-paper/60")}
                >
                  {file ? <FileSpreadsheet className="h-7 w-7" aria-hidden /> : <Upload className="h-7 w-7 text-muted" aria-hidden />}
                  <span className="font-semibold">{file ? file.name : "Pilih file atau seret ke sini"}</span>
                  <span className="text-[13px] text-muted">{file ? `${(file.size / 1024).toFixed(file.size < 10240 ? 1 : 0)} KB · klik untuk mengganti` : "Excel (.xlsx) atau CSV, maksimal 3 MB dan 2.000 baris"}</span>
                </button>
                <input ref={input} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" aria-label="Pilih file Excel atau CSV" onChange={(e) => choose(e.target.files?.[0])} />
              </div>

              <div className="space-y-4">
                <Field label="Dompet bawaan" hint="Dipakai untuk baris yang kolom dompetnya kosong.">
                  {(id) => (
                    <Select id={id} value={walletId} onChange={(e) => setWalletId(e.target.value)}>
                      {wallets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={createCategories} onChange={(e) => setCreateCategories(e.target.checked)} className="mt-0.5 h-4 w-4 accent-ink" />
                  <span>
                    Buat kategori yang belum ada
                    <span className="block text-[13px] text-muted">Kalau dimatikan, baris dengan kategori baru dianggap bermasalah.</span>
                  </span>
                </label>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-4 text-sm">
              <Button variant="secondary" size="sm" onClick={() => download("/import/template", "template-impor-transaksi.xlsx").catch((e) => toast(errorMessage(e), "error"))}>
                <Download className="h-3.5 w-3.5" aria-hidden /> Unduh template Excel
              </Button>
              <p className="w-full min-w-0 text-[13px] break-words text-muted sm:w-auto sm:flex-1">
                Kolom yang dikenali: <strong className="text-ink-soft">Tanggal, Jenis</strong> (Pemasukan/Pengeluaran), <strong className="text-ink-soft">Jumlah, Kategori, Dompet, Keterangan</strong>. Boleh juga dua kolom Pemasukan dan Pengeluaran, atau jumlah dengan tanda minus. Tanggal ditulis hari/bulan/tahun.
              </p>
            </div>
          </Card>

          {error && <ErrorBox message={error} />}
          {loading && <p className="text-center text-sm text-muted">Memeriksa file…</p>}

          {preview && s && !loading && (
            <Card>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-5 py-4 text-sm">
                <p>
                  <span className="font-semibold">{num(s.total)}</span> baris dibaca
                  {s.from && s.to ? ` · ${fmtDate(s.from)} s.d. ${fmtDate(s.to)}` : ""}
                </p>
                <Badge tone="good">{num(s.ok)} siap</Badge>
                {s.duplicates > 0 && <Badge tone="warn">{num(s.duplicates)} duplikat</Badge>}
                {s.errors > 0 && <Badge tone="bad">{num(s.errors)} bermasalah</Badge>}
                <p className="ml-auto flex flex-wrap gap-x-5 text-muted">
                  <span>
                    <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[3px] bg-masuk" aria-hidden />
                    Masuk <span className="tnum font-semibold text-ink">{rp(s.income)}</span>
                  </span>
                  <span>
                    <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[3px] bg-keluar" aria-hidden />
                    Keluar <span className="tnum font-semibold text-ink">{rp(s.expense)}</span>
                  </span>
                </p>
              </div>

              {s.newCategories.length > 0 && (
                <p className="border-b border-line bg-paper px-5 py-3 text-[13px] text-ink-soft">
                  Kategori baru yang akan dibuat: <strong>{s.newCategories.map((c) => c.name).join(", ")}</strong>
                </p>
              )}

              {/* HP: satu kartu per baris. Tabel enam kolom tidak muat di layar sempit. */}
              <ul className="max-h-[28rem] divide-y divide-line overflow-auto md:hidden">
                {preview.rows.map((r) => (
                  <li key={r.row} className={cn("px-4 py-3 text-sm", r.status === "error" && "bg-bad-soft/40", r.status === "duplicate" && "bg-warn-soft/40")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="tnum text-xs text-muted">
                          Baris {r.row} · {r.date ? fmtDate(r.date) : "-"}
                        </p>
                        <p className="font-semibold break-words">{r.description || "-"}</p>
                      </div>
                      <p className={cn("tnum shrink-0 font-semibold whitespace-nowrap", r.kind === "income" ? "text-masuk-ink" : r.kind === "expense" ? "text-keluar-ink" : "")}>
                        {r.kind === "income" ? "+" : r.kind === "expense" ? "-" : ""}
                        {r.amount ? rp(r.amount) : "-"}
                      </p>
                    </div>
                    <p className="mt-0.5 text-[13px] text-muted">
                      {r.category || "-"} · {r.wallet || "-"}
                      {r.newCategory && <Badge tone="neutral" className="ml-1.5">baru</Badge>}
                    </p>
                    <p className="mt-1 text-[13px]">
                      <RowStatus r={r} />
                    </p>
                  </li>
                ))}
              </ul>
              <div className="hidden max-h-[28rem] overflow-auto md:block">
                <table className="w-full min-w-[44rem]">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-line">
                      <th scope="col" className={th}>Baris</th>
                      <th scope="col" className={th}>Tanggal</th>
                      <th scope="col" className={th}>Keterangan</th>
                      <th scope="col" className={th}>Kategori · Dompet</th>
                      <th scope="col" className={`${th} text-right`}>Jumlah</th>
                      <th scope="col" className={th}>Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {preview.rows.map((r) => (
                      <tr key={r.row} className={cn(r.status === "error" && "bg-bad-soft/40", r.status === "duplicate" && "bg-warn-soft/40")}>
                        <td className={`${td} tnum text-muted`}>{r.row}</td>
                        <td className={`${td} tnum whitespace-nowrap`}>{r.date ? fmtDate(r.date) : "-"}</td>
                        <td className={`${td} max-w-[16rem] truncate`}>{r.description}</td>
                        <td className={`${td} text-[13px] text-muted`}>
                          {r.category || "-"} · {r.wallet || "-"}
                          {r.newCategory && <Badge tone="neutral" className="ml-1.5">baru</Badge>}
                        </td>
                        <td className={cn(td, "tnum text-right font-semibold whitespace-nowrap", r.kind === "income" ? "text-masuk-ink" : r.kind === "expense" ? "text-keluar-ink" : "")}>
                          {r.kind === "income" ? "+" : r.kind === "expense" ? "-" : ""}
                          {r.amount ? rp(r.amount) : "-"}
                        </td>
                        <td className={`${td} text-[13px]`}>
                          <RowStatus r={r} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.truncated && <p className="border-t border-line px-5 py-3 text-[13px] text-muted">Hanya sebagian baris yang ditampilkan. Semua baris tetap diperiksa dan diimpor.</p>}

              <div className="space-y-3 border-t border-line px-5 py-4">
                {overdraft && (
                  <p className="flex gap-2.5 rounded-2xl border border-bad/30 bg-bad-soft px-4 py-3 text-[13px] text-bad" role="alert">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>
                      Impor ini membuat saldo <strong>{overdraft.wallet}</strong> minus pada {fmtDate(overdraft.date)} (kurang {rp(overdraft.shortage)}), jadi ditolak. Catat saldo awal atau pemasukan lebih dulu (bertanggal sebelum itu), atau keluarkan baris pengeluarannya dari file.
                    </span>
                  </p>
                )}
                {s.errors > 0 && (
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={skipErrors} onChange={(e) => setSkipErrors(e.target.checked)} className="mt-0.5 h-4 w-4 accent-ink" />
                    <span>
                      Lewati {num(s.errors)} baris bermasalah, impor sisanya
                      <span className="block text-[13px] text-muted">Atau perbaiki dulu di file Excel-nya, lalu pilih file itu lagi.</span>
                    </span>
                  </label>
                )}
                {s.duplicates > 0 && (
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={includeDuplicates} onChange={(e) => setIncludeDuplicates(e.target.checked)} className="mt-0.5 h-4 w-4 accent-ink" />
                    <span>
                      Tetap impor {num(s.duplicates)} baris yang tampaknya duplikat
                      <span className="block text-[13px] text-muted">Biasanya dibiarkan mati supaya transaksi yang sama tidak tercatat dua kali.</span>
                    </span>
                  </label>
                )}
                <div className="flex flex-wrap items-center justify-end gap-3">
                  {blocked && <p className="text-[13px] text-bad">Centang &ldquo;lewati baris bermasalah&rdquo; untuk melanjutkan.</p>}
                  <Button variant="secondary" onClick={reset}>
                    Batal
                  </Button>
                  <Button onClick={commit} loading={saving} disabled={blocked || importable === 0 || Boolean(overdraft)}>
                    Impor {num(importable)} transaksi
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </Page>
  );
}
