import Phaser from 'phaser';
import { Point, Tile, tileCenter, worldToTile } from './iso';
import {
  AutomataController,
  AutomataPoseFrame,
  AutomataSnapshot,
} from './pasillo-automata';
import {
  log,
  NODO1_PASILLO_VERSION,
  pasilloLogger,
  PasilloQualityLevel,
} from './pasillo-logger';
import {
  isPasilloGoalTrigger,
  isPasilloTileWalkable,
  parsePasilloMap,
  PASILLO_BASE_H,
  PASILLO_BASE_W,
  PasilloMapModel,
} from './pasillo-map';
import type { FrameStats, WorldInfo } from './world';

const ASSETS_PATH = '/games/nodo1/';
const BACKGROUND_HEX = '#263647';

// Official palette from Section 5 & Section 7
const COLOR_BG_DARK = 0x263647;
const COLOR_FLOOR_A = 0x3a5167;
const COLOR_FLOOR_B = 0x557691;
const COLOR_WALL_TOP = 0x2f4356;
const COLOR_WALL_BORDER = 0x798286;
const COLOR_CLEAR_OUTLINE = 0xe0dcd3;
const COLOR_INTERACTIVE_YELLOW = 0xffda39;
const COLOR_RUNE_CYAN = 0xa5e7ff;
const COLOR_MAGIC_PURPLE = 0x9a5dff;
const COLOR_SOFT_PINK = 0xfb7b88;

export interface PasilloWorldCallbacks {
  onProgress(progress: number): void;
  onReady(info: WorldInfo): void;
  onAutomataUpdated(snapshot: AutomataSnapshot, cameraScroll: Point): void;
  onMomentChanged(moment: 'M0' | 'M1' | 'META'): void;
  onPlaqueTapped(): void;
  onGoalReached(tile: Tile): void;
  onTapMissed(tile: Tile): void;
}

export interface PasilloWorldHandle {
  refreshScale(): void;
  moveToTile(tile: Tile): boolean;
  setPose(frame: AutomataPoseFrame): void;
  resetToStart(): void;
  frameStats(): FrameStats;
  destroy(): void;
}

class PasilloGreyboxScene extends Phaser.Scene {
  private readonly frameMs = new Float32Array(600);
  private frameCount = 0;
  private loadStartedAt = 0;
  private readonly mapModel: PasilloMapModel = parsePasilloMap();
  private controller!: AutomataController;

  private automatonSprite?: Phaser.GameObjects.Sprite;
  private automatonOutlineSprites: Phaser.GameObjects.Sprite[] = [];
  private automatonShadow?: Phaser.GameObjects.Graphics;
  private destinationMarker?: Phaser.GameObjects.Graphics;
  private missedMarker?: Phaser.GameObjects.Graphics;

  private plaqueAnnounced = false;
  private goalReached = false;

  constructor(private readonly callbacks: PasilloWorldCallbacks) {
    super('pasillo-greybox');
  }

  preload(): void {
    this.loadStartedAt = performance.now();
    this.load.on('progress', (value: number) => this.callbacks.onProgress(value));
    this.load.setPath(ASSETS_PATH);
    this.load.atlas('atlas', 'atlas.png', 'atlas.json');
  }

  create(): void {
    pasilloLogger.reset();
    this.plaqueAnnounced = false;
    this.goalReached = false;

    this.drawGreyboxGrid();
    this.buildPropsAndCharacters();
    this.setupCamera();

    this.input.on('pointerdown', this.handlePointerDown, this);

    const loadMs = Math.round(performance.now() - this.loadStartedAt);
    const info: WorldInfo = {
      renderer: this.game.renderer.type === Phaser.WEBGL ? 'WebGL' : 'Canvas',
      gpu: readGpuName(this.game),
      loadMs,
    };

    const qualityLevel: PasilloQualityLevel = 'high';
    log('session_started', {
      nodeVersion: NODO1_PASILLO_VERSION,
      engineVersion: `Phaser ${Phaser.VERSION}`,
      qualityLevel,
      fps: Math.round(this.game.loop.actualFps || 60),
      resolution: `${PASILLO_BASE_W}x${PASILLO_BASE_H}`,
    });
    log('guide_line_shown', { lineId: 'm0_greeting' });

    this.callbacks.onReady(info);
    this.publishAutomataState();
  }

