# Світло Кременчук — карта відключень

Статичний сайт: карта Кременчука, кожен будинок підфарбований у колір стану своєї
підчерги (live-статус бере з `status.json` бота). ТЗ — `KREMEN_POWER_MAP_SPEC.md`.

## Локально

```bash
npm install
cp .env.example .env   # за потреби
npm run dev            # http://localhost:5173
npm run build          # збірка в dist/
```

Поки немає справжніх даних, використовуються моки:
- `public/houses.geojson` — 400 фейкових точок (`node scripts/gen-mock-houses.mjs`)
- `public/status.mock.json` — статус у форматі контракту бота

## Деплой

Cloudflare Pages, підключений до GitHub: build command `npm run build`,
output `dist`, змінна `VITE_STATUS_URL` — URL статусу бота.
