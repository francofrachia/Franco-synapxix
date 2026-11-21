/**
 * Centralized event logger for the Node 1 hallway demo (M0 -> M1).
 * Complies with Section 11 and Section 17 Rule 6:
 * Every event in the demo must flow through `log(name, data)`.
 */

export const NODO1_PASILLO_VERSION = 'nodo1-pasillo@0.2.0';

export type PasilloMoment = 'M0' | 'M1' | 'META';

export type PasilloQualityLevel = 'high' | 'medium' | 'low';

export type PasilloEventName =
  | 'session_started'
  | 'session_paused'
  | 'piece_equipped'
  | 'plaque_available'
  | 'guide_line_shown'
  | 'instructions_opened'
  | 'instructions_closed'
  | 'instructions_skipped'
  | 'tap_missed';

export interface PasilloLogEntry {
  readonly event: PasilloEventName;
  readonly moment: PasilloMoment;
  readonly engineTimeMs: number;
  readonly data: Readonly<Record<string, unknown>>;
}

export type PasilloLogListener = (entry: PasilloLogEntry) => void;

class PasilloLoggerState {
  private startedAtMs = 0;
  private currentMoment: PasilloMoment = 'M0';
  private readonly entries: PasilloLogEntry[] = [];
  private readonly listeners = new Set<PasilloLogListener>();

  reset(nowMs = performance.now()): void {
    this.startedAtMs = nowMs;
    this.currentMoment = 'M0';
    this.entries.length = 0;
  }

  setMoment(moment: PasilloMoment): void {
    this.currentMoment = moment;
  }

  getMoment(): PasilloMoment {
    return this.currentMoment;
  }

  record(
    event: PasilloEventName,
    data: Record<string, unknown> = {},
    nowMs = performance.now()
  ): PasilloLogEntry {
    if (this.startedAtMs === 0) {
      this.startedAtMs = nowMs;
    }
    const entry: PasilloLogEntry = {
      event,
      moment: this.currentMoment,
      engineTimeMs: Math.max(0, Math.round(nowMs - this.startedAtMs)),
      data: { ...data },
    };
    this.entries.push(entry);
    for (const listener of this.listeners) {
      listener(entry);
    }
    return entry;
  }

  getEntries(): ReadonlyArray<PasilloLogEntry> {
    return [...this.entries];
  }

  subscribe(listener: PasilloLogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const pasilloLogger = new PasilloLoggerState();

/**
 * Single telemetry entry point mandated by Section 17 Rule 6.
 */
export function log(
  event: PasilloEventName,
  data: Record<string, unknown> = {},
  nowMs?: number
): PasilloLogEntry {
  return pasilloLogger.record(event, data, nowMs);
}
