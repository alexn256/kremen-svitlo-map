import type { QueueState } from './types';

export const STATUS_URL: string = import.meta.env.VITE_STATUS_URL || '/status.mock.json';
export const POLL_INTERVAL_MS: number = Number(import.meta.env.VITE_POLL_INTERVAL_MS) || 45_000;

export const KREMEN_CENTER: [number, number] = [49.0659, 33.4204];
export const DEFAULT_ZOOM = 13;

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
