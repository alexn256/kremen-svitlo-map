// Геокодинг адрес через Google Geocoding API, з кешем (не платимо двічі за
// одну й ту саму адресу) і обмеженою паралельністю.
//
// Запуск: node --env-file=.env scripts/geocode.mjs [--limit N]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadExpanded } from './expand_houses.mjs';

const API_KEY = process.env.GOOGLE_GEOCODING_API_KEY;
if (!API_KEY) {
  console.error('GOOGLE_GEOCODING_API_KEY не знайдено — запускай через: node --env-file=.env scripts/geocode.mjs');
  process.exit(1);
}

const CACHE_PATH = 'geocode-cache.json';
const CONCURRENCY = 4;
// Ці статуси тимчасові (ліміт запитів/мережа) — не кешуємо їх як остаточну
// відповідь, інакше наступний прогін мовчки їх пропустить назавжди.
const RETRYABLE_STATUSES = new Set(['OVER_QUERY_LIMIT', 'UNKNOWN_ERROR', 'FETCH_ERROR']);

const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
}

function addressKey(street, house) {
  return `${street}|${house}`;
}

async function geocodeOne(street, house) {
  const query = `${street}, ${house}, Кременчук, Полтавська область, Україна`;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.length) {
    return { ok: false, status: data.status, query };
  }
  const r = data.results[0];
  return {
    ok: true,
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    precision: r.geometry.location_type, // ROOFTOP | RANGE_INTERPOLATED | GEOMETRIC_CENTER | APPROXIMATE
    formatted: r.formatted_address,
  };
}

async function main() {
  const expanded = loadExpanded();
  const uniquePairs = new Map(); // key -> { street, house_number }
  for (const rec of expanded) {
    const key = addressKey(rec.street, rec.house_number);
    if (!uniquePairs.has(key)) uniquePairs.set(key, rec);
  }

  const cache = loadCache();
  const todo = [...uniquePairs.entries()].filter(
    ([key]) => !(key in cache) || RETRYABLE_STATUSES.has(cache[key].status),
  );
  const work = LIMIT === Infinity ? todo : todo.slice(0, LIMIT);

  console.log(`unique addresses total: ${uniquePairs.size}`);
  console.log(`already cached: ${uniquePairs.size - todo.length}`);
  console.log(`to geocode now: ${work.length}${LIMIT !== Infinity ? ` (--limit ${LIMIT})` : ''}`);

  let done = 0;
  let ok = 0;
  let failed = 0;

  async function worker() {
    while (work.length) {
      const [key, rec] = work.shift();
      try {
        const result = await geocodeOne(rec.street, rec.house_number);
        cache[key] = result;
        if (result.ok) {
          ok++;
        } else {
          failed++;
          if (result.status === 'OVER_QUERY_LIMIT') await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (e) {
        cache[key] = { ok: false, status: 'FETCH_ERROR', error: String(e) };
        failed++;
      }
      done++;
      if (done % 50 === 0) {
        saveCache(cache);
        console.log(`  ${done} done (ok=${ok}, failed=${failed})`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  saveCache(cache);

  console.log(`\nFinished. ok=${ok}, failed=${failed}, cache size now=${Object.keys(cache).length}`);
  if (failed > 0) {
    const sample = Object.entries(cache).filter(([, v]) => !v.ok).slice(0, 10);
    console.log('sample of failed lookups:');
    for (const [key, v] of sample) console.log(` ${key} -> ${v.status}`);
  }
}

main();
