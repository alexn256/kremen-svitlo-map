import * as maplibregl from 'maplibre-gl';
import type { ExpressionSpecification, MapGeoJSONFeature, MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre v6 вантажить воркер окремим файлом — віддаємо Vite, щоб він потрапив у збірку.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import './style.css';

import {
  APP_TITLE,
  AUTHOR_HANDLE,
  AUTHOR_URL,
  BUILDING_HEIGHT_M,
  COLORS,
  DEFAULT_ZOOM,
  FLAT_VIEW,
  GAME_VIEW,
  KREMEN_CENTER,
  MAP_STYLE_URL,
  MAP_STYLES,
  QUEUES,
  STATE_LABELS,
} from './config';
import { startStatusPolling, type StatusSnapshot } from './status';
import { formatMinutes, nowMinutes, stateAtMinutes } from './timeline';
import type { HouseProps, QueueState } from './types';

const SOURCE = 'houses';
const LAYER_BUILDINGS = 'houses-3d';

// fill-extrusion-opacity в MapLibre не підтримує data-вирази (на відміну від
// кольору) — тому пригашення неактивної черги робимо кольором, не прозорістю.
const DIMMED_COLOR = '#4a4f55';

maplibregl.setWorkerUrl(workerUrl);

let current: StatusSnapshot = { payload: null, lastSuccess: null, stale: false };
let gameView = true;
/**
 * Кожна черга — незалежний перемикач «підсвічена / пригашена». За
 * замовчуванням підсвічені всі. Клік по ALL — масовий перемикач: якщо зараз
 * підсвічені всі — гасить усі, інакше підсвічує всі.
 */
const highlightedQueues = new Set<string>(QUEUES);
/** Хвилина доби, обрана таймлайн-повзунком, або null — живий статус (poll). */
let timelineMinutes: number | null = null;
let statusController: ReturnType<typeof startStatusPolling> | null = null;

const map = new maplibregl.Map({
  container: 'map',
  style: MAP_STYLE_URL,
  center: KREMEN_CENTER,
  zoom: DEFAULT_ZOOM,
  ...GAME_VIEW,
  maxPitch: 70,
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

/**
 * Стан черги зараз — або, якщо водять таймлайн-повзунком, стан на обрану
 * хвилину доби за її денним розкладом (`schedule` у status.json).
 */
function stateOf(queue: string | null | undefined): QueueState | 'unknown' {
  if (queue == null) return 'unknown';
  if (timelineMinutes !== null) {
    const ranges = current.payload?.schedule?.[queue];
    return ranges ? stateAtMinutes(ranges, timelineMinutes) : 'unknown';
  }
  return current.payload?.queues[queue] ?? 'unknown';
}

/**
 * Колір будинку = match(queue → колір стану, живого чи обраного на таймлайні;
 * пригашених черг — сірий). Перераховується лише цей вираз, сам шар не
 * перебудовується.
 */
function colorExpression(): ExpressionSpecification {
  const codes = timelineMinutes !== null ? Object.keys(current.payload?.schedule ?? {}) : QUEUES;
  const branches = codes.flatMap((q) => [
    q,
    highlightedQueues.has(q) ? (COLORS[stateOf(q)] ?? COLORS.unknown) : DIMMED_COLOR,
  ]);
  if (branches.length === 0) return ['literal', COLORS.unknown] as unknown as ExpressionSpecification;
  return ['match', ['get', 'queue'], ...branches, COLORS.unknown] as unknown as ExpressionSpecification;
}

function repaint(): void {
  if (!map.getLayer(LAYER_BUILDINGS)) return;
  map.setPaintProperty(LAYER_BUILDINGS, 'fill-extrusion-color', colorExpression());
}

/**
 * Додає наш шар будинків поверх базового стилю. Викликається і при першому
 * завантаженні, і після кожного ручного `map.setStyle(...)` (перемикач
 * стилю) — `setStyle` скидає всі кастомні джерела/шари, тож їх доводиться
 * піднімати заново. Обробники кліків/ховеру реєструються одноразово
 * (нижче, поза цією функцією) — вони прив'язані до id шару, а не до
 * конкретного інстансу стилю, і переживають `setStyle`.
 */
function setupHousesLayer(): void {
  // Деякі базові стилі (напр. "liberty") самі малюють об'ємні сірі будинки —
  // вони плутаються з нашими кольоровими поверх. Ховаємо чужий шар будівель,
  // якщо він є в конкретному стилі; якщо немає (positron/dark/bright) — нема що ховати.
  for (const id of ['building-3d', 'building-top', 'building']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
  }

  if (!map.getSource(SOURCE)) {
    map.addSource(SOURCE, { type: 'geojson', data: '/houses.geojson' });
  }

  // Наша «маска»: об'ємні кольорові будинки зі списку поверх нейтрального фону.
  // Висота береться з властивості кожного об'єкта (`height` у houses.geojson) —
  // у адрес без знайденого контуру будівлі вона навмисно нижча (синтетичний
  // "кубик" навколо геокодованої точки, а не справжній контур).
  if (!map.getLayer(LAYER_BUILDINGS)) {
    map.addLayer({
      id: LAYER_BUILDINGS,
      type: 'fill-extrusion',
      source: SOURCE,
      paint: {
        'fill-extrusion-color': COLORS.unknown,
        'fill-extrusion-height': ['coalesce', ['get', 'height'], BUILDING_HEIGHT_M],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.92,
      },
    });
  }

  repaint();
}

map.on('click', LAYER_BUILDINGS, (e: MapLayerMouseEvent) => showPopup(e.features?.[0], e.lngLat));
map.on('mouseenter', LAYER_BUILDINGS, () => (map.getCanvas().style.cursor = 'pointer'));
map.on('mouseleave', LAYER_BUILDINGS, () => (map.getCanvas().style.cursor = ''));

map.on('style.load', setupHousesLayer);

map.on('load', () => {
  statusController = startStatusPolling((s) => {
    current = s;
    repaint();
    refreshPopup();
    renderStatusBar();
    renderQueuePanel();
  });
});

// ---------- попап ----------

let popup: maplibregl.Popup | null = null;
let popupHouse: HouseProps | null = null;

function popupHtml(h: HouseProps): string {
  const s = stateOf(h.queue);
  const whenLine =
    timelineMinutes !== null
      ? `Час: ${formatMinutes(timelineMinutes)} (за розкладом)`
      : `Оновлено: ${escapeHtml(current.payload?.updated_at ?? '—')}`;
  const note =
    h.match === 'fallback_point'
      ? '<div class="popup-note">Контур будинку не знайдено — показано точкою</div>'
      : h.match === 'street_area'
        ? '<div class="popup-note">Точний номер будинку в джерелі не вказано — вся вулиця віднесена до цієї черги</div>'
        : h.match === 'unmatched'
          ? '<div class="popup-note">Цю адресу не згадано в графіку відключень — черга невідома</div>'
          : '';
  // MapLibre відкидає null-властивості з GeoJSON-фіч (векторний пайплайн не
  // підтримує null) — для unmatched-будинків h.queue приходить як undefined.
  const queueLine = h.queue != null ? `<div>Підчерга: <b>${escapeHtml(h.queue)}</b></div>` : '';
  return `
    <div class="popup">
      <div class="popup-address">${escapeHtml(h.address || 'Будинок')}</div>
      ${queueLine}
      <div><span class="dot" style="background:${COLORS[s]}"></span>${STATE_LABELS[s]}</div>
      <div class="popup-time">${whenLine}</div>
      ${note}
    </div>`;
}

function showPopup(f: MapGeoJSONFeature | undefined, at: maplibregl.LngLat): void {
  if (!f) return;
  popupHouse = f.properties as HouseProps;
  popup?.remove();
  popup = new maplibregl.Popup({ maxWidth: '260px' }).setLngLat(at).setHTML(popupHtml(popupHouse)).addTo(map);
  popup.on('close', () => (popupHouse = null));
}

function refreshPopup(): void {
  if (popup && popupHouse) popup.setHTML(popupHtml(popupHouse));
}

// ---------- перемикач виду ----------

class ViewToggle implements maplibregl.IControl {
  private btn = document.createElement('button');
  onAdd(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    this.btn.type = 'button';
    this.btn.className = 'view-toggle';
    this.update();
    this.btn.addEventListener('click', () => {
      gameView = !gameView;
      map.easeTo({ ...(gameView ? GAME_VIEW : FLAT_VIEW), duration: 800 });
      this.update();
    });
    wrap.appendChild(this.btn);
    return wrap;
  }
  onRemove(): void {}
  private update(): void {
    this.btn.textContent = gameView ? '2D' : '3D';
    this.btn.title = gameView ? 'Звичайний вигляд (згори)' : 'Ігровий вигляд (нахил)';
  }
}
// ---------- перемикач стилю карти ----------
// Клік ходить по колу MAP_STYLES. `map.setStyle(...)` скидає кастомні
// джерела/шари — їх піднімає заново обробник 'style.load' (див. вище).

let styleIndex = Math.max(
  0,
  MAP_STYLES.findIndex((s) => s.url === MAP_STYLE_URL),
);

class StyleToggle implements maplibregl.IControl {
  private btn = document.createElement('button');
  onAdd(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    this.btn.type = 'button';
    this.btn.className = 'style-toggle';
    this.btn.textContent = '🗺';
    this.update();
    this.btn.addEventListener('click', () => {
      styleIndex = (styleIndex + 1) % MAP_STYLES.length;
      map.setStyle(MAP_STYLES[styleIndex].url);
      this.update();
    });
    wrap.appendChild(this.btn);
    return wrap;
  }
  onRemove(): void {}
  private update(): void {
    const next = MAP_STYLES[(styleIndex + 1) % MAP_STYLES.length].label;
    this.btn.title = `Стиль карти: ${MAP_STYLES[styleIndex].label} (клік — ${next})`;
    this.btn.setAttribute('aria-label', this.btn.title);
  }
}

// ---------- контрол «оновити» ----------
// Той самий maplibregl-ctrl-group, що й у ViewToggle — MapLibre сам стекує
// контроли одного кута один під одним, тож нічого не налазить одне на одне.

class RefreshControl implements maplibregl.IControl {
  private btn = document.createElement('button');

  onAdd(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'maplibregl-ctrl maplibregl-ctrl-group queue-control';

    this.btn.type = 'button';
    this.btn.className = 'refresh-btn';
    this.btn.title = 'Оновити статус';
    this.btn.setAttribute('aria-label', 'Оновити статус');
    this.btn.textContent = '⟳';
    this.btn.addEventListener('click', () => {
      if (!statusController || this.btn.classList.contains('spinning')) return;
      this.btn.classList.add('spinning');
      void statusController.refresh().finally(() => this.btn.classList.remove('spinning'));
    });

    wrap.appendChild(this.btn);
    return wrap;
  }
  onRemove(): void {}
}
map.addControl(new ViewToggle(), 'top-right');
map.addControl(new StyleToggle(), 'top-right');
map.addControl(new RefreshControl(), 'top-right');

// ---------- сітка черг: легенда + вибір одним тапом ----------
// Кожна кнопка — незалежний перемикач «підсвічена/пригашена» для своєї
// черги. ALL — масовий перемикач: підсвічені зараз усі → гасить усі,
// інакше підсвічує усі.

const queueChips = new Map<string, HTMLButtonElement>();
let allChip!: HTMLButtonElement;
{
  const panel = document.getElementById('queue-panel')!;

  allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = 'queue-chip all-chip';
  allChip.textContent = 'ALL';
  allChip.title = 'Підсвітити/погасити всі черги разом';
  allChip.addEventListener('click', () => {
    if (highlightedQueues.size === QUEUES.length) {
      highlightedQueues.clear();
    } else {
      for (const q of QUEUES) highlightedQueues.add(q);
    }
    renderQueuePanel();
    repaint();
  });
  panel.appendChild(allChip);

  for (const code of QUEUES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'queue-chip';
    chip.textContent = code;
    chip.addEventListener('click', () => {
      if (highlightedQueues.has(code)) highlightedQueues.delete(code);
      else highlightedQueues.add(code);
      renderQueuePanel();
      repaint();
    });
    panel.appendChild(chip);
    queueChips.set(code, chip);
  }
}

function renderQueuePanel(): void {
  allChip.classList.toggle('selected', highlightedQueues.size === QUEUES.length);
  for (const [code, chip] of queueChips) {
    chip.style.background = COLORS[stateOf(code)];
    chip.classList.toggle('selected', highlightedQueues.has(code));
  }
}
renderQueuePanel();

// ---------- таймлайн: вертикальний повзунок по добі ----------
// Водіння повзунком показує стан кожної черги не "зараз", а на обрану
// хвилину доби, за повним денним розкладом з status.json (`schedule`).
// Кнопка Live повертає до звичайного живого режиму (опитування).

const timelineTimeEl = document.getElementById('timeline-time')!;
const timelineSlider = document.getElementById('timeline-slider') as HTMLInputElement;
const timelineLiveBtn = document.getElementById('timeline-live-btn') as HTMLButtonElement;
timelineSlider.value = String(nowMinutes());

function renderTimeline(): void {
  timelineLiveBtn.classList.toggle('active', timelineMinutes === null);
  timelineTimeEl.textContent = timelineMinutes === null ? 'Live' : formatMinutes(timelineMinutes);
}
renderTimeline();

timelineSlider.addEventListener('input', () => {
  timelineMinutes = Number(timelineSlider.value);
  renderTimeline();
  renderQueuePanel();
  refreshPopup();
  repaint();
});

timelineLiveBtn.addEventListener('click', () => {
  timelineMinutes = null;
  timelineSlider.value = String(nowMinutes());
  renderTimeline();
  renderQueuePanel();
  refreshPopup();
  repaint();
});

// ---------- назва застосунку та підвал ----------

document.getElementById('app-title')!.textContent = `⚡ ${APP_TITLE}`;

const footer = document.getElementById('app-footer')!;
footer.innerHTML =
  `© ${new Date().getFullYear()} ${escapeHtml(APP_TITLE)} · Усі права захищені · ` +
  `Створено <a href="${AUTHOR_URL}" target="_blank" rel="noopener">${escapeHtml(AUTHOR_HANDLE)}</a>`;

// ---------- плашка статусу ----------

const statusBar = document.getElementById('status-bar')!;
function renderStatusBar(): void {
  const stale = current.stale;
  statusBar.className = 'status-bar' + (stale ? ' stale' : '');
  if (!current.lastSuccess) {
    statusBar.textContent = stale ? 'Не вдалося отримати статус' : 'Завантаження…';
    return;
  }
  const t = current.payload?.updated_at ?? current.lastSuccess.toLocaleTimeString('uk-UA');
  statusBar.textContent = stale ? `⚠ Дані застаріли · останнє оновлення ${t}` : `Оновлено ${t}`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