  override update(): void {
    const raw = this.game.loop.rawDelta;
    this.frameMs[this.frameCount++ % this.frameMs.length] = raw;

    const delta = Math.min(raw, 100);
    const snap = this.controller.update(delta);
    this.syncAutomatonVisuals(snap);
    this.publishAutomataState();
  }

  moveToTile(goal: Tile): boolean {
    const result = this.controller.requestMoveTo(goal, (gx, gy) =>
      isPasilloTileWalkable(gx, gy, this.mapModel)
    );
    if (!result.accepted) {
      log('tap_missed', { gx: goal.gx, gy: goal.gy, reason: 'unwalkable_tile' });
      this.showMissedRipple(goal);
      this.callbacks.onTapMissed(goal);
      return false;
    }

    const center = tileCenter(goal, this.mapModel.origin);
    this.destinationMarker?.setPosition(center.x, center.y).setVisible(true);
    return true;
  }

  setPose(frame: AutomataPoseFrame): void {
    this.controller.setPose(frame);
    this.syncAutomatonVisuals(this.controller.snapshot);
    this.publishAutomataState();
  }

  resetToStart(): void {
    this.plaqueAnnounced = false;
    this.goalReached = false;
    pasilloLogger.setMoment('M0');
    this.callbacks.onMomentChanged('M0');
    this.destinationMarker?.setVisible(false);
    this.initController();
    this.syncAutomatonVisuals(this.controller.snapshot);
    this.publishAutomataState();
  }

  frameStats(): FrameStats {
    const samples = Math.min(this.frameCount, this.frameMs.length);
    if (samples === 0) {
      return { samples: 0, fps: 60, p50: 0, p95: 0, worst: 0, over33ms: 0 };
    }
    const sorted = Array.from(this.frameMs.subarray(0, samples)).sort((a, b) => a - b);
    const at = (ratio: number) => sorted[Math.floor((samples - 1) * ratio)] ?? 0;
    return {
      samples,
      fps: Math.round(this.game.loop.actualFps),
      p50: round1(at(0.5)),
      p95: round1(at(0.95)),
      worst: round1(sorted[samples - 1] ?? 0),
      over33ms: sorted.filter((ms) => ms > 33.4).length,
    };
  }

  private initController(): void {
    this.controller = new AutomataController(this.mapModel.automatonStart, {
      origin: this.mapModel.origin,
      callbacks: {
        onTileEntered: (tile) => this.handleTileEntered(tile),
        onArrived: (tile) => {
          this.destinationMarker?.setVisible(false);
          this.handleTileEntered(tile);
        },
      },
    });
  }

  private handleTileEntered(tile: Tile): void {
    // Transition from M0 corridor into M1 room (x >= 10)
    if (tile.gx >= 10 && !this.plaqueAnnounced) {
      this.plaqueAnnounced = true;
      pasilloLogger.setMoment('M1');
      log('plaque_available', { gx: this.mapModel.monolithTile.gx, gy: this.mapModel.monolithTile.gy });
      this.callbacks.onMomentChanged('M1');
    }

    // Trigger temporary goal T at the end of M1
    if (isPasilloGoalTrigger(tile, this.mapModel) && !this.goalReached) {
      this.goalReached = true;
      pasilloLogger.setMoment('META');
      log('guide_line_shown', { lineId: 'm1_goal_reached' });
      this.callbacks.onMomentChanged('META');
      this.callbacks.onGoalReached(tile);
    }
  }

  private drawGreyboxGrid(): void {
    const g = this.add.graphics().setDepth(0);
    const { origin, tileWidth: tw, tileHeight: th } = this.mapModel;

    for (const row of this.mapModel.cells) {
      for (const cell of row) {
        const center = tileCenter({ gx: cell.gx, gy: cell.gy }, origin);
        const diamond = [
          new Phaser.Math.Vector2(center.x, center.y - th / 2),
          new Phaser.Math.Vector2(center.x + tw / 2, center.y),
          new Phaser.Math.Vector2(center.x, center.y + th / 2),
          new Phaser.Math.Vector2(center.x - tw / 2, center.y),
        ];

        if (cell.kind === 'wall') {
          g.fillStyle(COLOR_WALL_TOP, 0.55);
          g.fillPoints(diamond, true);
          g.lineStyle(1, COLOR_WALL_BORDER, 0.35);
          g.strokePoints(diamond, true);
        } else {
          const isEven = (cell.gx + cell.gy) % 2 === 0;
          const fill =
            cell.kind === 'trigger'
              ? COLOR_MAGIC_PURPLE
              : cell.kind === 'start'
              ? COLOR_FLOOR_B
              : isEven
              ? COLOR_FLOOR_A
              : COLOR_FLOOR_B;
          const alpha = cell.kind === 'trigger' ? 0.45 : 0.92;

          g.fillStyle(fill, alpha);
          g.fillPoints(diamond, true);

          const strokeColor =
            cell.kind === 'trigger'
              ? COLOR_MAGIC_PURPLE
              : cell.kind === 'start'
              ? COLOR_RUNE_CYAN
              : COLOR_WALL_BORDER;
          g.lineStyle(1, strokeColor, cell.kind === 'trigger' || cell.kind === 'start' ? 0.9 : 0.45);
          g.strokePoints(diamond, true);
        }
      }
    }
  }

