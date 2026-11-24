import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import './style.css';

import { COLORS, DEFAULT_ZOOM, KREMEN_CENTER, STATE_LABELS } from './config';
import { startStatusPolling, type StatusSnapshot } from './status';
import type { HouseProps, QueueState } from './types';

type HouseMarker = L.CircleMarker & { house: HouseProps };

const map = L.map('map', { preferCanvas: true }).setView(KREMEN_CENTER, DEFAULT_ZOOM);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

let current: StatusSnapshot = { payload: null, lastSuccess: null, stale: false };
const markers: HouseMarker[] = [];

function stateOf(queue: string): QueueState | 'unknown' {
  return current.payload?.queues[queue] ?? 'unknown';
}

/** Колір кластера — за більшістю станів усередині. */
const cluster = L.markerClusterGroup({
  chunkedLoading: true,
  showCoverageOnHover: false,
  maxClusterRadius: 50,
  iconCreateFunction(c) {
    const counts: Record<string, number> = {};
    for (const m of c.getAllChildMarkers() as unknown as HouseMarker[]) {
      const s = stateOf(m.house.queue);
      counts[s] = (counts[s] ?? 0) + 1;
    }
    const dominant = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ??
      'unknown') as keyof typeof COLORS;
    const n = c.getChildCount();
    const size = n < 50 ? 34 : n < 500 ? 42 : 50;
    return L.divIcon({
      html: `<div style="background:${COLORS[dominant]}">${n}</div>`,
      className: 'house-cluster',
      iconSize: [size, size],
    });
  },
});
map.addLayer(cluster);

function popupHtml(h: HouseProps): string {
  const s = stateOf(h.queue);
  const updated = current.payload?.updated_at ?? '—';
  const approx =
    h.precision && h.precision !== 'ROOFTOP'
      ? '<div class="popup-note">Розташування приблизне</div>'
      : '';
  return `
    <div class="popup">
      <div class="popup-address">${escapeHtml(h.address)}</div>
      <div>Підчерга: <b>${escapeHtml(h.queue)}</b></div>
      <div><span class="dot" style="background:${COLORS[s]}"></span>${STATE_LABELS[s]}</div>
      <div class="popup-time">Оновлено: ${escapeHtml(updated)}</div>
      ${approx}
    </div>`;
}

function styleMarker(m: HouseMarker): void {
  const approx = m.house.precision && m.house.precision !== 'ROOFTOP';
  m.setStyle({
    fillColor: COLORS[stateOf(m.house.queue)],
    color: approx ? '#555' : '#fff',
    dashArray: approx ? '2 2' : undefined,
  });
}

function repaint(): void {
  markers.forEach(styleMarker);
  cluster.refreshClusters();
  const open = markers.find((m) => m.isPopupOpen());
  open?.setPopupContent(popupHtml(open.house));
}

async function loadHouses(): Promise<void> {
  const res = await fetch('/houses.geojson');
  const geo = (await res.json()) as GeoJSON.FeatureCollection<GeoJSON.Point, HouseProps>;
  for (const f of geo.features) {
    const [lng, lat] = f.geometry.coordinates;
    const m = L.circleMarker([lat, lng], {
      radius: 7,
      weight: 1.5,
      fillOpacity: 0.9,
    }) as HouseMarker;
    m.house = f.properties;
    m.bindPopup(() => popupHtml(m.house));
    styleMarker(m);
    markers.push(m);
  }
  cluster.addLayers(markers);
}

const statusBar = document.getElementById('status-bar')!;
function renderStatusBar(): void {
  if (!current.lastSuccess) {
    statusBar.textContent = current.stale ? 'Не вдалося отримати статус' : 'Завантаження…';
    statusBar.className = 'status-bar' + (current.stale ? ' stale' : '');
    return;
  }
  const t = current.payload?.updated_at ?? current.lastSuccess.toLocaleTimeString('uk-UA');
  statusBar.textContent = current.stale ? `⚠ Дані застаріли · останнє оновлення ${t}` : `Оновлено ${t}`;
  statusBar.className = 'status-bar' + (current.stale ? ' stale' : '');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

loadHouses()
  .catch((err) => console.error('houses load failed:', err))
  .finally(() => {
    startStatusPolling((s) => {
      current = s;
      repaint();
      renderStatusBar();
    });
  });
