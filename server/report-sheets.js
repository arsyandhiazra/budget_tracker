// Mengubah data laporan menjadi baris-baris tabel untuk file Excel.

export const REPORT_NAMES = {
  journal: 'Jurnal Umum',
  ledger: 'Buku Besar',
  'trial-balance': 'Neraca Saldo',
  'income-statement': 'Laba Rugi',
  'balance-sheet': 'Neraca',
  equity: 'Perubahan Modal',
  'cash-flow': 'Arus Kas',
  debts: 'Utang Piutang',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export function fmtDate(date) {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const B = (v) => ({ v, bold: true });
const periodText = (r) => `Periode ${fmtDate(r.from)} s.d. ${fmtDate(r.to)}`;
const asOfText = (r) => `Per ${fmtDate(r.to)}`;

export function reportSheet(name, r, { owner }) {
  const title = REPORT_NAMES[name];
  const head = (subtitle) => [[{ v: title, title: true }], [owner], [subtitle], []];
  let rows;
  let widths;

  switch (name) {
    case 'journal':
      widths = [14, 12, 36, 18, 18];
      rows = [...head(periodText(r)), [B('Tanggal'), B('Kode'), B('Akun / Keterangan'), B('Debit'), B('Kredit')]];
      for (const e of r.entries) {
        rows.push([fmtDate(e.date), '', B(e.description)]);
        for (const l of e.lines) rows.push(['', l.code, l.credit > 0 ? `    ${l.name}` : l.name, l.debit || null, l.credit || null]);
      }
      rows.push([], ['', '', B('Total'), B(r.totalDebit), B(r.totalCredit)]);
      break;

    case 'ledger':
      widths = [14, 40, 18, 18, 18];
      rows = head(periodText(r));
      for (const a of r.accounts) {
        rows.push([B(`${a.code} — ${a.name}`)], [B('Tanggal'), B('Keterangan'), B('Debit'), B('Kredit'), B('Saldo')]);
        rows.push(['', 'Saldo awal', null, null, a.openingBalance]);
        for (const l of a.lines) rows.push([fmtDate(l.date), l.description, l.debit || null, l.credit || null, l.balance]);
        rows.push(['', B('Saldo akhir'), B(a.totalDebit), B(a.totalCredit), B(a.closingBalance)], []);
      }
      break;

    case 'trial-balance':
      widths = [12, 36, 18, 18];
      rows = [...head(asOfText(r)), [B('Kode'), B('Akun'), B('Debit'), B('Kredit')]];
      for (const a of r.rows) rows.push([a.code, a.name, a.debit || null, a.credit || null]);
      rows.push(['', B('Total'), B(r.totalDebit), B(r.totalCredit)]);
      break;

    case 'income-statement':
      widths = [12, 40, 20];
      rows = head(periodText(r));
      for (const s of r.sections) {
        if (!s.items.length) continue;
        rows.push([B(s.label)]);
        for (const i of s.items) rows.push([i.code, i.name, i.amount]);
        rows.push(['', B(`Total ${s.label}`), B(s.total)], []);
      }
      rows.push(['', B('Total pendapatan'), B(r.totalIncome)], ['', B('Total beban'), B(r.totalExpense)], ['', B(r.net >= 0 ? 'Laba bersih' : 'Rugi bersih'), B(r.net)]);
      break;

    case 'balance-sheet': {
      widths = [12, 40, 20];
      rows = head(asOfText(r));
      const block = (label, items, total) => {
        rows.push([B(label)]);
        for (const i of items) rows.push([i.code, i.name, i.amount]);
        rows.push(['', B(`Total ${label}`), B(total)], []);
      };
      block('Aset Lancar', r.assets.current, r.assets.totalCurrent);
      block('Aset Tetap', r.assets.fixed, r.assets.totalFixed);
      rows.push(['', B('TOTAL ASET'), B(r.assets.total)], []);
      block('Kewajiban', r.liabilities.items, r.liabilities.total);
      block('Modal', r.equity.items, r.equity.total);
      rows.push(['', B('TOTAL KEWAJIBAN + MODAL'), B(r.totalLiabilitiesAndEquity)]);
      break;
    }

    case 'equity':
      widths = [44, 20];
      rows = [
        ...head(periodText(r)),
        ['Modal awal', r.opening],
        ['Tambahan modal (setoran)', r.contributions],
        [r.net >= 0 ? 'Laba bersih periode ini' : 'Rugi bersih periode ini', r.net],
        ['Prive (penarikan oleh pemilik)', -r.drawings],
        [B('Modal akhir'), B(r.closing)],
      ];
      break;

    case 'cash-flow':
      widths = [12, 44, 20];
      rows = head(periodText(r));
      for (const s of r.sections) {
        rows.push([B(s.label)]);
        for (const i of s.items) rows.push([i.code, i.name, i.amount]);
        rows.push(['', B('Kas bersih'), B(s.total)], []);
      }
      rows.push(['', B('Kenaikan (penurunan) kas'), B(r.netChange)], ['', 'Kas awal periode', r.opening], ['', B('Kas akhir periode'), B(r.closing)]);
      break;

    case 'debts': {
      widths = [24, 36, 14, 14, 18, 18, 18];
      rows = head(`Per ${fmtDate(r.today)}`);
      const block = (label, g) => {
        rows.push([B(label)], [B('Kontak'), B('Keterangan'), B('Tanggal'), B('Jatuh tempo'), B('Jumlah'), B('Sudah dibayar'), B('Sisa')]);
        for (const d of g.items) rows.push([d.contact?.name || '-', d.description, fmtDate(d.date), fmtDate(d.dueDate) || '-', d.amount, d.paid, d.remaining]);
        rows.push(['', '', '', '', '', B('Total sisa'), B(g.total)], []);
      };
      block('Utang (yang harus kamu bayar)', r.payable);
      block('Piutang (yang harus kamu terima)', r.receivable);
      break;
    }

    default:
      throw new Error(`Laporan tidak dikenal: ${name}`);
  }
  return { name: title, widths, rows };
}