  private buildPropsAndCharacters(): void {
    const { origin, tileWidth: tw, tileHeight: th } = this.mapModel;

    // 1. Scrap obstacles ('c') with Y-depth sorting so automaton walks behind/in front
    this.mapModel.scrapTiles.forEach((tile, idx) => {
      const center = tileCenter(tile, origin);
      const frame = idx % 2 === 0 ? 'rocas_0' : 'rocas_1';
      const prop = this.add.sprite(center.x, center.y + th / 2 - 1, 'atlas', frame).setOrigin(0.5, 1);
      prop.setDepth(center.y);
    });

    // 2. Monolith with plaque ('M') at (12, 2) with interactive yellow #FFDA39 highlight
    const mCenter = tileCenter(this.mapModel.monolithTile, origin);
    const monolithOutline = this.add.graphics().setDepth(mCenter.y - 0.5);
    monolithOutline.lineStyle(1.5, COLOR_INTERACTIVE_YELLOW, 0.95);
    monolithOutline.strokeEllipse(mCenter.x, mCenter.y + 1, 24, 12);
    // Slow pulse (1.5s cycle) complying with Section 7 Rule 1
    this.tweens.add({
      targets: monolithOutline,
      alpha: 0.35,
      duration: 1500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    const monolith = this.add
      .sprite(mCenter.x, mCenter.y + th / 2, 'atlas', 'plataforma')
      .setOrigin(0.5, 1)
      .setDepth(mCenter.y);

    // Hitbox >= 2x2 cm independent of drawing size (Section 7 Rule 6)
    const plaqueHitbox = this.add
      .zone(mCenter.x, mCenter.y - 8, 44, 44)
      .setInteractive({ useHandCursor: true });
    plaqueHitbox.on('pointerdown', () => {
      this.callbacks.onPlaqueTapped();
    });
    void monolith;

    // 3. Guide ('G') at (2, 4)
    const gCenter = tileCenter(this.mapModel.guideStart, origin);
    this.add
      .sprite(gCenter.x, gCenter.y + th / 2 - 1, 'atlas', 'guia_frontal')
      .setOrigin(0.5, 1)
      .setDepth(gCenter.y);

    // 4. Destination tile marker in interactive yellow #FFDA39
    this.destinationMarker = this.add.graphics().setDepth(2).setVisible(false);
    this.destinationMarker.lineStyle(1.5, COLOR_INTERACTIVE_YELLOW, 1);
    this.destinationMarker.strokePoints(
      [
        new Phaser.Math.Vector2(0, -th / 2),
        new Phaser.Math.Vector2(tw / 2, 0),
        new Phaser.Math.Vector2(0, th / 2),
        new Phaser.Math.Vector2(-tw / 2, 0),
      ],
      true,
      true
    );

    // 5. Soft pink missed-tap indicator (#FB7B88 — Section 7 Rule 7: soft pink, no punishment)
    this.missedMarker = this.add.graphics().setDepth(2).setVisible(false);
    this.missedMarker.lineStyle(1, COLOR_SOFT_PINK, 0.9);
    this.missedMarker.strokeCircle(0, 0, 5);

    // 6. Automaton with fixed clear shadow and clear outline (Section 5 & Section 7 Rule 3)
    this.initController();
    const initial = this.controller.snapshot;

    this.automatonShadow = this.add.graphics();
    this.automatonShadow.fillStyle(COLOR_BG_DARK, 0.75);
    this.automatonShadow.fillEllipse(0, 0, 18, 8);
    this.automatonShadow.lineStyle(1, COLOR_CLEAR_OUTLINE, 0.85);
    this.automatonShadow.strokeEllipse(0, 0, 19, 9);

    // 4-directional 1px light outline sprites so automaton never blends into dark floor
    const offsets: ReadonlyArray<Point> = [
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 1 },
    ];
    this.automatonOutlineSprites = offsets.map(() => {
      const s = this.add.sprite(0, 0, 'atlas', initial.frame).setOrigin(0.5, 1);
      s.setTint(COLOR_CLEAR_OUTLINE);
      s.setAlpha(0.65);
      return s;
    });

    this.automatonSprite = this.add
      .sprite(initial.renderPosition.x, initial.renderPosition.y, 'atlas', initial.frame)
      .setOrigin(0.5, 1);

    this.syncAutomatonVisuals(initial);
  }

  private setupCamera(): void {
    const cam = this.cameras.main;
    cam.setBackgroundColor(BACKGROUND_HEX);
    if (this.automatonSprite) {
      // Smooth camera tracking along the corridor (Section 9 & 14)
      cam.startFollow(this.automatonSprite, true, 0.12, 0.12, 0, -10);
    }
  }

  private syncAutomatonVisuals(snap: AutomataSnapshot): void {
    if (!this.automatonSprite || !this.automatonShadow) return;

    this.automatonShadow.setPosition(snap.position.x, snap.position.y);
    this.automatonShadow.setDepth(snap.depth - 0.2);

    const offsets: ReadonlyArray<Point> = [
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 1 },
    ];
    this.automatonOutlineSprites.forEach((outline, index) => {
      const off = offsets[index] ?? { x: 0, y: 0 };
      if (outline.frame.name !== snap.frame) {
        outline.setFrame(snap.frame);
      }
      outline.setPosition(snap.renderPosition.x + off.x, snap.renderPosition.y + off.y);
      outline.setDepth(snap.depth - 0.1);
    });

    if (this.automatonSprite.frame.name !== snap.frame) {
      this.automatonSprite.setFrame(snap.frame);
    }
    this.automatonSprite.setPosition(snap.renderPosition.x, snap.renderPosition.y);
    this.automatonSprite.setDepth(snap.depth);
  }

