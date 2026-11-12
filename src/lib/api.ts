// Jembatan antara tampilan (browser) dan server.
import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  status: number;
  code: string;
  data: Record<string, unknown>;
  constructor(status: number, code: string, message: string, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

type Options = { method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown };

export async function api<T = unknown>(path: string, { method = "GET", body }: Options = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        // Header ini penanda bahwa permintaan memang datang dari aplikasi kita.
        ...(method !== "GET" ? { "X-Requested-With": "BudgetTracker" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Tidak bisa terhubung ke server. Periksa koneksi internet kamu.");
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* jawaban tanpa isi */
  }
  if (!res.ok) {
    const err = data?.error ?? {};
    const error = new ApiError(res.status, err.code ?? "ERROR", err.message ?? "Terjadi kesalahan. Coba lagi ya.", err);
    if (res.status === 401 && error.code === "UNAUTHENTICATED") window.dispatchEvent(new Event("auth:expired"));
    throw error;
  }
  return data as T;
}

/** Mengirim file apa adanya (mis. Excel/CSV untuk impor). */
export async function uploadFile<T = unknown>(path: string, file: Blob): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/octet-stream", "X-Requested-With": "BudgetTracker" },
      body: file,
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Tidak bisa terhubung ke server. Periksa koneksi internet kamu.");
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* jawaban tanpa isi */
  }
  if (!res.ok) {
    const err = data?.error ?? {};
    const message = res.status === 413 ? "File terlalu besar (maksimal 3 MB). Bagi menjadi beberapa file." : (err.message ?? "Terjadi kesalahan. Coba lagi ya.");
    const error = new ApiError(res.status, err.code ?? "ERROR", message, err);
    if (res.status === 401 && error.code === "UNAUTHENTICATED") window.dispatchEvent(new Event("auth:expired"));
    throw error;
  }
  return data as T;
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi ya.");

/** Membangun query string, melewati nilai kosong. */
export function qs(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/**
 * Mengambil data dari server. Saat memuat ulang, data lama tetap ditampilkan
 * (sedikit dipudarkan) supaya layar tidak berkedip.
 */
export function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    try {
      const result = await api<T>(path);
      if (id === seq.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (id === seq.current) setError(errorMessage(err));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load };
}

/** Mengunduh file dari server (misalnya laporan Excel). */
export async function download(path: string, fallbackName: string) {
  const res = await fetch(`/api${path}`, { credentials: "same-origin" });
  if (!res.ok) throw new ApiError(res.status, "DOWNLOAD", "File tidak berhasil diunduh.");
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
