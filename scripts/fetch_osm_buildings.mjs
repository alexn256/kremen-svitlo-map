// Одноразова вивантаження контурів будівель Кременчука з OpenStreetMap
// (Overpass API) — кешується локально, повторно Overpass не турбуємо.
//
// Запуск: node scripts/fetch_osm_buildings.mjs
import { writeFileSync, existsSync } from 'node:fs';

const OUT_PATH = 'data/osm_kremenchuk_buildings.geojson';
const BBOX = '48.980,33.300,49.150,33.520'; // south,west,north,east

if (existsSync(OUT_PATH)) {
  console.log(`${OUT_PATH} вже існує — пропускаю завантаження. Видали файл, якщо треба оновити.`);
  process.exit(0);
}

const query = `[out:json][timeout:180];
(
  way["building"](${BBOX});
);
out geom;`;

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];

async function fetchOverpass() {
  for (const url of MIRRORS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`Overpass: ${url} (спроба ${attempt})...`);
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
          console.log(`  HTTP ${res.status}, чекаю і пробую ще...`);
          await new Promise((r) => setTimeout(r, 8000));
          continue;
        }
        return await res.json();
      } catch (e) {
        console.log(`  помилка: ${e}, чекаю і пробую ще...`);
        await new Promise((r) => setTimeout(r, 8000));
      }
    }
  }
  throw new Error('Overpass недоступний на жодному дзеркалі');
}

function wayToFeature(way) {
  if (!way.geometry || way.geometry.length < 3) return null;
  const coords = way.geometry.map((p) => [p.lon, p.lat]);
  // Замикаємо кільце, якщо Overpass цього не зробив.
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first);
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [coords] },
    properties: {
      osm_id: way.id,
      addr_street: way.tags?.['addr:street'] ?? null,
      addr_housenumber: way.tags?.['addr:housenumber'] ?? null,
    },
  };
}

const data = await fetchOverpass();
const features = (data.elements ?? [])
  .filter((el) => el.type === 'way')
  .map(wayToFeature)
  .filter(Boolean);

writeFileSync(OUT_PATH, JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`buildings: ${features.length}`);
console.log(`written to: ${OUT_PATH}`);
