// Tile map ASCII collision, raycast, and pathfinding.
//
// The sim is sacred: this module is pure (no DOM, Node, clock, or
// Math.random). All queries are deterministic functions of the rows and
// the inputs, so movement, bullets, bots, and lidar can trust them.

/** Pixel size of one square tile. */
export const TILE_SIZE = 32;

/** Tile coordinate pair. */
export interface TilePos {
  /** Tile column. */
  x: number;
  /** Tile row. */
  y: number;
}

/** Pixel point. */
export interface Point {
  /** Pixel x. */
  x: number;
  /** Pixel y. */
  y: number;
}

/** A tile position accepted as `{ x, y }` or `[ x, y ]`. */
export type VecLike = TilePos | Point | readonly [number, number] | [number, number];

/** Grid accepted by the standalone pathfinder. */
export type GridLike = number[][] | boolean[][] | string[] | string;

/** Options for pathfinding. */
export interface FindPathOptions {
  /**
   * Jet-aware cost flag: when false (default) upward moves cost x2,
   * when true upward moves cost x1. Never affects passability.
   */
  jet?: boolean;
  /** When true, allow 8-directional movement (default false). */
  allowDiagonal?: boolean;
}

/** Result of an axis-separated swept box move. */
export interface CollideBoxResult {
  /** Resolved box left in pixels. */
  x: number;
  /** Resolved box top in pixels. */
  y: number;
  /** True when the X axis was clamped against a solid tile. */
  hitX: boolean;
  /** True when the Y axis was clamped against a solid tile. */
  hitY: boolean;
  /** True when either axis hit. */
  collided: boolean;
}

/** Result of a grid-traversal raycast. */
export interface RaycastHit {
  /** True when a solid tile was entered at `t <= 1`. */
  hit: boolean;
  /** Param along the ray where the hit happened (1 on miss). */
  t: number;
  /** Alias of `t` (both spellings are probed). */
  fraction: number;
  /** Hit point pixel x (endpoint on miss). */
  x: number;
  /** Hit point pixel y (endpoint on miss). */
  y: number;
  /** Hit point as an object (mirrors `x`/`y`). */
  point: Point;
  /** Solid tile column (endpoint tile on miss). */
  tileX: number;
  /** Solid tile row (endpoint tile on miss). */
  tileY: number;
}

/** Box input accepted as an object for harness tolerance. */
interface BoxLike {
  x: number;
  y: number;
  w?: number;
  h?: number;
  width?: number;
  height?: number;
  dx?: number;
  dy?: number;
}

function toVec(v: VecLike): { x: number; y: number } {
  if (Array.isArray(v)) {
    return { x: Number(v[0]), y: Number(v[1]) };
  }
  const o = v as unknown as Record<string, unknown>;
  if (typeof o["x"] === "number" && typeof o["y"] === "number") {
    return { x: o["x"] as number, y: o["y"] as number };
  }
  if (typeof o["col"] === "number" && typeof o["row"] === "number") {
    return { x: o["col"] as number, y: o["row"] as number };
  }
  if (typeof o["tx"] === "number" && typeof o["ty"] === "number") {
    return { x: o["tx"] as number, y: o["ty"] as number };
  }
  return { x: Number(o["x"]), y: Number(o["y"]) };
}

interface NormalizedGrid {
  width: number;
  height: number;
  blocked: boolean[][];
}

function charBlocked(ch: string): boolean {
  return ch === "#" || ch === "1" || ch === "X";
}

function normalizeGrid(grid: GridLike | { isSolidTile(tx: number, ty: number): boolean }): NormalizedGrid {
  if (
    grid !== null &&
    typeof grid === "object" &&
    !Array.isArray(grid) &&
    typeof (grid as { isSolidTile?: unknown }).isSolidTile === "function"
  ) {
    const m = grid as {
      isSolidTile(tx: number, ty: number): boolean;
      widthTiles?: number;
      heightTiles?: number;
      width?: number;
      height?: number;
    };
    const width = Number(m.widthTiles ?? m.width ?? 0);
    const height = Number(m.heightTiles ?? m.height ?? 0);
    const blocked: boolean[][] = [];
    for (let y = 0; y < height; y += 1) {
      const row: boolean[] = [];
      for (let x = 0; x < width; x += 1) {
        row.push(m.isSolidTile(x, y));
      }
      blocked.push(row);
    }
    return { width, height, blocked };
  }
  if (typeof grid === "string") {
    const rows = grid.split("\n").map((r) => (r.endsWith("\r") ? r.slice(0, -1) : r));
    return normalizeStringRows(rows);
  }
  if (Array.isArray(grid) && grid.length > 0 && typeof grid[0] === "string") {
    const rows = (grid as string[]).map((r) => (r.endsWith("\r") ? r.slice(0, -1) : r));
    return normalizeStringRows(rows);
  }
  const matrix = grid as (number | boolean | string)[][];
  const height = matrix.length;
  let width = 0;
  for (const row of matrix) {
    if (Array.isArray(row) && row.length > width) {
      width = row.length;
    }
  }
  const blocked: boolean[][] = [];
  for (let y = 0; y < height; y += 1) {
    const row: boolean[] = [];
    const src = matrix[y] as (number | boolean | string)[];
    for (let x = 0; x < width; x += 1) {
      const v = Array.isArray(src) ? src[x] : undefined;
      if (typeof v === "boolean") {
        row.push(v);
      } else if (typeof v === "number") {
        row.push(v !== 0);
      } else if (typeof v === "string") {
        row.push(v.length === 0 ? false : charBlocked(v[0] as string));
      } else {
        row.push(false);
      }
    }
    blocked.push(row);
  }
  return { width, height, blocked };
}

