export type QueueState = 'on' | 'off' | 'switching';

/** Контракт status.json, який публікує бот. */
export interface StatusPayload {
  updated_at: string;
  queues: Record<string, QueueState>;
}

export type Precision = 'ROOFTOP' | 'RANGE_INTERPOLATED' | 'GEOMETRIC_CENTER' | 'APPROXIMATE';

export interface HouseProps {
  address: string;
  queue: string;
  precision?: Precision;
}
