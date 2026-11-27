// Розгортає діапазони домів ("76-140" -> 76,77,...,140) у плоский список
// окремих адрес. Чисто механічний крок, без геокодингу — використовується
// і для попередньої оцінки обсягу (--dry), і як модуль для geocode.mjs.
import { readFileSync } from 'node:fs';

export function expandHouseNumber(raw) {
  const s = String(raw).trim().replace(/^№\s*/, '');
  const m = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return [s];
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || b - a > 500) return [s];
  const out = [];
  for (let n = a; n <= b; n++) out.push(String(n));
  return out;
}

export function loadExpanded(path = 'data/kremenchuk_addresses.json') {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  const expanded = [];
  for (const rec of raw) {
    for (const house of expandHouseNumber(rec.house_number)) {
      expanded.push({ ...rec, house_number: house, source_range: rec.house_number });
    }
  }
  return expanded;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const expanded = loadExpanded();
  const uniqueAddr = new Set(expanded.map((r) => `${r.street}|${r.house_number}`));
  console.log('source records:', JSON.parse(readFileSync('data/kremenchuk_addresses.json', 'utf-8')).length);
  console.log('expanded house records:', expanded.length);
  console.log('unique (street, house) pairs:', uniqueAddr.size);
  const biggest = [...expanded.reduce((m, r) => {
    const k = r.source_range;
    m.set(k, (m.get(k) || 0) + 1);
    return m;
  }, new Map())].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log('top 10 biggest ranges (range -> expanded count):');
  for (const [range, count] of biggest) console.log(` ${range} -> ${count}`);
}
