import * as maplibregl from 'maplibre-gl';
import type { ExpressionSpecification, MapGeoJSONFeature, MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre v6 вантажить воркер окремим файлом — віддаємо Vite, щоб він потрапив у збірку.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import './style.css';

import {
  BUILDING_HEIGHT_M,
  COLORS,
  DEFAULT_ZOOM,
  FLAT_VIEW,
  GAME_VIEW,
  KREMEN_CENTER,
  MAP_STYLE_URL,
  STATE_LABELS,
} from './config';
import { startStatusPolling, type StatusSnapshot } from './status';
import type { HouseProps, QueueState } from './types';

const SOURCE = 'houses';
const LAYER_BUILDINGS = 'houses-3d';
const LAYER_POINTS = 'houses-fallback';

maplibregl.setWorkerUrl(workerUrl);

let current: StatusSnapshot = { payload: null, lastSuccess: null, stale: false };
let gameView = true;

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

function stateOf(queue: string): QueueState | 'unknown' {
  return current.payload?.queues[queue] ?? 'unknown';
}

/**
 * Колір будинку = match(queue → колір поточного стану).
 * Перераховується лише цей вираз (12 гілок), сам шар не перебудовується.
 */
function colorExpression(): ExpressionSpecification {
  const queues = current.payload?.queues ?? {};
  const branches = Object.entries(queues).flatMap(([q, s]) => [q, COLORS[s] ?? COLORS.unknown]);
  if (branches.length === 0) return ['literal', COLORS.unknown] as unknown as ExpressionSpecification;
  return ['match', ['get', 'queue'], ...branches, COLORS.unknown] as unknown as ExpressionSpecification;
}

function repaint(): void {
  if (!map.getLayer(LAYER_BUILDINGS)) return;
  const expr = colorExpression();
  map.setPaintProperty(LAYER_BUILDINGS, 'fill-extrusion-color', expr);
  map.setPaintProperty(LAYER_POINTS, 'circle-color', expr);
}

map.on('load', () => {
  map.addSource(SOURCE, { type: 'geojson', data: '/houses.geojson' });

  // Наша «маска»: об'ємні кольорові будинки зі списку поверх нейтрального фону.
  map.addLayer({
    id: LAYER_BUILDINGS,
    type: 'fill-extrusion',
    source: SOURCE,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: {
      'fill-extrusion-color': COLORS.unknown,
      'fill-extrusion-height': BUILDING_HEIGHT_M,
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.92,
    },
  });

  // Фолбек: будинки без контуру в OSM — кружечки.
  map.addLayer({
    id: LAYER_POINTS,
    type: 'circle',
    source: SOURCE,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-color': COLORS.unknown,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3, 17, 9],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
      'circle-pitch-alignment': 'map',
    },
  });

  for (const layer of [LAYER_BUILDINGS, LAYER_POINTS]) {
    map.on('click', layer, (e: MapLayerMouseEvent) => showPopup(e.features?.[0], e.lngLat));
    map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
  }

  repaint();
  startStatusPolling((s) => {
    current = s;
    repaint();
    refreshPopup();
    renderStatusBar();
  });
});

// ---------- попап ----------

let popup: maplibregl.Popup | null = null;
let popupHouse: HouseProps | null = null;

function popupHtml(h: HouseProps): string {
  const s = stateOf(h.queue);
  const updated = current.payload?.updated_at ?? '—';
  const note =
    h.match === 'fallback_point' ? '<div class="popup-note">Контур будинку не знайдено — показано точкою</div>' : '';
  return `
    <div class="popup">
      <div class="popup-address">${escapeHtml(h.address)}</div>
      <div>Підчерга: <b>${escapeHtml(h.queue)}</b></div>
      <div><span class="dot" style="background:${COLORS[s]}"></span>${STATE_LABELS[s]}</div>
      <div class="popup-time">Оновлено: ${escapeHtml(updated)}</div>
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
map.addControl(new ViewToggle(), 'top-right');

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
