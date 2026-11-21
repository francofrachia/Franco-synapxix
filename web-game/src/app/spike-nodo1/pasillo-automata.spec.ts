import {
  AutomataController,
  AUTOMATA_BOB_PERIOD_MS,
  resolveAutomatonPose,
} from './pasillo-automata';
import { log, NODO1_PASILLO_VERSION, pasilloLogger } from './pasillo-logger';
import {
  isPasilloGoalTrigger,
  isPasilloTileWalkable,
  parsePasilloMap,
  PASILLO_BASE_H,
  PASILLO_BASE_W,
  pasilloIntegerFit,
} from './pasillo-map';

describe('Nodo 1 — Demo del pasillo (Paso 1: Greybox & Movimiento del Autómata)', () => {
  const map = parsePasilloMap();
  const walkable = (gx: number, gy: number) => isPasilloTileWalkable(gx, gy, map);

  describe('Greybox 14x7 map (Sección 9)', () => {
    it('parses the 14x7 corridor grid with exact coordinates for S, G, M, c and T', () => {
      expect(map.cols).toBe(14);
      expect(map.rows).toBe(7);
      expect(map.automatonStart).toEqual({ gx: 1, gy: 4 });
      expect(map.guideStart).toEqual({ gx: 2, gy: 4 });
      expect(map.monolithTile).toEqual({ gx: 12, gy: 2 });
      expect(map.scrapTiles).toEqual([
        { gx: 4, gy: 4 },
        { gx: 8, gy: 4 },
        { gx: 12, gy: 4 },
      ]);
      expect(map.triggerTiles).toEqual([
        { gx: 11, gy: 0 },
        { gx: 12, gy: 0 },
      ]);
    });

    it('enforces collisions on walls (#), scrap (c), monolith (M) and bounds', () => {
      // Walkable cells
      expect(walkable(1, 4)).toBe(true); // S
      expect(walkable(2, 4)).toBe(true); // G
      expect(walkable(5, 3)).toBe(true); // .
      expect(walkable(11, 0)).toBe(true); // T

      // Blocked cells
      expect(walkable(0, 4)).toBe(false); // # wall
      expect(walkable(4, 4)).toBe(false); // c scrap
      expect(walkable(8, 4)).toBe(false); // c scrap
      expect(walkable(12, 2)).toBe(false); // M monolith
      expect(walkable(-1, 3)).toBe(false); // out of bounds
      expect(walkable(14, 3)).toBe(false); // out of bounds
    });

    it('computes 480x270 integer scaling x4 = 1920x1080 (Sección 8)', () => {
      expect(PASILLO_BASE_W).toBe(480);
      expect(PASILLO_BASE_H).toBe(270);
      const fit = pasilloIntegerFit(1920, 1080, 1);
      expect(fit.scale).toBe(4);
      expect(fit.cssWidth).toBe(1920);
      expect(fit.cssHeight).toBe(1080);
      expect(fit.cssLeft).toBe(0);
      expect(fit.cssTop).toBe(0);
    });
  });

  describe('AutomataController (Rol A — Movimiento y Poses)', () => {
    it('spawns at S (1,4) in idle pose with zero bob offset', () => {
      const controller = new AutomataController(map.automatonStart);
      const snap = controller.snapshot;

      expect(snap.tile).toEqual({ gx: 1, gy: 4 });
      expect(snap.isMoving).toBe(false);
      expect(snap.bobOffset).toBe(0);
      expect(snap.frame).toBe('automata_0');
      expect(snap.depth).toBe(snap.position.y);
    });

    it('rejects movement towards walls (#), scrap (c) or monolith (M)', () => {
      const controller = new AutomataController(map.automatonStart);

      expect(controller.requestMoveTo({ gx: 0, gy: 4 }, walkable).accepted).toBe(false);
      expect(controller.requestMoveTo({ gx: 4, gy: 4 }, walkable).accepted).toBe(false);
      expect(controller.requestMoveTo({ gx: 12, gy: 2 }, walkable).accepted).toBe(false);
      expect(controller.snapshot.isMoving).toBe(false);
    });

    it('finds a valid path around scrap obstacles and reaches the goal trigger T (11,0)', () => {
      const visited: Array<{ gx: number; gy: number }> = [];
      let arrivedAt: { gx: number; gy: number } | null = null;

      const controller = new AutomataController(map.automatonStart, {
        callbacks: {
          onTileEntered: (tile) => visited.push(tile),
          onArrived: (tile) => {
            arrivedAt = tile;
          },
        },
      });

      const goal = { gx: 11, gy: 0 };
      const request = controller.requestMoveTo(goal, walkable);
      expect(request.accepted).toBe(true);
      expect(request.path.length).toBeGreaterThan(0);

      // Ensure no tile in the path is a blocked cell
      for (const step of request.path) {
        expect(walkable(step.gx, step.gy)).toBe(true);
      }

      // Advance time in 50ms steps until arrival
      for (let i = 0; i < 400 && controller.snapshot.isMoving; i++) {
        controller.update(50);
      }

      expect(controller.snapshot.isMoving).toBe(false);
      expect(controller.snapshot.tile).toEqual(goal);
      expect(arrivedAt).toEqual(goal);
      expect(visited.length).toBe(request.path.length);
      expect(isPasilloGoalTrigger(controller.snapshot.tile, map)).toBe(true);
      expect(controller.snapshot.bobOffset).toBe(0);
    });

    it('applies subtle 1px vertical step bounce while moving and updates directional poses', () => {
      const controller = new AutomataController(map.automatonStart);
      controller.requestMoveTo({ gx: 3, gy: 4 }, walkable);

      const afterStep = controller.update(AUTOMATA_BOB_PERIOD_MS + 10);
      expect(afterStep.isMoving).toBe(true);
      expect(afterStep.bobOffset).toBe(-1);
      expect(afterStep.renderPosition.y).toBe(afterStep.position.y - 1);

      expect(resolveAutomatonPose(10, 5)).toBe('automata_0');
      expect(resolveAutomatonPose(-10, 5)).toBe('automata_1');
      expect(resolveAutomatonPose(10, -5)).toBe('automata_4');
      expect(resolveAutomatonPose(-10, -5)).toBe('automata_3');
    });
  });

  describe('Centralized Telemetry log(nombre, datos) (Sección 11 y 17.6)', () => {
    it('records session_started and tap_missed with engine timestamps', () => {
      pasilloLogger.reset(1000);
      const startEntry = log(
        'session_started',
        {
          nodeVersion: NODO1_PASILLO_VERSION,
          engineVersion: 'Phaser 4.2.1',
          qualityLevel: 'high',
          fps: 60,
        },
        1000
      );

      expect(startEntry.event).toBe('session_started');
      expect(startEntry.moment).toBe('M0');
      expect(startEntry.engineTimeMs).toBe(0);

      pasilloLogger.setMoment('M1');
      const missEntry = log('tap_missed', { gx: 0, gy: 4, reason: 'blocked_tile' }, 2450);

      expect(missEntry.event).toBe('tap_missed');
      expect(missEntry.moment).toBe('M1');
      expect(missEntry.engineTimeMs).toBe(1450);
      expect(pasilloLogger.getEntries().length).toBe(2);
    });
  });
});