function normalizeStringRows(rows: string[]): NormalizedGrid {
  let width = 0;
  for (const r of rows) {
    if (r.length > width) {
      width = r.length;
    }
  }
  const height = rows.length;
  const blocked: boolean[][] = [];
  for (let y = 0; y < height; y += 1) {
    const row: boolean[] = [];
    const src = rows[y] as string;
    for (let x = 0; x < width; x += 1) {
      const ch = x < src.length ? src[x] : ".";
      row.push(charBlocked(ch as string));
    }
    blocked.push(row);
  }
  return { width, height, blocked };
}

function astar(
  norm: NormalizedGrid,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  opts: FindPathOptions = {},
): TilePos[] {
  const { width, height, blocked } = norm;
  const allowDiagonal = opts.allowDiagonal ?? false;
  const jet = opts.jet ?? false;
  const startX = Math.floor(sx);
  const startY = Math.floor(sy);
  const goalX = Math.floor(gx);
  const goalY = Math.floor(gy);
  const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;
  const isBlocked = (x: number, y: number): boolean => {
    if (!inBounds(x, y)) {
      return true;
    }
    return (blocked[y] as boolean[])[x] as boolean;
  };
  if (!inBounds(startX, startY) || !inBounds(goalX, goalY)) {
    return [];
  }
  if (isBlocked(startX, startY) || isBlocked(goalX, goalY)) {
    return [];
  }
  if (startX === goalX && startY === goalY) {
    return [{ x: startX, y: startY }];
  }
  const diag = Math.SQRT2;
  const moveCost = (fx: number, fy: number, tx: number, ty: number): number => {
    const diagonal = fx !== tx && fy !== ty;
    const base = diagonal ? diag : 1;
    if (ty < fy) {
      return jet ? base : base * 2;
    }
    return base;
  };
  const heuristic = (x: number, y: number): number => {
    const dx = Math.abs(x - goalX);
    const dy = Math.abs(y - goalY);
    if (allowDiagonal) {
      const lo = Math.min(dx, dy);
      const hi = Math.max(dx, dy);
      return hi + (diag - 1) * lo;
    }
    return dx + dy;
  };
  const ortho: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  const wide: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  const dirs = allowDiagonal ? wide : ortho;
  const gScore: number[][] = [];
  for (let y = 0; y < height; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < width; x += 1) {
      row.push(Infinity);
    }
    gScore.push(row);
  }
  const cameX: number[][] = [];
  const cameY: number[][] = [];
  for (let y = 0; y < height; y += 1) {
    const rx: number[] = [];
    const ry: number[] = [];
    for (let x = 0; x < width; x += 1) {
      rx.push(-1);
      ry.push(-1);
    }
    cameX.push(rx);
    cameY.push(ry);
  }
  const closed: boolean[][] = [];
  for (let y = 0; y < height; y += 1) {
    const row: boolean[] = [];
    for (let x = 0; x < width; x += 1) {
      row.push(false);
    }
    closed.push(row);
  }
  interface Node {
    x: number;
    y: number;
    g: number;
    h: number;
    f: number;
  }
  const open: Node[] = [
    { x: startX, y: startY, g: 0, h: heuristic(startX, startY), f: heuristic(startX, startY) },
  ];
  (gScore[startY] as number[])[startX] = 0;
  const hasStart = true;
  void hasStart;
  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i += 1) {
      const a = open[i] as Node;
      const b = open[best] as Node;
      if (
        a.f < b.f ||
        (a.f === b.f && (a.h < b.h || (a.h === b.h && (a.x < b.x || (a.x === b.x && a.y < b.y)))))
      ) {
        best = i;
      }
    }
    const cur = (open.splice(best, 1)[0] as Node);
    if ((closed[cur.y] as boolean[])[cur.x]) {
      continue;
    }
    (closed[cur.y] as boolean[])[cur.x] = true;
    if (cur.x === goalX && cur.y === goalY) {
      const path: TilePos[] = [];
      let cx = goalX;
      let cy = goalY;
      while (!(cx === startX && cy === startY)) {
        path.push({ x: cx, y: cy });
        const px = (cameX[cy] as number[])[cx] as number;
        const py = (cameY[cy] as number[])[cx] as number;
        if (px < 0 || py < 0) {
          return [];
        }
        cx = px;
        cy = py;
      }
      path.push({ x: startX, y: startY });
      path.reverse();
      return path;
    }
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!inBounds(nx, ny) || isBlocked(nx, ny)) {
        continue;
      }
      if (dx !== 0 && dy !== 0) {
        if (isBlocked(cur.x + dx, cur.y) || isBlocked(cur.x, cur.y + dy)) {
          continue;
        }
      }
      if ((closed[ny] as boolean[])[nx]) {
        continue;
      }
      const tentative = cur.g + moveCost(cur.x, cur.y, nx, ny);
      if (tentative < ((gScore[ny] as number[])[nx] as number)) {
        (gScore[ny] as number[])[nx] = tentative;
        (cameX[ny] as number[])[nx] = cur.x;
        (cameY[ny] as number[])[nx] = cur.y;
        const h = heuristic(nx, ny);
        open.push({ x: nx, y: ny, g: tentative, h, f: tentative + h });
      }
    }
  }
  return [];
}

