// Mode pengembangan: menjalankan server API dan tampilan (Vite) bersamaan.
// Buka http://localhost:5173 — setiap perubahan kode langsung terlihat.
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (args) => spawn(process.execPath, args, { cwd: root, stdio: "inherit" });

const children = [
  run(["--disable-warning=ExperimentalWarning", "--watch", "server/index.js"]),
  run([path.join("node_modules", "vite", "bin", "vite.js")]),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exit(code);
}
for (const child of children) child.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
