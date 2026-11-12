// Peran orang yang sedang masuk di pembukuan yang sedang dibuka. Dipakai halaman-halaman untuk
// menyembunyikan tombol yang pasti ditolak server (Pelihat hanya boleh melihat).
import { createContext, useContext, type ReactNode } from "react";
import type { Role } from "./types";

type BookState = { role: Role; canWrite: boolean; isOwner: boolean; userId: number };
const BookContext = createContext<BookState>({ role: "owner", canWrite: true, isOwner: true, userId: 0 });

export function BookProvider({ role, userId, children }: { role: Role; userId: number; children: ReactNode }) {
  return <BookContext.Provider value={{ role, userId, canWrite: role !== "viewer", isOwner: role === "owner" }}>{children}</BookContext.Provider>;
}

export const useBook = () => useContext(BookContext);

/** Isinya hanya tampil untuk yang boleh mengubah data (pemilik dan pencatat). */
export function WriteOnly({ children }: { children: ReactNode }) {
  return useBook().canWrite ? <>{children}</> : null;
}
