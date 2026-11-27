// Останній крок пайплайну: об'єднує геокодовані координати (geocode-cache.json)
// з контурами будівель OSM (data/osm_kremenchuk_buildings.geojson) і пише
// підсумковий public/houses.geojson — те, що реально малює карта.
//
// Для кожного будинку: якщо геокодована точка потрапляє в контур будівлі —
// пишемо Polygon (саме цей контур). Якщо ні — фолбек Point.
//
// Запуск: node scripts/match_houses.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadExpanded } from './expand_houses.mjs';

const CELL = 0.002; // ~200м — досить дрібно для щільної забудови міста

function cellKey(lng, lat) {
  return `${Math.floor(lng / CELL)}:${Math.floor(lat / CELL)}`;
}

function bboxCells(coords) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const cells = [];
  for (let x = Math.floor(minLng / CELL); x <= Math.floor(maxLng / CELL); x++) {
    for (let y = Math.floor(minLat / CELL); y <= Math.floor(maxLat / CELL); y++) {
      cells.push(`${x}:${y}`);
    }
  }
  return cells;
}

// Стандартний ray-casting point-in-polygon (без діркованих полігонів — для
// будівель OSM цього достатньо).
function pointInPolygon(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

console.log('Завантажую будівлі OSM...');
const buildings = JSON.parse(readFileSync('data/osm_kremenchuk_buildings.geojson', 'utf-8')).features;

console.log('Будую просторовий індекс...');
const index = new Map();
buildings.forEach((f, i) => {
  for (const cell of bboxCells(f.geometry.coordinates[0])) {
    if (!index.has(cell)) index.set(cell, []);
    index.get(cell).push(i);
  }
});

const M_LAT = 111320; // метрів в 1° широти
const M_LNG = 111320 * Math.cos((49.07 * Math.PI) / 180); // те саме для довготи на широті Кременчука

function metersBetween(lng1, lat1, lng2, lat2) {
  const dx = (lng1 - lng2) * M_LNG;
  const dy = (lat1 - lat2) * M_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

function pointToSegmentMeters(lng, lat, [x1, y1], [x2, y2]) {
  const dx = (x2 - x1) * M_LNG, dy = (y2 - y1) * M_LAT;
  const px = (lng - x1) * M_LNG, py = (lat - y1) * M_LAT;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
  const projX = px - t * dx, projY = py - t * dy;
  return Math.sqrt(projX * projX + projY * projY);
}

function distanceToPolygonMeters(lng, lat, ring) {
  let min = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const d = pointToSegmentMeters(lng, lat, ring[i], ring[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

const NEAREST_THRESHOLD_M = 20;

// Висоти в метрах для fill-extrusion. Збігається з BUILDING_HEIGHT_M у
// src/config.ts — синтетичні "кубики" навмисно нижчі за справжні контури,
// щоб на карті було видно різницю між точним будинком і приблизною точкою.
const REAL_HEIGHT_M = 12;
const FALLBACK_HEIGHT_M = 6;

// Маленький квадратний контур навколо точки — щоб адреси без знайденого
// контуру будівлі теж виглядали об'ємними "кубиками", а не плоскими точками.
const FALLBACK_HALF_M = 4;
function squareAround(lng, lat, halfMeters) {
  const dLng = halfMeters / M_LNG;
  const dLat = halfMeters / M_LAT;
  return [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat + dLat],
    [lng - dLng, lat - dLat],
  ];
}

function neighborCells(lng, lat) {
  const cx = Math.floor(lng / CELL), cy = Math.floor(lat / CELL);
  const out = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) out.push(`${cx + dx}:${cy + dy}`);
  return out;
}

// Спершу строге влучення в контур; якщо немає — найближча будівля в радіусі
// ~20м (невеликі розбіжності координат між Google і OSM — звичайна справа).
function findBuilding(lng, lat) {
  const candidates = index.get(cellKey(lng, lat));
  if (candidates) {
    for (const i of candidates) {
      if (pointInPolygon(lng, lat, buildings[i].geometry.coordinates[0])) {
        return { building: buildings[i], nearest: false };
      }
    }
  }
  let best = null;
  let bestDist = NEAREST_THRESHOLD_M;
  const seen = new Set();
  for (const cell of neighborCells(lng, lat)) {
    for (const i of index.get(cell) ?? []) {
      if (seen.has(i)) continue;
      seen.add(i);
      const d = distanceToPolygonMeters(lng, lat, buildings[i].geometry.coordinates[0]);
      if (d < bestDist) {
        bestDist = d;
        best = buildings[i];
      }
    }
  }
  return best ? { building: best, nearest: true } : null;
}

// Вулиці, для яких знайдено реальні будівлі напряму через OSM (і раніше
// "порожні" вулиці без жодного номера, і вулиці з номерами — для других це
// заміна фантомних розгорнутих діапазонів на справжні будинки). Для таких
// пар (вулиця,черга) номерний геокодинг нижче повністю ігнорується.
function loadStreetLevel(path) {
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, 'utf-8')).filter((s) => s.buildingCount > 0);
}
let streetLevel = [
  ...loadStreetLevel('data/street_buildings.json'),
  ...loadStreetLevel('data/missing_street_buildings.json'),
  ...loadStreetLevel('data/missing_street_buildings2.json'),
  ...loadStreetLevel('data/missing_street_buildings3.json'),
];

// Вулиця, поділена номерами між кількома чергами (напр. Київська: 1.2 і 5.2),
// не може бути коректно заповнена "усі будівлі біля лінії вулиці → кожна
// черга" — буфер навколо лінії не знає, які будинки належать якій частині
// діапазону, тож один і той самий будинок дублювався б під обидві черги
// (конфлікт кольору), а точний номерний геокодинг (що й так уже є) ігнорувався
// б дарма. Для таких вулиць street-level пропускаємо повністю — довіряємо
// номерному геокодингу нижче, разом з його фолбек-кубиками там, де OSM
// будівлі поруч немає.
const queuesByStreet = new Map();
for (const s of streetLevel) {
  if (!queuesByStreet.has(s.street)) queuesByStreet.set(s.street, new Set());
  queuesByStreet.get(s.street).add(`${s.cherga}.${s.pid_cherga}`);
}
const splitStreets = new Set([...queuesByStreet].filter(([, qs]) => qs.size > 1).map(([street]) => street));
if (splitStreets.size > 0) {
  console.log(`Вулиць, поділених номерами між кількома чергами (street-level пропущено, довіряємо геокодингу): ${splitStreets.size}`);
  streetLevel = streetLevel.filter((s) => !splitStreets.has(s.street));
}

const streetLevelCovered = new Set(streetLevel.map((s) => `${s.street}|${s.cherga}.${s.pid_cherga}`));
console.log(`Вулиць(+черг) покрито напряму через OSM: ${streetLevelCovered.size}`);

console.log('Завантажую геокодинг-кеш та список будинків...');
const cache = JSON.parse(readFileSync('geocode-cache.json', 'utf-8'));
const expanded = loadExpanded();

const outFeatures = [];
let strictMatches = 0;
let nearestMatches = 0;
let fallbackPoints = 0;
let noCoords = 0;
let skippedCoveredByStreet = 0;

for (const rec of expanded) {
  const queue = `${rec.cherga}.${rec.pid_cherga}`;
  if (streetLevelCovered.has(`${rec.street}|${queue}`)) {
    skippedCoveredByStreet++;
    continue;
  }
  const key = `${rec.street}|${rec.house_number}`;
  const geo = cache[key];
  if (!geo || !geo.ok) {
    noCoords++;
    continue;
  }
  // Google інколи плутає однакову назву вулиці з іншим селом/містом області —
  // відкидаємо явні "перельоти" далеко за межі Кременчука замість того, щоб
  // малювати будинок за 90 км від міста.
  if (metersBetween(geo.lng, geo.lat, 33.4204, 49.0659) > 15000) {
    noCoords++;
    continue;
  }
  const address = `${rec.street}, ${rec.house_number}`;
  const found = findBuilding(geo.lng, geo.lat);

  if (found) {
    if (found.nearest) nearestMatches++;
    else strictMatches++;
    found.building.__used = true;
    outFeatures.push({
      type: 'Feature',
      geometry: found.building.geometry,
      properties: { address, queue, match: 'point_in_polygon', height: REAL_HEIGHT_M },
    });
  } else {
    fallbackPoints++;
    outFeatures.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [squareAround(geo.lng, geo.lat, FALLBACK_HALF_M)] },
      properties: { address, queue, match: 'fallback_point', height: FALLBACK_HEIGHT_M },
    });
  }
}

