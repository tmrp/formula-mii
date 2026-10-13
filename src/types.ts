export interface Timed {
  time: number;
  [key: string]: unknown;
}
export interface Driver {
  driver_number: number;
  full_name: string;
  name_acronym: string;
  first_name: string;
  last_name: string;
  team_name: string;
  team_colour: string;
  offset: number;
  count: number;
  start: number;
  end: number;
  active_until: number;
  retired: boolean;
  lap_events: (Timed & {
    lap_number: number;
    duration?: number;
    lap_duration?: number;
  })[];
  position_events: (Timed & { position: number })[];
  intervals: (Timed & {
    gap_to_leader: number | string | null;
    interval: number | string | null;
  })[];
  stints: {
    lap_start: number;
    lap_end: number;
    compound: string;
    tyre_age_at_start: number;
  }[];
  result?: Record<string, unknown>;
}
export interface Metadata {
  compressed_sample_file?: string;
  compressed_byte_length?: number;
  version: number;
  title: string;
  race_start: string;
  duration: number;
  total_laps: number;
  stride: number;
  session: {
    session_key: number;
    year: number;
    date_start: string;
    date_end: string;
    location: string;
  };
  source: unknown;
  track: {
    points: [number, number, number][];
    length_m: number;
    lap_number: number;
  };
  drivers: Driver[];
  events: (Timed & { message: string; flag?: string; category?: string })[];
  quality: Record<string, unknown>;
  bounds: unknown;
}
export type CameraMode =
  | "orbit"
  | "chase"
  | "onboard"
  | "portrait"
  | "trackside";
export function latest<T extends { time: number }>(
  events: T[],
  time: number,
): T | undefined {
  let lo = 0,
    hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid].time <= time) lo = mid + 1;
    else hi = mid;
  }
  return events[lo - 1];
}
export function clock(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  return `${Math.floor(t / 3600) > 0 ? `${Math.floor(t / 3600)}:` : ""}${String(Math.floor(t / 60) % 60).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
