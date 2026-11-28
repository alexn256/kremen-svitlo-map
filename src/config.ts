import type { QueueState } from './types';

export const STATUS_URL: string = import.meta.env.VITE_STATUS_URL || '/status.mock.json';
export const POLL_INTERVAL_MS: number = Number(import.meta.env.VITE_POLL_INTERVAL_MS) || 45_000;

/** Стилі карти, між якими перемикає кнопка в правому верхньому куті. */
export const MAP_STYLES: { label: string; url: string }[] = [
  { label: 'Кольорова', url: 'https://tiles.openfreemap.org/styles/liberty' },
  { label: 'Світла', url: 'https://tiles.openfreemap.org/styles/positron' },
  { label: 'Темна', url: 'https://tiles.openfreemap.org/styles/dark' },
];

/**
 * Базовий стиль карти. Поки немає ключа MapTiler/Stadia — OpenFreeMap (без ключа).
 * VITE_MAP_STYLE_URL підміняє початковий вибір (напр. для деплою без змінної —
 * перший зі списку), перемикач кнопкою далі ходить по MAP_STYLES.
 */
export const MAP_STYLE_URL: string = import.meta.env.VITE_MAP_STYLE_URL || MAP_STYLES[0].url;

export const KREMEN_CENTER: [number, number] = [33.4204, 49.0659]; // [lng, lat]
export const DEFAULT_ZOOM = 14;

/** Вигляд: «ігровий» (нахил) та «звичайний» (згори). */
export const GAME_VIEW = { pitch: 55, bearing: -20 };
export const FLAT_VIEW = { pitch: 0, bearing: 0 };

/** Умовна фіксована висота будинків, м (реальної висоти в OSM майже немає). */
export const BUILDING_HEIGHT_M = 12;

/** Ті самі кольори, що й на картинках бота. */
export const COLORS: Record<QueueState | 'unknown', string> = {
  on: '#7BC67E',
  off: '#D9534F',
  switching: '#F5C242',
  unknown: '#9E9E9E',
};

export const STATE_LABELS: Record<QueueState | 'unknown', string> = {
  on: 'Є світло',
  off: 'Немає світла',
  switching: 'Перемикання',
  unknown: 'Невідомо',
};

export const APP_TITLE = 'Svitlo Kremenchuk';
export const AUTHOR_HANDLE = '@M_AHTS';
export const AUTHOR_URL = 'https://t.me/M_AHTS';

/** Той самий список підчерг, що й у боті: 6 черг по 2 підчерги. */
export const QUEUES: string[] = Array.from({ length: 6 }, (_, i) => i + 1).flatMap((q) => [`${q}.1`, `${q}.2`]);
