export type QueueState = 'on' | 'off' | 'switching';

/** Контракт status.json, який публікує бот. */
export interface StatusPayload {
  updated_at: string;
  queues: Record<string, QueueState>;
}

/** Як адресу зіставлено з будинком (див. пайплайн у ТЗ). */
export type MatchKind = 'osm_addr_tag' | 'point_in_polygon' | 'fallback_point';

export interface HouseProps {
  address: string;
  queue: string;
  match: MatchKind;
}