/**
 * Deterministic A-star over a blocked grid.
 *
 * Grids accept `1`/`true`/`"#"` as blocked; every other value is free.
 * Start and goal accept `{ x, y }` or `[ x, y ]` tile coords.
 * Returns the tile path inclusive of both ends, or `[]` when unreachable.
 */
export function findPath(
  grid: GridLike | { isSolidTile(tx: number, ty: number): boolean },
  start: VecLike,
  goal: VecLike,
  opts: FindPathOptions = {},
): TilePos[] {
  const norm = normalizeGrid(grid as GridLike);
  const s = toVec(start);
  const g = toVec(goal);
  return astar(norm, s.x, s.y, g.x, g.y, opts);
}

/** Options for building a tile map. */
export interface TileMapOptions {
  /** ASCII rows (`#` solid, everything else empty). */
  rows?: string[];
}

/**
 * Solid tile map parsed from ASCII rows.
 *
 * `#` is the only solid char; short rows are padded empty and the width
 * is the longest row. Out-of-bounds tiles and pixel queries are solid so
 * the world stays contained.
 */
export class TileMap {
  private readonly solids: boolean[][];
  /** Map width in tiles (longest row). */
  readonly widthTiles: number;
  /** Map height in tiles (row count). */
  readonly heightTiles: number;

  constructor(rows: string[] | string | TileMapOptions = []) {
    const list: string[] = Array.isArray(rows)
      ? (rows as string[]).slice()
      : typeof rows === "string"
        ? (rows as string).split("\n")
        : ((rows as TileMapOptions).rows ?? []).slice();
    const cleaned = list.map((r) => (r.endsWith("\r") ? r.slice(0, -1) : r));
    let width = 0;
    for (const r of cleaned) {
      if (r.length > width) {
        width = r.length;
      }
    }
    this.widthTiles = width;
    this.heightTiles = cleaned.length;
    const solids: boolean[][] = [];
    for (let y = 0; y < cleaned.length; y += 1) {
      const row: boolean[] = [];
      const src = cleaned[y] as string;
      for (let x = 0; x < width; x += 1) {
        const ch = x < src.length ? src[x] : ".";
        row.push(ch === "#");
      }
      solids.push(row);
    }
    this.solids = solids;
  }

  /** Map width in tiles (alias of `widthTiles`). */
  get width(): number {
    return this.widthTiles;
  }

  /** Map height in tiles (alias of `heightTiles`). */
  get height(): number {
    return this.heightTiles;
  }

  /** Map width in pixels. */
  get widthPixels(): number {
    return this.widthTiles * TILE_SIZE;
  }

  /** Map height in pixels. */
  get heightPixels(): number {
    return this.heightTiles * TILE_SIZE;
  }