// Центроїдний індекс тих самих будівель — street_area кільця прийшли з
// ОКРЕМОГО запиту Overpass (around лінії вулиці), тож це не ті самі об'єкти
// JS, хоч і та сама будівля в OSM. Звіряємо геометрично (центроїд співпадає
// на кілька сантиметрів — обидва запити читають ту саму базу).
const centroidIndex = new Map();
buildings.forEach((b, i) => {
  const [cx, cy] = ringCentroid(b.geometry.coordinates[0]);
  const key = cellKey(cx, cy);
  if (!centroidIndex.has(key)) centroidIndex.set(key, []);
  centroidIndex.get(key).push(i);
});
function ringCentroid(ring) {
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < ring.length - 1; i++) { sx += ring[i][0]; sy += ring[i][1]; n++; }
  return [sx / n, sy / n];
}
function markUsedNear(lng, lat) {
  for (const i of centroidIndex.get(cellKey(lng, lat)) ?? []) {
    const [bx, by] = ringCentroid(buildings[i].geometry.coordinates[0]);
    if (metersBetween(lng, lat, bx, by) < 3) buildings[i].__used = true;
  }
}

let streetLevelFeatures = 0;
for (const s of streetLevel) {
  const queue = `${s.cherga}.${s.pid_cherga}`;
  for (const ring of s.rings) {
    const [cx, cy] = ringCentroid(ring);
    markUsedNear(cx, cy);
    outFeatures.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: { address: s.street, queue, match: 'street_area', height: REAL_HEIGHT_M },
    });
    streetLevelFeatures++;
  }
}

