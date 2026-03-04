declare const JSZip: any;

function tableToCSV(table: HTMLTableElement): string {
  return Array.from(table.rows)
    .map((row) =>
      Array.from(row.cells)
        .map((c) => `"${c.innerText.replace(/"/g, '""')}"`)
        .join(','),
    )
    .join('\n');
}

function tableName(table: HTMLTableElement, i: number): string {
  // Walk up to find a heading or use the table's closest id/aria-label
  const heading = table.closest('[class*="card"], section, [class*="Card"]')
    ?.querySelector('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="Title"]');
  const raw = table.id || table.getAttribute('aria-label') || heading?.textContent || `table-${i + 1}`;
  return raw.trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

export async function exportAllTablesToZip() {
  const tables = document.querySelectorAll<HTMLTableElement>('table');
  if (!tables.length) return;

  const zip = new JSZip();
  const seen = new Map<string, number>();

  tables.forEach((t, i) => {
    let name = tableName(t, i);
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    if (count > 1) name += `-${count}`;
    zip.file(`${name}.csv`, tableToCSV(t));
  });

  const blob: Blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: 'tables-export.zip' });
  a.click();
  URL.revokeObjectURL(url);
}
