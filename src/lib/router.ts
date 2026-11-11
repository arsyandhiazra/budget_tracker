// Penunjuk halaman sederhana berbasis "#" di alamat (mis. #/transaksi).
import { useEffect, useState } from "react";

const read = () => window.location.hash.replace(/^#/, "") || "/";

export function useRoute(): string {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function go(path: string, replace = false) {
  if (replace) window.location.replace(`#${path}`);
  else window.location.hash = path;
}
