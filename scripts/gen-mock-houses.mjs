// Генерує фейкові точки для розробки, поки немає справжнього списку адрес.
// Запуск: node scripts/gen-mock-houses.mjs
import { writeFileSync } from 'node:fs';

const queues = ['1.1','1.2','2.1','2.2','3.1','3.2','4.1','4.2','5.1','5.2','6.1','6.2'];
const streets = ['вул. Соборна','вул. Шевченка','вул. Пушкіна','просп. Свободи','вул. Небесної Сотні',
  'вул. Халаменюка','вул. Першотравнева','вул. Київська','вул. Лесі Українки','вул. Ціолковського'];
const precisions = ['ROOFTOP','ROOFTOP','ROOFTOP','RANGE_INTERPOLATED','APPROXIMATE'];

let seed = 42;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

const features = [];
for (let i = 0; i < 400; i++) {
  const street = streets[Math.floor(rnd() * streets.length)];
  const house = String(1 + Math.floor(rnd() * 150));
  features.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [
      +(33.36 + rnd() * 0.12).toFixed(6),
      +(49.04 + rnd() * 0.05).toFixed(6),
    ] },
    properties: {
      address: `${street}, ${house}`,
      queue: queues[Math.floor(rnd() * queues.length)],
      precision: precisions[Math.floor(rnd() * precisions.length)],
    },
  });
}
writeFileSync('public/houses.geojson', JSON.stringify({ type: 'FeatureCollection', features }));

const states = ['on','off','switching'];
writeFileSync('public/status.mock.json', JSON.stringify({
  updated_at: '24.11.2026 12:00',
  queues: Object.fromEntries(queues.map((q, i) => [q, states[i % 3 === 2 ? 2 : i % 2]])),
}, null, 2) + '\n');
console.log(`houses: ${features.length}`);