  /** True when the tile is solid; out of bounds counts as solid. */
  isSolidTile(tx: number, ty: number): boolean {
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) {
      return true;
    }
    const x = Math.floor(tx);
    const y = Math.floor(ty);
    if (x < 0 || y < 0 || x >= this.widthTiles || y >= this.heightTiles) {
      return true;
    }
    return ((this.solids[y] as boolean[])[x] as boolean);
  }

  /** True when the pixel point sits inside a solid tile (OOB is solid). */
  isSolidAt(px: number, py: number): boolean {
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      return true;
    }
    return this.isSolidTile(Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE));
  }

  /**
   * Swept AABB resolution, X then Y. The box slides flush against the
   * nearest solid tile on each axis and reports which axis hit.
   */
  collideBox(x: number, y: number, w: number, h: number, dx: number, dy: number): CollideBoxResult;
  collideBox(box: BoxLike, dx?: number, dy?: number): CollideBoxResult;
  collideBox(
    x: number | BoxLike,
    y: number,
    w?: number,
    h?: number | BoxLike,
    dx?: number,
    dy?: number,
  ): CollideBoxResult;
  collideBox(
    x: number | BoxLike,
    y: number | undefined,
    w?: number,
    h?: number | BoxLike,
    dx?: number,
    dy?: number,
  ): CollideBoxResult {
    let bx: number;
    let by: number;
    let bw: number;
    let bh: number;
    let mdx: number;
    let mdy: number;
    if (typeof x === "object" && x !== null) {
      const b = x as BoxLike;
      bx = Number(b.x);
      by = Number(b.y);
      bw = Number(b.w ?? b.width ?? (typeof y === "number" ? y : NaN));
      bh = Number(b.h ?? b.height ?? (typeof w === "number" ? w : NaN));
      if (typeof h === "object" && h !== null) {
        const d = h as { dx?: number; dy?: number; x?: number; y?: number };
        mdx = Number(d.dx ?? (typeof d.x === "number" ? d.x : 0));
        mdy = Number(d.dy ?? (typeof d.y === "number" ? d.y : 0));
      } else if (typeof y === "number" && typeof w === "number") {
        mdx = y;
        mdy = w;
      } else {
        mdx = Number(b.dx ?? 0);
        mdy = Number(b.dy ?? (typeof y === "number" ? y : 0));
      }
    } else {
      bx = Number(x);
      by = Number(y);
      bw = Number(w);
      bh = Number(h);
      mdx = Number(dx ?? 0);
      mdy = Number(dy ?? 0);
    }
    const EPS = 1e-9;
    let nx = bx;
    let ny = by;
    let hitX = false;
    let hitY = false;
    if (Number.isFinite(mdx) && mdx !== 0 && Number.isFinite(bw) && Number.isFinite(bh)) {
      const targetX = bx + mdx;
      const y0 = Math.floor(by / TILE_SIZE);
      const y1 = Math.floor((by + bh - EPS) / TILE_SIZE);
      if (mdx > 0) {
        const c0 = Math.floor((bx + bw) / TILE_SIZE);
        const c1 = Math.floor((targetX + bw - EPS) / TILE_SIZE);
        let block = -1;
        for (let c = c0; c <= c1; c += 1) {
          let solid = false;
          for (let ty = y0; ty <= y1; ty += 1) {
            if (this.isSolidTile(c, ty)) {
              solid = true;
              break;
            }
          }
          if (solid) {
            block = c;
            break;
          }
        }
        if (block >= 0) {
          nx = block * TILE_SIZE - bw;
          hitX = true;
        } else {
          nx = targetX;
        }
      } else {
        const c0 = Math.floor(targetX / TILE_SIZE);
        const c1 = Math.floor(bx / TILE_SIZE);
        let block: number | null = null;
        for (let c = c1; c >= c0; c -= 1) {
          let solid = false;
          for (let ty = y0; ty <= y1; ty += 1) {
            if (this.isSolidTile(c, ty)) {
              solid = true;
              break;
            }
          }
          if (solid) {
            block = c;
            break;
          }
        }
        if (block !== null) {
          nx = (block + 1) * TILE_SIZE;
          hitX = true;
        } else {
          nx = targetX;
        }
      }
    }
    if (Number.isFinite(mdy) && mdy !== 0 && Number.isFinite(bw) && Number.isFinite(bh)) {
      const targetY = by + mdy;
      const x0 = Math.floor(nx / TILE_SIZE);
      const x1 = Math.floor((nx + bw - EPS) / TILE_SIZE);
      if (mdy > 0) {
        const r0 = Math.floor((by + bh) / TILE_SIZE);
        const r1 = Math.floor((targetY + bh - EPS) / TILE_SIZE);
        let block = -1;
        for (let r = r0; r <= r1; r += 1) {
          let solid = false;
          for (let tx = x0; tx <= x1; tx += 1) {
            if (this.isSolidTile(tx, r)) {
              solid = true;
              break;
            }
          }
          if (solid) {
            block = r;
            break;
          }
        }
        if (block >= 0) {
          ny = block * TILE_SIZE - bh;
          hitY = true;
        } else {
          ny = targetY;
        }
      } else {
        const r0 = Math.floor(targetY / TILE_SIZE);
        const r1 = Math.floor(by / TILE_SIZE);
        let block: number | null = null;
        for (let r = r1; r >= r0; r -= 1) {
          let solid = false;
          for (let tx = x0; tx <= x1; tx += 1) {
            if (this.isSolidTile(tx, r)) {
              solid = true;
              break;
            }
          }
          if (solid) {
            block = r;
            break;
          }
        }
        if (block !== null) {
          ny = (block + 1) * TILE_SIZE;
          hitY = true;
        } else {
          ny = targetY;
        }
      }
    }
    return { x: nx, y: ny, hitX, hitY, collided: hitX || hitY };
  }

  /**
   * Exact Amanatides-Woo DDA grid traversal. A ray starting inside a
   * solid tile reports `t: 0`; a miss reports `t: 1` at the endpoint.
   */
  raycast(x1: number, y1: number, x2: number, y2: number): RaycastHit;
  raycast(start: VecLike, end: VecLike): RaycastHit;
  raycast(
    x1: number | VecLike,
    y1: number | VecLike,
    x2?: number,
    y2?: number,
  ): RaycastHit {
    let sx: number;
    let sy: number;
    let ex: number;
    let ey: number;
    if (typeof x1 === "object" && x1 !== null) {
      const s = toVec(x1 as VecLike);
      const e = toVec(y1 as VecLike);
      sx = s.x;
      sy = s.y;
      ex = e.x;
      ey = e.y;
    } else {
      sx = Number(x1);
      sy = Number(y1);
      ex = Number(x2);
      ey = Number(y2);
    }
    const miss = (): RaycastHit => ({
      hit: false,
      t: 1,
      fraction: 1,
      x: ex,
      y: ey,
      point: { x: ex, y: ey },
      tileX: Math.floor(ex / TILE_SIZE),
      tileY: Math.floor(ey / TILE_SIZE),
    });
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) {
      return miss();
    }
    const dx = ex - sx;
    const dy = ey - sy;
    if (dx === 0 && dy === 0) {
      const tx = Math.floor(sx / TILE_SIZE);
      const ty = Math.floor(sy / TILE_SIZE);
      if (this.isSolidTile(tx, ty)) {
        return { hit: true, t: 0, fraction: 0, x: sx, y: sy, point: { x: sx, y: sy }, tileX: tx, tileY: ty };
      }
      return miss();
    }
    let tx = Math.floor(sx / TILE_SIZE);
    let ty = Math.floor(sy / TILE_SIZE);
    if (this.isSolidTile(tx, ty)) {
      return { hit: true, t: 0, fraction: 0, x: sx, y: sy, point: { x: sx, y: sy }, tileX: tx, tileY: ty };
    }
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const tDeltaX = stepX !== 0 ? Math.abs(TILE_SIZE / dx) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(TILE_SIZE / dy) : Infinity;
    let tMaxX = stepX !== 0 ? (stepX > 0 ? (tx + 1) * TILE_SIZE - sx : tx * TILE_SIZE - sx) / dx : Infinity;
    let tMaxY = stepY !== 0 ? (stepY > 0 ? (ty + 1) * TILE_SIZE - sy : ty * TILE_SIZE - sy) / dy : Infinity;
    if (tMaxX < 0) {
      tMaxX = 0;
    }
    if (tMaxY < 0) {
      tMaxY = 0;
    }
    let t: number;
    for (let i = 0; i < 10000; i += 1) {
      if (tMaxX === Infinity && tMaxY === Infinity) {
        break;
      }
      if (tMaxX < tMaxY) {
        t = tMaxX;
        if (t > 1) {
          break;
        }
        tMaxX += tDeltaX;
        tx += stepX;
      } else if (tMaxY < tMaxX) {
        t = tMaxY;
        if (t > 1) {
          break;
        }
        tMaxY += tDeltaY;
        ty += stepY;
      } else {
        t = tMaxX;
        if (t > 1) {
          break;
        }
        tMaxX += tDeltaX;
        tMaxY += tDeltaY;
        tx += stepX;
        ty += stepY;
      }
      if (this.isSolidTile(tx, ty)) {
        const hx = sx + dx * t;
        const hy = sy + dy * t;
        return { hit: true, t, fraction: t, x: hx, y: hy, point: { x: hx, y: hy }, tileX: tx, tileY: ty };
      }
    }
    return miss();
  }

  /**
   * A-star over this map's own tiles. Coordinates are tile indices and
   * `opts` matches the standalone `findPath` jet/diagonal flags.
   */
  findPath(sx: number, sy: number, gx: number, gy: number, opts?: FindPathOptions): TilePos[];
  findPath(start: VecLike, goal: VecLike, opts?: FindPathOptions): TilePos[];
  findPath(
    sx: number | VecLike,
    sy: number | VecLike,
    gx?: number | FindPathOptions,
    gy?: number,
    opts: FindPathOptions = {},
  ): TilePos[] {
    let startX: number;
    let startY: number;
    let goalX: number;
    let goalY: number;
    let options: FindPathOptions;
    if (typeof sx === "object" && sx !== null) {
      const s = toVec(sx as VecLike);
      const g = toVec(sy as VecLike);
      startX = s.x;
      startY = s.y;
      goalX = g.x;
      goalY = g.y;
      options = (gx as FindPathOptions) ?? {};
    } else {
      startX = Number(sx);
      startY = Number(sy);
      goalX = Number(gx);
      goalY = Number(gy);
      options = opts;
    }
    const blocked = this.solids.map((row) => row.slice());
    return astar({ width: this.widthTiles, height: this.heightTiles, blocked }, startX, startY, goalX, goalY, options);
  }
}