  private handlePointerDown(
    pointer: Phaser.Input.Pointer,
    currentlyOver: Phaser.GameObjects.GameObject[]
  ): void {
    if (currentlyOver.length > 0) {
      return;
    }
    const tile = worldToTile(pointer.worldX, pointer.worldY, this.mapModel.origin);
    this.moveToTile(tile);
  }

  private showMissedRipple(tile: Tile): void {
    if (!this.missedMarker) return;
    const center = tileCenter(tile, this.mapModel.origin);
    this.missedMarker.setPosition(center.x, center.y).setAlpha(0.95).setVisible(true);
    this.tweens.add({
      targets: this.missedMarker,
      alpha: 0,
      duration: 450,
      onComplete: () => this.missedMarker?.setVisible(false),
    });
  }

  private publishAutomataState(): void {
    const cam = this.cameras.main;
    this.callbacks.onAutomataUpdated(this.controller.snapshot, {
      x: Math.round(cam.scrollX),
      y: Math.round(cam.scrollY),
    });
  }
}

function readGpuName(game: Phaser.Game): string {
  const gl = (game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl as
    | WebGLRenderingContext
    | undefined;
  if (!gl) return 'n/d';
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'n/d';
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function createPasilloWorld(
  host: HTMLElement,
  callbacks: PasilloWorldCallbacks
): PasilloWorldHandle {
  const scene = new PasilloGreyboxScene(callbacks);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: PASILLO_BASE_W,
    height: PASILLO_BASE_H,
    backgroundColor: BACKGROUND_HEX,
    banner: false,
    disableContextMenu: true,
    audio: { noAudio: true },
    render: { pixelArt: true, roundPixels: true, antialias: false },
    scale: { mode: Phaser.Scale.NONE },
    input: { activePointers: 1 },
    scene,
  });

  return {
    refreshScale: () => game.scale.refresh(),
    moveToTile: (tile) => scene.moveToTile(tile),
    setPose: (frame) => scene.setPose(frame),
    resetToStart: () => scene.resetToStart(),
    frameStats: () => scene.frameStats(),
    destroy: () => game.destroy(true),
  };
}
