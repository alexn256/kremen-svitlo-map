// Генерує фейкові будинки для розробки, поки немає справжніх даних.
// ~85% — прямокутні "контури" (Polygon), ~15% — фолбек-точки (Point).
// Запуск: node scripts/gen-mock-houses.mjs
import { writeFileSync } from 'node:fs';

const queues = ['1.1','1.2','2.1','2.2','3.1','3.2','4.1','4.2','5.1','5.2','6.1','6.2'];
const streets = ['вул. Соборна','вул. Шевченка','вул. Пушкіна','просп. Свободи','вул. Небесної Сотні',
  'вул. Халаменюка','вул. Першотравнева','вул. Київська','вул. Лесі Українки','вул. Ціолковського'];

let seed = 42;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = (a) => a[Math.floor(rnd() * a.length)];

// Лівобережний центр Кременчука, без Дніпра.
const BOX = { lng: [33.395, 33.445], lat: [49.062, 49.085] };
const M_LAT = 1 / 111_320, M_LNG = 1 / (111_320 * Math.cos((49.07 * Math.PI) / 180));

function rect(lng, lat, w, h, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const pts = [[-w, -h], [w, -h], [w, h], [-w, h], [-w, -h]].map(([x, y]) => [
    +(lng + (x * c - y * s) * M_LNG).toFixed(7),
    +(lat + (x * s + y * c) * M_LAT).toFixed(7),
  ]);
  return { type: 'Polygon', coordinates: [pts] };
}

const features = [];
for (let i = 0; i < 400; i++) {
  const lng = BOX.lng[0] + rnd() * (BOX.lng[1] - BOX.lng[0]);
  const lat = BOX.lat[0] + rnd() * (BOX.lat[1] - BOX.lat[0]);
  const fallback = rnd() < 0.15;
  features.push({
    type: 'Feature',
    geometry: fallback
      ? { type: 'Point', coordinates: [+lng.toFixed(7), +lat.toFixed(7)] }
      : rect(lng, lat, 8 + rnd() * 20, 6 + rnd() * 8, rnd() * Math.PI),
    properties: {
      address: `${pick(streets)}, ${1 + Math.floor(rnd() * 150)}`,
      queue: pick(queues),
      match: fallback ? 'fallback_point' : rnd() < 0.3 ? 'osm_addr_tag' : 'point_in_polygon',
    },
  });
}
writeFileSync('public/houses.geojson', JSON.stringify({ type: 'FeatureCollection', features }));

const states = ['on', 'off', 'switching'];

// Денний розклад — для таймлайн-повзунка: дві умовні «відключені» ділянки
// на чергу, рознесені по добі (не справжній графік, лише демо-форма).
const DAY = 24 * 60;
const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const schedule = Object.fromEntries(
  queues.map((q, i) => {
    const dur = 150 + Math.floor(rnd() * 90); // 2.5–4 год
    const start1 = (i * 110) % (DAY - dur);
    const start2 = (start1 + DAY / 2) % (DAY - dur);
    const ranges = [start1, start2]
      .sort((a, b) => a - b)
      .map((s) => ({ start: hhmm(s), end: hhmm(s + dur) }));
    return [q, ranges];
  }),
);

writeFileSync('public/status.mock.json', JSON.stringify({
  updated_at: '24.11.2026 12:00',
  queues: Object.fromEntries(queues.map((q, i) => [q, states[i % 3]])),
  schedule,
}, null, 2) + '\n');
console.log(`houses: ${features.length}`);