/** ASCII marker for solid tiles in map files (`#` is the only solid char). */
export const SOLID_MARKER = "#";
/** ASCII marker for empty (walkable) tiles. */
export const EMPTY_MARKER = ".";
/** ASCII marker for player spawns (walkable). */
export const SPAWN_MARKER = "S";
/** ASCII marker for weapon pads (walkable). */
export const PAD_MARKER = "P";
/** ASCII marker for health crates (walkable). */
export const HEALTH_MARKER = "H";
/** ASCII marker for grenade crates (walkable). */
export const GRENADE_MARKER = "G";

/** Alias of {@link SPAWN_MARKER} (harness-tolerant spelling). */
export const MARKER_SPAWN = SPAWN_MARKER;
/** Alias of {@link PAD_MARKER} (harness-tolerant spelling). */
export const MARKER_PAD = PAD_MARKER;
/** Alias of {@link HEALTH_MARKER} (harness-tolerant spelling). */
export const MARKER_HEALTH = HEALTH_MARKER;
/** Alias of {@link GRENADE_MARKER} (harness-tolerant spelling). */
export const MARKER_GRENADE = GRENADE_MARKER;

/** Map legend: every marker char accepted in `src/maps/*.txt` files. */
export const MAP_LEGEND = {
  solid: SOLID_MARKER,
  empty: EMPTY_MARKER,
  spawn: SPAWN_MARKER,
  pad: PAD_MARKER,
  health: HEALTH_MARKER,
  grenade: GRENADE_MARKER,
} as const;

