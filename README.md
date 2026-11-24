# Світло Кременчук — карта відключень

Статичний сайт: нахилена 3D-карта Кременчука (MapLibre GL), будинки зі списку —
об'ємні полігони в кольорі стану своєї підчерги (live-статус з `status.json` бота). ТЗ — `KREMEN_POWER_MAP_SPEC.md`.

## Локально

```bash
npm install
cp .env.example .env   # за потреби
npm run dev            # http://localhost:5173
npm run build          # збірка в dist/
```

Поки немає справжніх даних, використовуються моки:
- `public/houses.geojson` — 400 фейкових будинків: прямокутники + фолбек-точки (`node scripts/gen-mock-houses.mjs`)
- базова карта — OpenFreeMap (без ключа), змінюється через `VITE_MAP_STYLE_URL`
- `public/status.mock.json` — статус у форматі контракту бота

## Деплой

Cloudflare Pages, підключений до GitHub: build command `npm run build`,
output `dist`, змінні `VITE_STATUS_URL` (URL статусу бота) і `VITE_MAP_STYLE_URL` (стиль MapTiler/Stadia).
