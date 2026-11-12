// Pembaca file Excel (.xlsx) mini tanpa pustaka tambahan: membuka ZIP-nya lalu membaca isi lembar pertama.
// Pasangan dari xlsx.js (yang menulis). Dibuat hati-hati karena filenya berasal dari pengguna:
// ukuran hasil buka dibatasi (anti "zip bomb"), dan teks XML tidak pernah dijalankan sebagai apa pun.
import zlib from 'node:zlib';
import { bad } from './http.js';

const MAX_SHEET_BYTES = 40 * 1024 * 1024; // XML lembar setelah dibuka
const MAX_STRINGS_BYTES = 20 * 1024 * 1024;
export const MAX_SHEET_ROWS = 20_000;
const MAX_COLS = 60;
const BROKEN = () => bad('File Excel ini rusak atau bukan .xlsx yang valid. Coba simpan ulang dari Excel sebagai .xlsx atau .csv.');

// ── ZIP ──
function listEntries(buf) {
  const from = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= from; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw BROKEN();
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  if (count > 5000) throw BROKEN();
  const entries = new Map();
  for (let i = 0; i < count; i += 1) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) throw BROKEN();
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const size = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const offset = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    entries.set(name.replace(/^\/+/, ''), { method, compSize, size, offset });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extract(buf, entry, limit) {
  const { method, compSize, size, offset } = entry;
  if (size > limit) throw bad('Isi file Excel terlalu besar untuk diproses.');
  if (offset + 30 > buf.length || buf.readUInt32LE(offset) !== 0x04034b50) throw BROKEN();
  const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
  if (start + compSize > buf.length) throw BROKEN();
  const data = buf.subarray(start, start + compSize);
  try {
    if (method === 0) return data;
    if (method === 8) return zlib.inflateRawSync(data, { maxOutputLength: limit });
  } catch {
    throw BROKEN();
  }
  throw BROKEN();
}

// ── XML ──
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
  if (e[0] !== '#') return ENTITIES[e];
  const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
});
const attr = (tag, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
const textOf = (xml) => {
  let out = '';
  for (const m of xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += m[1];
  return unescapeXml(out);
};

function readSharedStrings(xml) {
  const list = [];
  for (const m of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) list.push(m[1] ? textOf(m[1]) : '');
  return list;
}

function columnIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function firstSheetPath(files, buf) {
  const wb = files.get('xl/workbook.xml');
  const rels = files.get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const wbXml = extract(buf, wb, 2_000_000).toString('utf8');
    const relXml = extract(buf, rels, 2_000_000).toString('utf8');
    for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
      if (/state="(hidden|veryHidden)"/.test(m[0])) continue;
      const rid = attr(m[0], 'r:id');
      for (const r of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
        if (attr(r[0], 'Id') !== rid) continue;
        const target = attr(r[0], 'Target');
        if (!target) continue;
        const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
        if (files.has(path)) return path;
      }
    }
  }
  const fallback = [...files.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
  return fallback[0] ?? null;
}

/** Membaca lembar pertama .xlsx menjadi baris-baris: [[sel, sel, ...], ...]. Sel: teks, angka, true/false, atau null. */
export function readXlsx(buf) {
  const files = listEntries(buf);
  const sheetPath = firstSheetPath(files, buf);
  if (!sheetPath) throw bad('Tidak ada lembar (sheet) yang bisa dibaca di file Excel ini.');
  const shared = files.has('xl/sharedStrings.xml') ? readSharedStrings(extract(buf, files.get('xl/sharedStrings.xml'), MAX_STRINGS_BYTES).toString('utf8')) : [];
  const xml = extract(buf, files.get(sheetPath), MAX_SHEET_BYTES).toString('utf8');

  const rows = [];
  let nextRow = 0;
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const declared = Number(attr(rm[1], 'r'));
    const rowIndex = Number.isInteger(declared) && declared > 0 ? declared - 1 : nextRow;
    nextRow = rowIndex + 1;
    if (rowIndex >= MAX_SHEET_ROWS) break;
    const content = rm[2];
    if (!content) continue;
    const row = [];
    let nextCol = 0;
    for (const cm of content.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], 'r');
      const col = ref ? columnIndex(ref) : nextCol;
      nextCol = col + 1;
      if (col < 0 || col >= MAX_COLS) continue;
      const type = attr(cm[1], 't');
      const body = cm[2] ?? '';
      let value = null;
      if (type === 'inlineStr') {
        value = textOf(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
      } else {
        const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (raw !== undefined) {
          if (type === 's') value = shared[Number(raw)] ?? null;
          else if (type === 'str') value = unescapeXml(raw);
          else if (type === 'b') value = raw === '1';
          else if (type === 'e') value = null;
          else { const n = Number(raw); value = Number.isFinite(n) ? n : null; }
        }
      }
      if (typeof value === 'string' && value === '') value = null;
      row[col] = value;
    }
    for (let i = 0; i < row.length; i += 1) if (row[i] === undefined) row[i] = null;
    rows[rowIndex] = row;
  }
  for (let i = 0; i < rows.length; i += 1) if (!rows[i]) rows[i] = [];
  while (rows.length && rows[rows.length - 1].every((c) => c === null)) rows.pop();
  return rows;
}