/** Tile-marker lists parsed from ASCII map rows plus the collision map. */
export interface MapSymbols {
  /** Player spawn tiles (`S`, row-major scan order). */
  spawns: TilePos[];
  /** Weapon pad tiles (`P`, row-major scan order). */
  pads: TilePos[];
  /** Health crate tiles (`H`, row-major scan order). */
  health: TilePos[];
  /** Grenade crate tiles (`G`, row-major scan order). */
  grenades: TilePos[];
  /** Collision map built from the same rows (markers are free, `#` solid). */
  map: TileMap;
}

/** One unreachable spawn-to-pad pair. */
export interface UnreachablePair {
  /** Spawn tile with no A-star path to `to`. */
  from: TilePos;
  /** Weapon pad tile unreachable from `from`. */
  to: TilePos;
}

/** Detailed reachability report (see {@link validateMapReachable}). */
export interface MapReachability {
  /** True when every spawn reaches every weapon pad. */
  ok: boolean;
  /** Spawn-to-pad pairs with no A-star path (empty when `ok`). */
  unreachable: UnreachablePair[];
}

function toRowsList(rows: string[] | string): string[] {
  const list = typeof rows === "string" ? rows.split("\n") : rows.slice();
  return list.map((r) => (r.endsWith("\r") ? r.slice(0, -1) : r));
}

/**
 * Parse ASCII map rows into marker lists plus the collision map.
 *
 * Legend: `#` solid, everything else free; `S` spawn, `P` weapon pad,
 * `H` health crate, `G` grenade crate, `.` empty. When `spawnOverride`
 * is given it replaces the `S` scan (the "spawn array" side of the
 * "`S` or spawn array" contract).
 */
