// Dipanggil otomatis oleh "npm start": kalau tampilan belum dibuat (folder dist
// belum ada), buat dulu. Jadi cukup satu perintah untuk menjalankan aplikasi.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\nAplikasi ini butuh Node.js versi 22.13 atau lebih baru (yang terpasang: ${process.versions.node}).\nUnduh versi terbaru (LTS) di https://nodejs.org lalu coba lagi.\n`);
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!fs.existsSync(path.join(root, "dist", "index.html"))) {
  console.log("Tampilan belum dibuat. Membuat dulu (sekitar setengah menit)…");
  const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");
  if (!fs.existsSync(vite)) {
    console.error('Folder node_modules belum ada. Jalankan "npm install" dulu.');
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [vite, "build"], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
