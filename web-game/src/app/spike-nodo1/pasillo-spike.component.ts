import { CommonModule } from '@angular/common';
import {
  afterEveryRender,
  afterNextRender,
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
  Injector,
  NgZone,
  OnDestroy,
  signal,
  ViewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { IntegerFit } from './integer-fit';
import { Point, Tile } from './iso';
import { PLAQUE_TEXT } from './nodo1-node';
import { AutomataPoseFrame, AutomataSnapshot } from './pasillo-automata';
import {
  log,
  PasilloLogEntry,
  pasilloLogger,
  PasilloMoment,
} from './pasillo-logger';
import { pasilloIntegerFit } from './pasillo-map';
import type { PasilloWorldHandle } from './pasillo-world';
import type { FrameStats, WorldInfo } from './world';

const POSE_FRAMES: ReadonlyArray<AutomataPoseFrame> = [
  'automata_0',
  'automata_1',
  'automata_2',
  'automata_3',
  'automata_4',
  'automata_5',
  'automata_6',
  'automata_7',
  'automata_8',
];

@Component({
  selector: 'app-pasillo-spike',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="stage"
      [style.left.px]="fit().cssLeft"
      [style.top.px]="fit().cssTop"
      [style.width.px]="fit().cssWidth"
      [style.height.px]="fit().cssHeight"
      [style.--u.px]="fit().unit"
    >
      <div #canvasHost class="canvas-host"></div>

      <div class="hud">
        <a class="round back" routerLink="/" aria-label="Volver">←</a>

        <div class="objective">{{ objectiveText() }}</div>

        <div class="speech" role="status">
          <b>Guía:</b> {{ guideLine() }}
        </div>

        @if (!worldInfo()) {
          <div class="loading">Cargando {{ progress() }}%</div>
        }

        @if (missedHint()) {
          <div class="missed-banner" role="status">
            Probemos tocando una baldosa libre del pasillo
          </div>
        }

        @if (plaqueOpen()) {
          <section class="panel plaque-panel" aria-label="Placa del monolito">
            <p class="plaque-text">«{{ plaqueText }}»</p>
            <div class="actions">
              <button type="button" class="action-btn" (click)="closePlaque()">
                Cerrar placa
              </button>
            </div>
          </section>
        }

        @if (goalReached()) {
          <section class="panel goal-panel" aria-label="Meta temporal">
            <p class="plaque-text">«Aquí se separan tres caminos»</p>
            <div class="actions">
              <button type="button" class="action-btn" (click)="restartDemo()">
                Reiniciar recorrido
              </button>
            </div>
          </section>
        }
      </div>
    </div>

    @if (portrait()) {
      <div class="rotate">Gira el dispositivo en horizontal</div>
    }

    @if (debug) {
      <aside class="debug-panel">
        <div class="debug-controls">
          <button type="button" (click)="restartDemo()">Reiniciar S(1,4)</button>
          <button type="button" (click)="walkToPlaque()">Ir a M1(11,2)</button>
          <button type="button" (click)="walkToGoal()">Ir a Meta T(11,0)</button>
          <button type="button" (click)="cyclePose()">Pose: {{ currentPose() }}</button>
        </div>
        <pre class="debug">{{ debugText() }}</pre>
      </aside>
    }
  `,
  styles: [
    `
      :host {
        --pasillo-bg: #263647;
        --pasillo-surface: #f5f7fa;
        --pasillo-yellow: #ffda39;
        --pasillo-pink: #fb7b88;
        --pasillo-debug-text: #9ef59e;
        position: fixed;
        inset: 0;
        z-index: 50;
        background: var(--pasillo-bg);
        overflow: hidden;
        touch-action: none;
      }
      .stage {
        position: absolute;
      }
      .canvas-host,
      .canvas-host ::ng-deep canvas {
        position: absolute;
        inset: 0;
        width: 100% !important;
        height: 100% !important;
        margin: 0 !important;
        image-rendering: pixelated;
        touch-action: none;
      }
      .hud {
        position: absolute;
        inset: 0;
        pointer-events: none;
        font-family: 'Fredoka', 'Nunito Sans', 'Nunito', system-ui, sans-serif;
        color: var(--pasillo-bg);
      }
      .hud a,
      .hud button {
        pointer-events: auto;
      }
      .round {
        position: absolute;
        width: calc(var(--u) * 24);
        height: calc(var(--u) * 24);
        display: grid;
        place-items: center;
        border-radius: 50%;
        border: calc(var(--u) * 1.5) solid var(--pasillo-bg);
        background: var(--pasillo-yellow);
        color: var(--pasillo-bg);
        font-weight: 800;
        font-size: calc(var(--u) * 11);
        padding: 0;
        line-height: 1;
        text-decoration: none;
        cursor: pointer;
      }
      .back {
        left: calc(var(--u) * 8);
        top: calc(var(--u) * 8);
      }
      .objective {
        position: absolute;
        left: 50%;
        top: calc(var(--u) * 8);
        transform: translateX(-50%);
        padding: calc(var(--u) * 3) calc(var(--u) * 12);
        border-radius: calc(var(--u) * 10);
        background: var(--pasillo-surface);
        border: calc(var(--u) * 1.5) solid var(--pasillo-bg);
        font-weight: 700;
        font-size: calc(var(--u) * 10);
        white-space: nowrap;
      }
      /* Section 7 Rule 4: Guide text >= 46px at 1920x1080 (12u * 4 = 48px) */
      .speech {
        position: absolute;
        left: 50%;
        top: calc(var(--u) * 32);
        transform: translateX(-50%);
        max-width: calc(var(--u) * 380);
        padding: calc(var(--u) * 4) calc(var(--u) * 10);
        border-radius: calc(var(--u) * 8);
        background: var(--pasillo-bg);
        color: var(--pasillo-surface);
        border: calc(var(--u) * 1) solid var(--pasillo-surface);
        font: 600 calc(var(--u) * 12) 'Nunito Sans', 'Nunito', system-ui, sans-serif;
        text-align: center;
        white-space: nowrap;
      }
      .loading {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        color: var(--pasillo-surface);
        font-weight: 700;
        font-size: calc(var(--u) * 12);
      }
      /* Section 7 Rule 7: Soft pink feedback without punishment */
      .missed-banner {
        position: absolute;
        left: 50%;
        bottom: calc(var(--u) * 10);
        transform: translateX(-50%);
        padding: calc(var(--u) * 4) calc(var(--u) * 10);
        border-radius: calc(var(--u) * 8);
        background: var(--pasillo-pink);
        color: var(--pasillo-bg);
        border: calc(var(--u) * 1.5) solid var(--pasillo-bg);
        font: 700 calc(var(--u) * 10) 'Nunito Sans', 'Nunito', system-ui, sans-serif;
        white-space: nowrap;
      }
      .panel {
        position: absolute;
        left: 50%;
        bottom: calc(var(--u) * 12);
        transform: translateX(-50%);
        box-sizing: border-box;
        width: calc(var(--u) * 340);
        padding: calc(var(--u) * 10);
        border-radius: calc(var(--u) * 8);
        background: var(--pasillo-surface);
        border: calc(var(--u) * 1.5) solid var(--pasillo-bg);
        pointer-events: auto;
      }
      .plaque-text {
        margin: 0 0 calc(var(--u) * 8);
        font: 700 calc(var(--u) * 12) 'Nunito Sans', 'Nunito', system-ui, sans-serif;
        text-align: center;
      }
      .actions {
        display: flex;
        gap: calc(var(--u) * 5);
      }
      /* Section 7 Rule 4 & 5: Buttons >= 140px height (35u * 4 = 140px) & text >= 40px (10u * 4 = 40px) */
      .action-btn {
        flex: 1 1 auto;
        min-height: calc(var(--u) * 35);
        padding: 0 calc(var(--u) * 10);
        border-radius: calc(var(--u) * 10);
        border: calc(var(--u) * 1.5) solid var(--pasillo-bg);
        background: var(--pasillo-yellow);
        color: var(--pasillo-bg);
        font: 800 calc(var(--u) * 10) 'Fredoka', 'Nunito', system-ui, sans-serif;
        cursor: pointer;
      }
      .rotate {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        background: var(--pasillo-bg);
        color: var(--pasillo-surface);
        font: 700 24px 'Nunito Sans', 'Nunito', system-ui, sans-serif;
      }
      .debug-panel {
        position: absolute;
        right: 6px;
        bottom: 6px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-width: 54ch;
        z-index: 60;
      }
      .debug-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .debug-controls button {
        padding: 4px 8px;
        border-radius: 4px;
        border: 1px solid var(--pasillo-bg);
        background: var(--pasillo-yellow);
        color: var(--pasillo-bg);
        font: 700 11px monospace;
        cursor: pointer;
      }
      .debug {
        margin: 0;
        padding: 6px 8px;
        background: rgba(0, 0, 0, 0.82);
        color: var(--pasillo-debug-text);
        font: 11px/1.35 monospace;
        white-space: pre-wrap;
        pointer-events: none;
        border-radius: 4px;
      }
    `,
  ],
})
export class PasilloSpikeComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvasHost', { static: true })
  private canvasHost!: ElementRef<HTMLElement>;

  private readonly zone = inject(NgZone);
  private readonly injector = inject(Injector);
  private readonly params = new URLSearchParams(window.location.search);

  private world?: PasilloWorldHandle;
  private destroyed = false;
  private statsTimer?: ReturnType<typeof setInterval>;
  private missedTimer?: ReturnType<typeof setTimeout>;
  private unsubscribeLog?: () => void;
  private renders = 0;
  private rendersAtLastTick = 0;
  private poseIndex = 0;
  private latestSnapshot?: AutomataSnapshot;
  private latestCamera: Point = { x: 0, y: 0 };
  private plaqueRead = false;

  readonly debug = this.params.has('debug');
  readonly plaqueText = PLAQUE_TEXT;
  readonly fit = signal<IntegerFit>(this.measure());
  readonly portrait = signal(window.innerHeight > window.innerWidth);
  readonly progress = signal(0);
  readonly worldInfo = signal<WorldInfo | null>(null);
  readonly moment = signal<PasilloMoment>('M0');
  readonly plaqueOpen = signal(false);
  readonly goalReached = signal(false);
  readonly missedHint = signal(false);
  readonly currentPose = signal<AutomataPoseFrame>('automata_0');
  readonly recentLogs = signal<ReadonlyArray<PasilloLogEntry>>([]);
  readonly debugText = signal('');

  readonly objectiveText = signal('M0 · Recorre el pasillo');
  readonly guideLine = signal('Despertaste en el pasadizo. Toca una baldosa para caminar.');

  constructor() {
    afterEveryRender(() => this.renders++);
    this.unsubscribeLog = pasilloLogger.subscribe(() => {
      this.recentLogs.set(pasilloLogger.getEntries().slice(-5));
    });
  }

  async ngAfterViewInit(): Promise<void> {
    const startedAt = performance.now();
    const { createPasilloWorld } = await import('./pasillo-world');
    if (this.destroyed) return;

    this.zone.runOutsideAngular(() => {
      this.world = createPasilloWorld(this.canvasHost.nativeElement, {
        onProgress: (value) =>
          this.zone.run(() => this.progress.set(Math.round(value * 100))),
        onReady: (info) => {
          const total = Math.round(performance.now() - startedAt);
          this.zone.run(() => {
            this.worldInfo.set({ ...info, loadMs: total });
            this.recentLogs.set(pasilloLogger.getEntries().slice(-5));
          });
        },
        onAutomataUpdated: (snapshot, cameraScroll) => {
          this.latestSnapshot = snapshot;
          this.latestCamera = cameraScroll;
          this.currentPose.set(snapshot.frame);
        },
        onMomentChanged: (nextMoment) =>
          this.zone.run(() => {
            this.moment.set(nextMoment);
            if (nextMoment === 'M1') {
              this.objectiveText.set('M1 · Placa-guía y salida');
              this.guideLine.set('Hay una placa sobre el monolito.');
            } else if (nextMoment === 'META') {
              this.objectiveText.set('Meta temporal alcanzada');
              this.guideLine.set('Aquí se separan tres caminos.');
            } else {
              this.objectiveText.set('M0 · Recorre el pasillo');
              this.guideLine.set('Despertaste en el pasadizo. Toca una baldosa para caminar.');
            }
          }),
        onPlaqueTapped: () =>
          this.zone.run(() => {
            this.plaqueRead = true;
            this.plaqueOpen.set(true);
            log('instructions_opened', { source: 'monolith_plaque' });
          }),
        onGoalReached: (tile: Tile) =>
          this.zone.run(() => {
            if (!this.plaqueRead) {
              log('instructions_skipped', { triggerTile: `${tile.gx},${tile.gy}` });
            }
            this.goalReached.set(true);
          }),
        onTapMissed: () =>
          this.zone.run(() => {
            this.missedHint.set(true);
            clearTimeout(this.missedTimer);
            this.missedTimer = setTimeout(() => this.missedHint.set(false), 1600);
          }),
      });
      this.world.refreshScale();
      if (this.debug) {
        this.statsTimer = setInterval(() => this.publishStats(), 500);
      }
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    clearInterval(this.statsTimer);
    clearTimeout(this.missedTimer);
    this.unsubscribeLog?.();
    this.world?.destroy();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.fit.set(this.measure());
    this.portrait.set(window.innerHeight > window.innerWidth);
    afterNextRender(() => this.world?.refreshScale(), { injector: this.injector });
  }

  closePlaque(): void {
    this.plaqueOpen.set(false);
    log('instructions_closed', { source: 'monolith_plaque' });
  }

  restartDemo(): void {
    this.plaqueRead = false;
    this.plaqueOpen.set(false);
    this.goalReached.set(false);
    this.world?.resetToStart();
  }

  walkToPlaque(): void {
    this.world?.moveToTile({ gx: 11, gy: 2 });
  }

  walkToGoal(): void {
    this.world?.moveToTile({ gx: 11, gy: 0 });
  }

  cyclePose(): void {
    this.poseIndex = (this.poseIndex + 1) % POSE_FRAMES.length;
    const frame = POSE_FRAMES[this.poseIndex] ?? 'automata_0';
    this.world?.setPose(frame);
  }

  private measure(): IntegerFit {
    return pasilloIntegerFit(
      window.innerWidth,
      window.innerHeight,
      window.devicePixelRatio || 1
    );
  }

  private publishStats(): void {
    if (!this.world) return;
    const stats: FrameStats = this.world.frameStats();
    const info = this.worldInfo();
    const fit = this.fit();
    const snap = this.latestSnapshot;
    const logs = pasilloLogger
      .getEntries()
      .slice(-4)
      .map((e) => `  [${e.engineTimeMs}ms] ${e.event} (${e.moment})`)
      .join('\n');

    const lines = [
      `Demo del Pasillo (480x270 x${fit.scale} = ${Math.round(fit.cssWidth)}x${Math.round(fit.cssHeight)})`,
      `renderer ${info?.renderer ?? '...'} | fps ${stats.fps} | p95 ${stats.p95}ms`,
      `autómata casilla (${snap?.tile.gx ?? '-'}, ${snap?.tile.gy ?? '-'}) | pose ${snap?.frame ?? '-'} | moviendo: ${snap?.isMoving ? 'sí' : 'no'}`,
      `mundo (${Math.round(snap?.position.x ?? 0)}, ${Math.round(snap?.position.y ?? 0)}) | depth ${Math.round(snap?.depth ?? 0)} | cámara (${this.latestCamera.x}, ${this.latestCamera.y})`,
      `eventos log(nombre, datos) [${pasilloLogger.getEntries().length} total]:`,
      logs || '  (sin eventos)',
    ];
    this.rendersAtLastTick = this.renders;
    this.zone.run(() => this.debugText.set(lines.join('\n')));
  }
}