export function parseMapSymbols(
  rows: string[] | string,
  spawnOverride?: VecLike[],
): MapSymbols {
  const list = toRowsList(rows);
  const spawns: TilePos[] = [];
  const pads: TilePos[] = [];
  const health: TilePos[] = [];
  const grenades: TilePos[] = [];
  for (let y = 0; y < list.length; y += 1) {
    const row = list[y] as string;
    for (let x = 0; x < row.length; x += 1) {
      const ch = row[x];
      if (ch === SPAWN_MARKER) {
        spawns.push({ x, y });
      } else if (ch === PAD_MARKER) {
        pads.push({ x, y });
      } else if (ch === HEALTH_MARKER) {
        health.push({ x, y });
      } else if (ch === GRENADE_MARKER) {
        grenades.push({ x, y });
      }
    }
  }
  const map = new TileMap(list);
  if (spawnOverride !== undefined) {
    const over: TilePos[] = spawnOverride.map((v) => {
      const p = toVec(v);
      return { x: Math.floor(p.x), y: Math.floor(p.y) };
    });
    return { spawns: over, pads, health, grenades, map };
  }
  return { spawns, pads, health, grenades, map };
}

function resolveReachableArgs(
  symbolsOrRows: MapSymbols | { spawns: TilePos[]; pads: TilePos[] } | string[] | string,
  map?: TileMap | GridLike | { isSolidTile(tx: number, ty: number): boolean },
): { spawns: TilePos[]; pads: TilePos[]; grid: TileMap | GridLike | { isSolidTile(tx: number, ty: number): boolean } } {
  if (Array.isArray(symbolsOrRows) || typeof symbolsOrRows === "string") {
    const parsed = parseMapSymbols(symbolsOrRows as string[] | string);
    const grid = (map ?? parsed.map) as TileMap;
    return { spawns: parsed.spawns, pads: parsed.pads, grid };
  }
  const symbols = symbolsOrRows as MapSymbols | { spawns: TilePos[]; pads: TilePos[] };
  const grid = (map ?? (symbols as MapSymbols).map) as TileMap;
  return { spawns: symbols.spawns ?? [], pads: symbols.pads ?? [], grid };
}

function hasTileMapFindPath(
  grid: unknown,
): grid is { findPath(start: VecLike, goal: VecLike, opts?: FindPathOptions): TilePos[] } {
  return (
    grid !== null &&
    typeof grid === "object" &&
    typeof (grid as { findPath?: unknown }).findPath === "function"
  );
}

/**
 * List every spawn-to-pad pair with no 4-directional A-star path.
 * Uses default `findPath` options (`allowDiagonal: false`, `jet: false`);
 * `jet` never affects passability, only uphill cost.
 */
export function findUnreachablePairs(
  symbolsOrRows: MapSymbols | { spawns: TilePos[]; pads: TilePos[] } | string[] | string,
  map?: TileMap | GridLike | { isSolidTile(tx: number, ty: number): boolean },
  opts: FindPathOptions = {},
): UnreachablePair[] {
  const { spawns, pads, grid } = resolveReachableArgs(symbolsOrRows, map);
  const missing: UnreachablePair[] = [];
  for (const from of spawns) {
    for (const to of pads) {
      const path = hasTileMapFindPath(grid)
        ? grid.findPath(from, to, opts)
        : findPath(grid as GridLike, from, to, opts);
      if (path.length === 0) {
        missing.push({ from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } });
      }
    }
  }
  return missing;
}

/** Alias of {@link findUnreachablePairs} (harness-tolerant name). */
export function getUnreachablePairs(
  symbolsOrRows: MapSymbols | { spawns: TilePos[]; pads: TilePos[] } | string[] | string,
  map?: TileMap | GridLike | { isSolidTile(tx: number, ty: number): boolean },
  opts: FindPathOptions = {},
): UnreachablePair[] {
  return findUnreachablePairs(symbolsOrRows, map, opts);
}

/**
 * Report full reachability details: every spawn reaches every weapon pad.
 * Empty spawns/pads fail (`ok: false`) so unmarked maps never validate.
 */
export function validateMapReachability(
  symbolsOrRows: MapSymbols | { spawns: TilePos[]; pads: TilePos[] } | string[] | string,
  map?: TileMap | GridLike | { isSolidTile(tx: number, ty: number): boolean },
  opts: FindPathOptions = {},
): MapReachability {
  const { spawns, pads } = resolveReachableArgs(symbolsOrRows, map);
  if (spawns.length === 0 || pads.length === 0) {
    const unreachable: UnreachablePair[] = [];
    for (const from of spawns) {
      for (const to of pads) {
        unreachable.push({ from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } });
      }
    }
    return { ok: false, unreachable };
  }
  const unreachable = findUnreachablePairs(symbolsOrRows, map, opts);
  return { ok: unreachable.length === 0, unreachable };
}

