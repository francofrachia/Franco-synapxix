import { findPath, isoDistance, Point, Tile, tileCenter } from './iso';
import { PASILLO_ORIGIN } from './pasillo-map';

export const AUTOMATA_WALK_SPEED = 80;
export const AUTOMATA_BOB_PERIOD_MS = 130;

export type AutomataPoseFrame =
  | 'automata_0'
  | 'automata_1'
  | 'automata_2'
  | 'automata_3'
  | 'automata_4'
  | 'automata_5'
  | 'automata_6'
  | 'automata_7'
  | 'automata_8';

export interface AutomataMoveRequestResult {
  readonly accepted: boolean;
  readonly destination: Tile;
  readonly path: ReadonlyArray<Tile>;
}

export interface AutomataSnapshot {
  readonly tile: Tile;
  readonly nextTile: Tile | null;
  readonly destinationTile: Tile | null;
  readonly position: Point;
  readonly renderPosition: Point;
  readonly depth: number;
  readonly bobOffset: number;
  readonly frame: AutomataPoseFrame;
  readonly isMoving: boolean;
}

export interface AutomataCallbacks {
  onTileLeft?(tile: Tile): void;
  onTileEntered?(tile: Tile): void;
  onArrived?(tile: Tile): void;
}

/**
 * Resolves the directional frame from the Multus 9-pose strip based on
 * the isometric movement vector (dx, dy).
 */
export function resolveAutomatonPose(dx: number, dy: number): AutomataPoseFrame {
  const right = dx >= 0;
  const away = dy < 0;
  if (away) {
    return right ? 'automata_4' : 'automata_3';
  }
  return right ? 'automata_0' : 'automata_1';
}

/**
 * Pure, engine-independent movement controller for the Automaton (Rol A).
 * Reuses `iso.ts` pathfinding (`findPath`) and isometric geometry (`tileCenter`, `isoDistance`).
 */
export class AutomataController {
  private currentTile: Tile;
  private nextTile: Tile | null = null;
  private destinationTile: Tile | null = null;
  private path: Tile[] = [];
  private groundPosition: Point;
  private bobElapsedMs = 0;
  private currentFrame: AutomataPoseFrame = 'automata_0';
  private readonly origin: Point;
  private readonly speedPxPerSec: number;
  private readonly callbacks: AutomataCallbacks;

  constructor(
    startTile: Tile,
    options?: {
      origin?: Point;
      speedPxPerSec?: number;
      initialFrame?: AutomataPoseFrame;
      callbacks?: AutomataCallbacks;
    }
  ) {
    this.currentTile = { ...startTile };
    this.origin = options?.origin ?? PASILLO_ORIGIN;
    this.speedPxPerSec = options?.speedPxPerSec ?? AUTOMATA_WALK_SPEED;
    this.currentFrame = options?.initialFrame ?? 'automata_0';
    this.callbacks = options?.callbacks ?? {};
    this.groundPosition = tileCenter(this.currentTile, this.origin);
  }

  /**
   * Tile from which a new path is calculated: never cuts a step mid-tile.
   */
  get pathStart(): Tile {
    return this.nextTile ?? this.currentTile;
  }

  get snapshot(): AutomataSnapshot {
    const bob = this.computeBobOffset();
    return {
      tile: { ...this.currentTile },
      nextTile: this.nextTile ? { ...this.nextTile } : null,
      destinationTile: this.destinationTile ? { ...this.destinationTile } : null,
      position: { ...this.groundPosition },
      renderPosition: {
        x: this.groundPosition.x,
        y: this.groundPosition.y + bob,
      },
      depth: this.groundPosition.y,
      bobOffset: bob,
      frame: this.currentFrame,
      isMoving: this.nextTile !== null || this.path.length > 0,
    };
  }

  setPose(frame: AutomataPoseFrame): void {
    this.currentFrame = frame;
  }

  /**
   * Calculates and assigns an A* path to `goal` using `findPath` from `iso.ts`.
   * Returns `accepted: false` if the tile is blocked or unreachable.
   */
  requestMoveTo(
    goal: Tile,
    isWalkable: (gx: number, gy: number) => boolean
  ): AutomataMoveRequestResult {
    if (!isWalkable(goal.gx, goal.gy)) {
      return { accepted: false, destination: goal, path: [] };
    }

    const start = this.pathStart;
    if (start.gx === goal.gx && start.gy === goal.gy) {
      this.path = [];
      this.destinationTile = { ...goal };
      if (!this.nextTile) {
        this.finishArrival();
      }
      return { accepted: true, destination: goal, path: [] };
    }

    const computedPath = findPath(start, goal, isWalkable);
    if (computedPath.length === 0) {
      return { accepted: false, destination: goal, path: [] };
    }

    this.path = computedPath;
    this.destinationTile = { ...goal };
    return {
      accepted: true,
      destination: goal,
      path: [...computedPath],
    };
  }

  /**
   * Advances the automaton along its active path by `deltaMs` milliseconds.
   */
  update(deltaMs: number): AutomataSnapshot {
    if (deltaMs <= 0) {
      return this.snapshot;
    }

    if (!this.nextTile) {
      const upcoming = this.path.shift();
      if (!upcoming) {
        return this.snapshot;
      }
      this.nextTile = upcoming;
      this.callbacks.onTileLeft?.({ ...this.currentTile });
    }

    const target = tileCenter(this.nextTile, this.origin);
    const dx = target.x - this.groundPosition.x;
    const dy = target.y - this.groundPosition.y;
    const remaining = isoDistance(this.groundPosition, target);
    const step = (this.speedPxPerSec * deltaMs) / 1000;
    this.bobElapsedMs += deltaMs;

    if (dx !== 0 || dy !== 0) {
      this.currentFrame = resolveAutomatonPose(dx, dy);
    }

    if (remaining <= step) {
      this.currentTile = this.nextTile;
      this.nextTile = null;
      this.groundPosition = { ...target };
      this.callbacks.onTileEntered?.({ ...this.currentTile });

      if (this.path.length === 0) {
        this.finishArrival();
      }
      return this.snapshot;
    }

    const ratio = step / remaining;
    this.groundPosition = {
      x: this.groundPosition.x + dx * ratio,
      y: this.groundPosition.y + dy * ratio,
    };

    return this.snapshot;
  }

  private computeBobOffset(): number {
    const moving = this.nextTile !== null || this.path.length > 0;
    if (!moving) {
      return 0;
    }
    return Math.floor(this.bobElapsedMs / AUTOMATA_BOB_PERIOD_MS) % 2 === 1 ? -1 : 0;
  }

  private finishArrival(): void {
    this.bobElapsedMs = 0;
    this.destinationTile = null;
    this.callbacks.onArrived?.({ ...this.currentTile });
  }
}
