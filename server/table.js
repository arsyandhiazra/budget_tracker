// Membaca file tabel dari pengguna (.xlsx atau .csv) menjadi baris-baris sel.
import { bad } from './http.js';
import { readXlsx } from './xlsx-read.js';

function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  const body = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return body.toString('latin1'); // CSV lama (Windows-1252)
  }
}

/** Mengurai CSV. Pemisah (koma, titik koma, atau tab) dikenali otomatis dari baris pertama. */
export function parseCsv(text) {
  const firstLine = text.split(/\r\n|\n|\r/).find((l) => l.trim() !== '') ?? '';
  const count = (ch) => { let n = 0; let q = false; for (const c of firstLine) { if (c === '"') q = !q; else if (c === ch && !q) n += 1; } return n; };
  const delimiter = [';', '\t', ','].map((d) => [d, count(d)]).sort((a, b) => b[1] - a[1])[0];
  const sep = delimiter[1] > 0 ? delimiter[0] : ',';

  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const endCell = () => { row.push(cell === '' ? null : cell); cell = ''; };
  const endRow = () => { endCell(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) endCell();
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i += 1; endRow(); }
    else cell += ch;
  }
  if (cell !== '' || row.length) endRow();
  while (rows.length && rows[rows.length - 1].every((c) => c === null)) rows.pop();
  return rows;
}

/** Mengenali jenis file dari isinya (bukan dari namanya), lalu membacanya. */
export function parseTable(buf) {
  if (!buf || !buf.length) throw bad('File kosong atau belum dipilih.');
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return readXlsx(buf);
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
    throw bad('File .xls (Excel versi lama) belum didukung. Buka di Excel, lalu "Simpan sebagai" .xlsx atau .csv.');
  }
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') throw bad('File PDF tidak bisa diimpor. Gunakan file .xlsx atau .csv.');
  if (buf.subarray(0, 4096).includes(0) && !(buf[0] === 0xff && buf[1] === 0xfe) && !(buf[0] === 0xfe && buf[1] === 0xff)) {
    throw bad('Format file tidak dikenali. Gunakan file .xlsx atau .csv.');
  }
  return parseCsv(decodeText(buf));
}