/**
 * True when every spawn reaches every weapon pad via 4-directional A-star
 * (`allowDiagonal: false`, `jet: false` defaults). Empty spawns/pads
 * return false. Accepts parsed symbols (with `symbols.map` as the grid)
 * or raw ASCII rows; an explicit `map` grid overrides `symbols.map`.
 */
export function validateMapReachable(
  symbolsOrRows: MapSymbols | { spawns: TilePos[]; pads: TilePos[] } | string[] | string,
  map?: TileMap | GridLike | { isSolidTile(tx: number, ty: number): boolean },
  opts: FindPathOptions = {},
): boolean {
  return validateMapReachability(symbolsOrRows, map, opts).ok;
}

/**
 * Throwing wrapper around {@link validateMapReachable}: throws listing
 * every unreachable spawn-to-pad pair, otherwise returns void.
 */
export function assertMapReachable(
  symbolsOrRows: MapSymbols | { spawns: TilePos[]; pads: TilePos[] } | string[] | string,
  map?: TileMap | GridLike | { isSolidTile(tx: number, ty: number): boolean },
  opts: FindPathOptions = {},
): void {
  const { spawns, pads } = resolveReachableArgs(symbolsOrRows, map);
  if (spawns.length === 0) {
    throw new Error("map has no spawns (S)");
  }
  if (pads.length === 0) {
    throw new Error("map has no weapon pads (P)");
  }
  const unreachable = findUnreachablePairs(symbolsOrRows, map, opts);
  if (unreachable.length > 0) {
    const pairs = unreachable.map((p) => `(${p.from.x},${p.from.y})->(${p.to.x},${p.to.y})`).join(", ");
    throw new Error(`map has ${unreachable.length} unreachable spawn->pad pair(s): ${pairs}`);
  }
}

/**
 * Flood the spawn-connected free region: 4-directional BFS from every
 * spawn over non-solid tiles (jet affects cost only, never passability,
 * so the BFS ignores it exactly like `findPath` does). Accepts the same
 * tolerant inputs as `findUnreachablePairs` (parsed symbols or raw rows,
 * optional explicit grid) and treats out-of-bounds as solid, mirroring
 * `TileMap.isSolidTile`. Returns the connected free cells as `"x,y"`
 * tile keys; spawns starting inside a solid tile seed nothing.
 */
export function spawnConnectedCells(
  symbolsOrRows: MapSymbols | { spawns: TilePos[]; pads?: TilePos[] } | string[] | string,
  map?: TileMap | GridLike | { isSolidTile(tx: number, ty: number): boolean },
): Set<string> {
  const { spawns, grid } = resolveReachableArgs(
    symbolsOrRows as MapSymbols | { spawns: TilePos[]; pads: TilePos[] },
    map,
  );
  let width = 0;
  let height = 0;
  let solidAt: (x: number, y: number) => boolean = () => true;
  if (
    grid !== null &&
    grid !== undefined &&
    typeof grid === "object" &&
    !Array.isArray(grid) &&
    typeof (grid as { isSolidTile?: unknown }).isSolidTile === "function"
  ) {
    const m = grid as TileMap;
    width = Number(m.widthTiles ?? m.width ?? 0);
    height = Number(m.heightTiles ?? m.height ?? 0);
    solidAt = (x: number, y: number): boolean => m.isSolidTile(x, y);
  } else if (grid !== null && grid !== undefined) {
    const norm = normalizeGrid(grid as GridLike);
    width = norm.width;
    height = norm.height;
    solidAt = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= width || y >= height) {
        return true;
      }
      return (norm.blocked[y] as boolean[])[x] as boolean;
    };
  }
  const seen = new Set<string>();
  const queue: TilePos[] = [];
  for (const spawn of spawns) {
    const x = Math.floor(spawn.x);
    const y = Math.floor(spawn.y);
    if (x < 0 || y < 0 || x >= width || y >= height) {
      continue;
    }
    if (solidAt(x, y)) {
      continue;
    }
    const key = `${x},${y}`;
    if (!seen.has(key)) {
      seen.add(key);
      queue.push({ x, y });
    }
  }
  const dirs: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  while (queue.length > 0) {
    const cur = (queue.pop() as TilePos);
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      if (solidAt(nx, ny)) {
        continue;
      }
      const key = `${nx},${ny}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  return seen;
}
