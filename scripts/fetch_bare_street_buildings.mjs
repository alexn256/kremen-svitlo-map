// Універсальна добудова покриття: для КОЖНОЇ вулиці, яка взагалі згадана в
// data/kremenchuk_addresses.json (незалежно від того, чи були в джерелі
// номери будинків), шукаємо в OSM саму лінію вулиці і беремо всі реальні
// будівлі поруч із нею (буфер ~30м). Так заповнюються цілі райони
// ("Перший Занасип" і подібні), де в джерелі вулиця згадана, а конкретні
// номери — ні, або й узагалі ніхто не намагався перелічити кожен дім.
//
// Якщо та сама вулиця зустрічається під кількома чергами — в результат
// потрапляють усі, кожна будівля дублюється під кожну чергу (на карті потім
// треба буде розібратись, яка саме чинна «зараз», але це питання не сюди).
import { writeFileSync, existsSync, readFileSync } from 'node:fs';

// Джерело списку вулиць можна перемкнути аргументом:
//   node scripts/fetch_bare_street_buildings.mjs addresses  -> з kremenchuk_addresses.json (уже є номери)
//   node scripts/fetch_bare_street_buildings.mjs missing    -> з missing_street_candidates.json (зовсім пропущені)
const MODE = process.argv[2] ?? 'addresses'; // addresses | missing | missing2 | missing3
const OUT_PATH =
  MODE === 'missing3' ? 'data/missing_street_buildings3.json'
  : MODE === 'missing2' ? 'data/missing_street_buildings2.json'
  : MODE === 'missing' ? 'data/missing_street_buildings.json'
  : 'data/street_buildings.json';
const BBOX = '48.980,33.300,49.150,33.520';

if (existsSync(OUT_PATH)) {
  console.log(`${OUT_PATH} вже існує — пропускаю. Видали файл, якщо треба перерахувати.`);
  process.exit(0);
}

const streetToQueues = new Map(); // street -> Set("cherga.pid")
if (MODE === 'missing' || MODE === 'missing2' || MODE === 'missing3') {
  const file =
    MODE === 'missing3' ? 'data/missing_street_candidates3.json'
    : MODE === 'missing2' ? 'data/missing_street_candidates2.json'
    : 'data/missing_street_candidates.json';
  const missing = JSON.parse(readFileSync(file, 'utf-8'));
  for (const rec of missing) {
    const q = `${rec.cherga}.${rec.pid_cherga}`;
    if (!streetToQueues.has(rec.street)) streetToQueues.set(rec.street, new Set());
    streetToQueues.get(rec.street).add(q);
  }
} else {
  const addresses = JSON.parse(readFileSync('data/kremenchuk_addresses.json', 'utf-8'));
  for (const rec of addresses) {
    const q = `${rec.cherga}.${rec.pid_cherga}`;
    if (!streetToQueues.has(rec.street)) streetToQueues.set(rec.street, new Set());
    streetToQueues.get(rec.street).add(q);
  }
}
const allNames = [...streetToQueues.keys()];
console.log(`Режим: ${MODE}. Унікальних назв вулиць: ${allNames.length}`);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// Overpass regex — розбиваємо на пачки, щоб один запит не був надто довгим.
const BATCH = 60;
const batches = [];
for (let i = 0; i < allNames.length; i += BATCH) batches.push(allNames.slice(i, i + BATCH));

async function fetchOverpass(query) {
  const url = 'https://overpass-api.de/api/interpreter';
  for (let attempt = 1; attempt <= 4; attempt++) {
    console.log(`  Overpass спроба ${attempt}...`);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'kremen-svitlo-map-research/1.0',
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) {
        console.log(`    HTTP ${res.status}, чекаю...`);
        await new Promise((r) => setTimeout(r, 15000));
        continue;
      }
      return await res.json();
    } catch (e) {
      console.log(`    помилка: ${e}, чекаю...`);
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
  throw new Error('Overpass недоступний після кількох спроб');
}

function wayCenter(way) {
  const lats = way.geometry.map((p) => p.lat);
  const lons = way.geometry.map((p) => p.lon);
  return { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 };
}
function wayToRing(way) {
  const coords = way.geometry.map((p) => [p.lon, p.lat]);
  const first = coords[0], last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first);
  return coords;
}
const M_LAT = 111320;
const M_LNG = 111320 * Math.cos((49.07 * Math.PI) / 180);
function metersBetween(a, b) {
  const dx = (a.lon - b.lon) * M_LNG, dy = (a.lat - b.lat) * M_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

const buildingsByStreet = new Map(); // street name -> [ring, ring, ...]

let batchNum = 0;
for (const batch of batches) {
  batchNum++;
  console.log(`Пачка ${batchNum}/${batches.length} (${batch.length} вулиць)...`);
  // OSM зберігає назви як "Хорольська вулиця"/"вулиця Хорольська" — без
  // прив'язки до країв рядка, щоб ловити назву всередині будь-якого варіанту.
  const namePattern = batch.map(escapeRegex).join('|');
  const query = `[out:json][timeout:180];
way["highway"]["name"~"(${namePattern})"](${BBOX})->.streets;
(
  way(around.streets:30)["building"];
);
out geom;
.streets out geom;`;

  const data = await fetchOverpass(query);
  const elements = data.elements ?? [];
  const streetWays = elements.filter((e) => e.type === 'way' && e.tags?.highway);
  const buildingWays = elements.filter((e) => e.type === 'way' && e.tags?.building);
  console.log(`  знайдено ліній вулиць: ${streetWays.length}, будівель поруч: ${buildingWays.length}`);

  // Ключуємо НЕ за назвою з OSM ("Хорольська вулиця"), а за нашою вихідною
  // назвою з джерела ("Хорольська") — інакше результат не зійдеться з
  // streetToQueues на останньому кроці.
  const streetsByName = new Map();
  for (const w of streetWays) {
    const osmName = w.tags.name;
    if (!osmName) continue;
    for (const ourName of batch) {
      if (osmName.includes(ourName)) {
        if (!streetsByName.has(ourName)) streetsByName.set(ourName, []);
        streetsByName.get(ourName).push(wayCenter(w));
      }
    }
  }

  function nearestStreetName(center) {
    let best = null, bestD = Infinity;
    for (const [name, centers] of streetsByName) {
      for (const c of centers) {
        const d = metersBetween(center, c);
        if (d < bestD) { bestD = d; best = name; }
      }
    }
    return best;
  }

  for (const b of buildingWays) {
    if (!b.geometry || b.geometry.length < 3) continue;
    const streetName = nearestStreetName(wayCenter(b));
    if (!streetName) continue;
    if (!buildingsByStreet.has(streetName)) buildingsByStreet.set(streetName, []);
    buildingsByStreet.get(streetName).push(wayToRing(b));
  }
}

const result = [];
for (const [street, queues] of streetToQueues) {
  const rings = buildingsByStreet.get(street) ?? [];
  for (const q of queues) {
    const [cherga, pid_cherga] = q.split('.').map(Number);
    result.push({ street, cherga, pid_cherga, buildingCount: rings.length, rings });
  }
}

writeFileSync(OUT_PATH, JSON.stringify(result));
const withBuildings = result.filter((r) => r.buildingCount > 0);
console.log(`\nВулиць(+черг) з хоч однією знайденою будівлею: ${withBuildings.length} / ${result.length}`);
console.log(`Всього знайдених будівель (із дублями по чергах): ${result.reduce((s, r) => s + r.buildingCount, 0)}`);
console.log(`Записано в ${OUT_PATH}`);
