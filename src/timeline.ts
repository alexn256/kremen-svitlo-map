import type { OutageRange, QueueState } from './types';

/**
 * Той самий «м'який» кордон 30 хв, що й у текстових повідомленнях бота:
 * вимикають протягом 30 хв після початку інтервалу, вмикають в останні
 * 30 хв — щоб таймлайн-повзунок читався так само, як і решта бота.
 */
const SWITCH_WINDOW_MINUTES = 30;

function startMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Кінець інтервалу як хвилини: "00:00" означає північ (1440), а не початок доби. */
function endMinutes(t: string): number {
  const minutes = startMinutes(t);
  return minutes === 0 ? 24 * 60 : minutes;
}

/** Стан черги у конкретну хвилину доби за її повним денним розкладом. */
export function stateAtMinutes(ranges: OutageRange[], minutes: number): QueueState {
  for (const r of ranges) {
    const start = startMinutes(r.start);
    const end = endMinutes(r.end);
    if (minutes < start || minutes >= end) continue;
    if (minutes < start + SWITCH_WINDOW_MINUTES || minutes >= end - SWITCH_WINDOW_MINUTES) return 'switching';
    return 'off';
  }
  return 'on';
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
