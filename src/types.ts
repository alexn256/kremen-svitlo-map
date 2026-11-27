export type QueueState = 'on' | 'off' | 'switching';

export interface OutageRange {
  start: string; // "HH:MM"
  end: string; // "HH:MM", "00:00" означає північ (кінець доби), не її початок
}

/**
 * Контракт status.json, який публікує бот.
 * `schedule` — весь денний графік по чергах (той самий формат, що й у
 * власному state.json бота) — потрібен для таймлайн-повзунка: він дозволяє
 * порахувати стан черги на будь-яку хвилину доби, а не лише "зараз".
 * Необов'язкове поле — без нього повзунок просто не працює, решта карти
 * лишається live-режимом як і раніше.
 */
export interface StatusPayload {
  updated_at: string;
  queues: Record<string, QueueState>;
  schedule?: Record<string, OutageRange[]>;
}

/** Як адресу зіставлено з будинком (див. пайплайн у ТЗ).
 * 'street_area' — точного номера будинку в джерелі не було (вулиця згадана
 * цілком); всі реальні будівлі вздовж неї з OSM віднесено до тієї ж черги.
 * 'unmatched' — реальна будівля з OSM, якої немає в жодній черзі графіку
 * (адреса просто не згадана в джерельному PDF) — показуємо її сірою,
 * замість того щоб лишати на карті порожню діру. */
export type MatchKind = 'osm_addr_tag' | 'point_in_polygon' | 'fallback_point' | 'street_area' | 'unmatched';

export interface HouseProps {
  address: string;
  /** null — будівля без відомої черги (match: 'unmatched'). */
  queue: string | null;
  match: MatchKind;
  /** Висота виштовхування, м — нижча для синтетичних "кубиків" (fallback_point). */
  height?: number;
}
