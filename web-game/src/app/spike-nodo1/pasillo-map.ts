import { IntegerFit } from './integer-fit';
import { Point, Tile, TILE_H, TILE_W } from './iso';

/**
 * Logical resolution specified in Section 8:
 * 480x270 with integer zoom x4 = 1920x1080 (16:9) and #263647 letterbox.
 */
export const PASILLO_BASE_W = 480;
export const PASILLO_BASE_H = 270;

/**
 * Parametrizable isometric tile size (Section 9 & Section 17 Rule 2).
 * Default matches the 2:1 Multus tileset (32x16 px).
 */
export const DEFAULT_PASILLO_TILE_W = TILE_W;
export const DEFAULT_PASILLO_TILE_H = TILE_H;

/**
 * Isometric origin (top vertex of tile (0,0)) in world coordinates.
 */
export const PASILLO_ORIGIN: Point = { x: 200, y: 56 };

export type PasilloCellKind =
  | 'wall'      // '#'
  | 'floor'     // '.'
  | 'start'     // 'S'
  | 'guide'     // 'G'
  | 'scrap'     // 'c'
  | 'monolith'  // 'M'
  | 'trigger';  // 'T'

export interface PasilloCell {
  readonly gx: number;
  readonly gy: number;
  readonly symbol: string;
  readonly kind: PasilloCellKind;
  readonly walkable: boolean;
}

export interface PasilloMapModel {
  readonly cols: number;
  readonly rows: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly origin: Point;
  readonly cells: ReadonlyArray<ReadonlyArray<PasilloCell>>;
  readonly automatonStart: Tile;
  readonly guideStart: Tile;
  readonly monolithTile: Tile;
  readonly scrapTiles: ReadonlyArray<Tile>;
  readonly triggerTiles: ReadonlyArray<Tile>;
}

/**
 * Official 14x7 greybox matrix from Section 9 of the specification.
 *
 * x:  0 1 2 3 4 5 6 7 8 9 10 11 12 13
 * y0  # # # # # # # # # # #  T  T  #
 * y1  # # # # # # # # # # .  .  .  #
 * y2  # # # # # # # # # # .  .  M  #
 * y3  # . . . . . . . . . .  .  .  #
 * y4  # S G . c . . . c . .  .  c  #
 * y5  # . . . . . . . . . .  .  .  #
 * y6  # # # # # # # # # # #  #  #  #
 */
export const PASILLO_GREYBOX_ROWS: ReadonlyArray<string> = [
  '###########TT#',
  '##########...#',
  '##########..M#',
  '#............#',
  '#SG.c...c...c#',
  '#............#',
  '##############',
];

function classifySymbol(symbol: string): { kind: PasilloCellKind; walkable: boolean } {
  switch (symbol) {
    case '.':
      return { kind: 'floor', walkable: true };
    case 'S':
      return { kind: 'start', walkable: true };
    case 'G':
      return { kind: 'guide', walkable: true };
    case 'T':
      return { kind: 'trigger', walkable: true };
    case 'c':
      return { kind: 'scrap', walkable: false };
    case 'M':
      return { kind: 'monolith', walkable: false };
    case '#':
    default:
      return { kind: 'wall', walkable: false };
  }
}

export function parsePasilloMap(
  gridRows: ReadonlyArray<string> = PASILLO_GREYBOX_ROWS,
  options?: { tileWidth?: number; tileHeight?: number; origin?: Point }
): PasilloMapModel {
  const rows = gridRows.length;
  const cols = gridRows[0]?.length ?? 0;
  let automatonStart: Tile = { gx: 1, gy: 4 };
  let guideStart: Tile = { gx: 2, gy: 4 };
  let monolithTile: Tile = { gx: 12, gy: 2 };
  const scrapTiles: Tile[] = [];
  const triggerTiles: Tile[] = [];

  const cells: PasilloCell[][] = gridRows.map((rowText, gy) =>
    Array.from(rowText).map((symbol, gx) => {
      const { kind, walkable } = classifySymbol(symbol);
      if (kind === 'start') automatonStart = { gx, gy };
      if (kind === 'guide') guideStart = { gx, gy };
      if (kind === 'monolith') monolithTile = { gx, gy };
      if (kind === 'scrap') scrapTiles.push({ gx, gy });
      if (kind === 'trigger') triggerTiles.push({ gx, gy });
      return { gx, gy, symbol, kind, walkable };
    })
  );

  return {
    cols,
    rows,
    tileWidth: options?.tileWidth ?? DEFAULT_PASILLO_TILE_W,
    tileHeight: options?.tileHeight ?? DEFAULT_PASILLO_TILE_H,
    origin: options?.origin ?? PASILLO_ORIGIN,
    cells,
    automatonStart,
    guideStart,
    monolithTile,
    scrapTiles,
    triggerTiles,
  };
}

export function isPasilloTileWalkable(
  gx: number,
  gy: number,
  map: PasilloMapModel
): boolean {
  if (gy < 0 || gy >= map.rows || gx < 0 || gx >= map.cols) {
    return false;
  }
  return map.cells[gy]?.[gx]?.walkable ?? false;
}

export function isPasilloGoalTrigger(
  tile: Tile,
  map: PasilloMapModel
): boolean {
  if (tile.gy < 0 || tile.gy >= map.rows || tile.gx < 0 || tile.gx >= map.cols) {
    return false;
  }
  return map.cells[tile.gy]?.[tile.gx]?.kind === 'trigger';
}

/**
 * Integer pixel fit for the 480x270 logical resolution (Section 8).
 * Produces exact x4 scaling at 1920x1080 with #263647 letterbox bars.
 */
export function pasilloIntegerFit(cssW: number, cssH: number, dpr: number): IntegerFit {
  const deviceW = Math.round(cssW * dpr);
  const deviceH = Math.round(cssH * dpr);
  const scale = Math.max(
    1,
    Math.floor(Math.min(deviceW / PASILLO_BASE_W, deviceH / PASILLO_BASE_H))
  );
  return {
    scale,
    cssWidth: (PASILLO_BASE_W * scale) / dpr,
    cssHeight: (PASILLO_BASE_H * scale) / dpr,
    cssLeft: Math.max(0, Math.floor((deviceW - PASILLO_BASE_W * scale) / 2)) / dpr,
    cssTop: Math.max(0, Math.floor((deviceH - PASILLO_BASE_H * scale) / 2)) / dpr,
    unit: scale / dpr,
  };
}
