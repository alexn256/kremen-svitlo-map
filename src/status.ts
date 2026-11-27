import { POLL_INTERVAL_MS, STATUS_URL } from './config';
import type { StatusPayload } from './types';

export interface StatusSnapshot {
  payload: StatusPayload | null;
  lastSuccess: Date | null;
  stale: boolean;
}

export interface StatusController {
  /** Негайний позачерговий запит (напр. по кнопці «Оновити»). */
  refresh: () => Promise<void>;
}

/**
 * Опитує status.json. При помилці зберігає останній відомий статус
 * і позначає його як застарілий — точки не зникають.
 */
export function startStatusPolling(onUpdate: (s: StatusSnapshot) => void): StatusController {
  const snapshot: StatusSnapshot = { payload: null, lastSuccess: null, stale: false };

  async function tick(): Promise<void> {
    try {
      const res = await fetch(STATUS_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as StatusPayload;
      if (!data || typeof data.queues !== 'object') throw new Error('bad payload');
      snapshot.payload = data;
      snapshot.lastSuccess = new Date();
      snapshot.stale = false;
    } catch (err) {
      console.warn('status fetch failed:', err);
      snapshot.stale = true;
    }
    onUpdate({ ...snapshot });
  }

  void tick();
  setInterval(tick, POLL_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void tick();
  });

  return { refresh: tick };
}