// Будь-яка реальна будівля міста, якої немає в жодній черзі графіку (просто
// не згадана в джерельному PDF) — показуємо сірою "невідомо", а не лишаємо
// порожньою дірою на карті.
let unmatchedFeatures = 0;
for (const b of buildings) {
  if (b.__used) continue;
  const addr =
    b.properties.addr_street && b.properties.addr_housenumber
      ? `${b.properties.addr_street}, ${b.properties.addr_housenumber}`
      : '';
  outFeatures.push({
    type: 'Feature',
    geometry: b.geometry,
    properties: { address: addr, queue: null, match: 'unmatched', height: REAL_HEIGHT_M },
  });
  unmatchedFeatures++;
}

writeFileSync(
  'public/houses.geojson',
  JSON.stringify({ type: 'FeatureCollection', features: outFeatures }),
);

console.log(`\nІтого записів: ${outFeatures.length}`);
console.log(`  з номерним геокодингом — точне влучення в контур: ${strictMatches}`);
console.log(`  з номерним геокодингом — найближча будівля (<${NEAREST_THRESHOLD_M}м): ${nearestMatches}`);
console.log(`  з номерним геокодингом — фолбек-точка: ${fallbackPoints}`);
console.log(`  пропущено (немає координат): ${noCoords}`);
console.log(`  пропущено (вулицю покрито напряму через OSM): ${skippedCoveredByStreet}`);
console.log(`  будівель напряму з вулиці (без конкретного номера): ${streetLevelFeatures}`);
console.log(`  реальних будівель міста поза графіком (сірі "невідомо"): ${unmatchedFeatures}`);
console.log('Записано в public/houses.geojson');
