/**
 * Where the hero can walk on a region painting, and what kind of ground each place is.
 * Built at runtime from the painting itself (sampled down to a coarse grid), so every map works without
 * hand-made collision data: open water and lava block the way; forests and meadows hide wild monsters.
 */
export type Ground = 0 | 1 | 2 | 3;
export const BLOCKED: Ground = 0, PATH: Ground = 1, GRASS: Ground = 2, FOREST: Ground = 3;
export interface Pt { x: number; y: number }

/** Blocked patches smaller than this many cells are shadows or ripples in the paint, not real obstacles. */
const MIN_OBSTACLE = 40;

function hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, mx ? d / mx : 0, mx / 255];
}

/** Ground type of one averaged map colour (0..255 channels). */
export function groundOf(r: number, g: number, b: number): Ground {
  const [h, s, v] = hsv(r, g, b);
  if (h > 0.43 && h < 0.64 && s > 0.18 && b > r + 10) return BLOCKED; // open water (same test as tools/place_spots.py)
  if ((h < 0.06 || h > 0.97) && s > 0.65 && v > 0.55) return BLOCKED; // glowing lava
  if (h > 0.17 && h < 0.45 && s > 0.2 && v < 0.5) return FOREST; // dark tree canopy
  if (h > 0.16 && h < 0.45 && s > 0.18) return GRASS;
  return PATH; // dirt roads, sand, rock, snow, ash
}

export class WalkGrid {
  /** True when the region has little vegetation (snowfields, ash, hell): then any open ground is wild. */
  readonly bare: boolean;

  constructor(readonly cols: number, readonly rows: number, readonly cell: number, readonly ground: Uint8Array) {
    let veg = 0, open = 0;
    for (const g of ground) if (g) { open++; if (g >= GRASS) veg++; }
    this.bare = veg < open * 0.15;
  }

  /**
   * @param rgba   the painting drawn at cols x rows (one pixel per cell)
   * @param keep   cells that must stay walkable (towns, roads out, docks, …)
   * @param links  pairs of `keep` indices that must be connected; a corridor is cut between them when the
   *               painting leaves them on separate islands of walkable ground
   */
  static fromPixels(rgba: ArrayLike<number>, cols: number, rows: number, cell: number, keep: Pt[] = [], links: [number, number][] = []) {
    const n = cols * rows;
    const ground = new Uint8Array(n);
    for (let i = 0; i < n; i++) ground[i] = groundOf(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    // small blocked blobs become open ground
    const seen = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (ground[i] !== BLOCKED || seen[i]) continue;
      const blob = flood(i, cols, rows, (j) => ground[j] === BLOCKED, seen);
      if (blob.length < MIN_OBSTACLE) for (const j of blob) ground[j] = PATH;
    }
    const grid = new WalkGrid(cols, rows, cell, ground);
    const at = keep.map((p) => grid.clampCell(p));
    for (const [cx, cy] of at) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) grid.open(cx + dx, cy + dy);
    // connect every required pair, shortest links first, cutting corridors only between separate islands
    const comp = grid.components();
    const parent = new Map<number, number>();
    const find = (c: number): number => { while (parent.has(c) && parent.get(c) !== c) c = parent.get(c)!; return c; };
    const order = [...links].sort((p, q) => dist2(at[p[0]], at[p[1]]) - dist2(at[q[0]], at[q[1]]));
    for (const [a, b] of order) {
      const ca = find(comp[at[a][1] * cols + at[a][0]]), cb = find(comp[at[b][1] * cols + at[b][0]]);
      if (ca === cb) continue;
      grid.carve(at[a], at[b]);
      parent.set(ca, cb);
    }
    return grid;
  }

  inside(cx: number, cy: number) { return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows; }
  walkable(cx: number, cy: number) { return this.inside(cx, cy) && this.ground[cy * this.cols + cx] !== BLOCKED; }
  cellOf(p: Pt): [number, number] { return [Math.floor(p.x / this.cell), Math.floor(p.y / this.cell)]; }
  clampCell(p: Pt): [number, number] {
    const [cx, cy] = this.cellOf(p);
    return [Math.min(this.cols - 1, Math.max(0, cx)), Math.min(this.rows - 1, Math.max(0, cy))];
  }
  center(cx: number, cy: number): Pt { return { x: (cx + 0.5) * this.cell, y: (cy + 0.5) * this.cell }; }
  groundAt(p: Pt): Ground { const [cx, cy] = this.cellOf(p); return this.inside(cx, cy) ? this.ground[cy * this.cols + cx] as Ground : BLOCKED; }
  canStand(p: Pt) { const [cx, cy] = this.cellOf(p); return this.walkable(cx, cy); }

  /** Block the cells whose centres lie in a rectangle (world px): a building or prop standing on the ground. */
  blockRect(x: number, y: number, w: number, h: number) {
    const c0 = Math.max(0, Math.ceil(x / this.cell - 0.5)), c1 = Math.min(this.cols - 1, Math.floor((x + w) / this.cell - 0.5));
    const r0 = Math.max(0, Math.ceil(y / this.cell - 0.5)), r1 = Math.min(this.rows - 1, Math.floor((y + h) / this.cell - 0.5));
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) this.ground[cy * this.cols + cx] = BLOCKED;
  }

  /** Block every cell whose centre (world px) the test picks out, e.g. ground outside a hand-drawn walk area. */
  blockWhere(blocked: (x: number, y: number) => boolean) {
    for (let cy = 0; cy < this.rows; cy++) for (let cx = 0; cx < this.cols; cx++)
      if (blocked((cx + 0.5) * this.cell, (cy + 0.5) * this.cell)) this.ground[cy * this.cols + cx] = BLOCKED;
  }

  private open(cx: number, cy: number) {
    if (this.inside(cx, cy) && this.ground[cy * this.cols + cx] === BLOCKED) this.ground[cy * this.cols + cx] = PATH;
  }

  /** Two cells wide straight corridor (a ford or a rope bridge) between two cells. */
  private carve(a: [number, number], b: [number, number]) {
    const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 1);
    for (let i = 0; i <= steps; i++) {
      const cx = Math.round(a[0] + ((b[0] - a[0]) * i) / steps), cy = Math.round(a[1] + ((b[1] - a[1]) * i) / steps);
      this.open(cx, cy); this.open(cx + 1, cy); this.open(cx, cy + 1);
    }
  }

  /** Component id of every cell (4-connected walkable ground); blocked cells get -1. */
  components() {
    const n = this.cols * this.rows;
    const comp = new Int32Array(n).fill(-1);
    const seen = new Uint8Array(n);
    let id = 0;
    for (let i = 0; i < n; i++) {
      if (seen[i] || this.ground[i] === BLOCKED) continue;
      for (const j of flood(i, this.cols, this.rows, (k) => this.ground[k] !== BLOCKED, seen)) comp[j] = id;
      id++;
    }
    return comp;
  }

  /** Closest walkable cell to a cell (searching outwards ring by ring). */
  nearestWalkable(cx: number, cy: number): [number, number] | null {
    for (let r = 0; r < Math.max(this.cols, this.rows); r++) {
      let best: [number, number] | null = null, bd = Infinity;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !this.walkable(cx + dx, cy + dy)) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = [cx + dx, cy + dy]; }
      }
      if (best) return best;
    }
    return null;
  }

  /** Straight walk between two points crosses only walkable cells. */
  clear(a: Pt, b: Pt) {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (this.cell * 0.4)) || 1;
    for (let i = 1; i <= steps; i++) if (!this.canStand({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps })) return false;
    return true;
  }

  /**
   * Walking route from one point to another (A* over the cells, 8 directions, no cutting past blocked corners),
   * smoothed into a few straight legs. Ends at `to`, or at the nearest walkable place when `to` is blocked.
   * Returns null when there is no way there.
   */
  path(from: Pt, to: Pt): Pt[] | null {
    const s = this.walkable(...this.cellOf(from)) ? this.cellOf(from) : this.nearestWalkable(...this.clampCell(from));
    let goal = this.clampCell(to);
    let end = to;
    if (!this.walkable(goal[0], goal[1])) {
      const g = this.nearestWalkable(goal[0], goal[1]);
      if (!g) return null;
      goal = g;
      end = this.center(g[0], g[1]);
    }
    if (!s) return null;
    const W = this.cols, start = s[1] * W + s[0], target = goal[1] * W + goal[0];
    const gScore = new Float64Array(W * this.rows).fill(Infinity);
    const came = new Int32Array(W * this.rows).fill(-1);
    const heap = new Heap();
    const hFn = (i: number) => { const dx = Math.abs((i % W) - goal[0]), dy = Math.abs(Math.floor(i / W) - goal[1]); return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy); };
    gScore[start] = 0;
    heap.push(start, hFn(start));
    const closed = new Uint8Array(W * this.rows);
    while (heap.size) {
      const c = heap.pop();
      if (c === target) break;
      if (closed[c]) continue;
      closed[c] = 1;
      const cx = c % W, cy = Math.floor(c / W);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (!this.walkable(nx, ny)) continue;
        if (dx && dy && (!this.walkable(cx + dx, cy) || !this.walkable(cx, cy + dy))) continue;
        const ni = ny * W + nx, ng = gScore[c] + (dx && dy ? Math.SQRT2 : 1);
        if (ng < gScore[ni]) { gScore[ni] = ng; came[ni] = c; heap.push(ni, ng + hFn(ni)); }
      }
    }
    if (start !== target && came[target] < 0) return null;
    const cells: Pt[] = [];
    for (let c = target; c !== start && c >= 0; c = came[c]) cells.unshift(this.center(c % W, Math.floor(c / W)));
    if (cells.length) cells[cells.length - 1] = end;
    else cells.push(end);
    // string-pull: keep only the corners the hero actually has to turn at
    const out: Pt[] = [];
    let at = from;
    for (let i = 0; i < cells.length;) {
      let j = cells.length - 1;
      while (j > i && !this.clear(at, cells[j])) j--;
      out.push(cells[j]);
      at = cells[j];
      i = j + 1;
    }
    return out;
  }
}

function dist2(a: [number, number], b: [number, number]) { return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2; }

function flood(i: number, cols: number, rows: number, ok: (j: number) => boolean, seen: Uint8Array) {
  const out: number[] = [];
  const stack = [i];
  seen[i] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    out.push(c);
    const cx = c % cols, cy = Math.floor(c / cols);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy, j = ny * cols + nx;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen[j] || !ok(j)) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return out;
}

/** Minimal binary heap of cell indices keyed by priority. */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.v.length; }
  push(v: number, k: number) {
    this.k.push(k); this.v.push(v);
    let i = this.v.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= this.k[i]) break;
      [this.k[p], this.k[i]] = [this.k[i], this.k[p]];
      [this.v[p], this.v[i]] = [this.v[i], this.v[p]];
      i = p;
    }
  }
  pop() {
    const top = this.v[0];
    const lk = this.k.pop()!, lv = this.v.pop()!;
    if (this.v.length) {
      this.k[0] = lk; this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.v.length && this.k[l] < this.k[m]) m = l;
        if (r < this.v.length && this.k[r] < this.k[m]) m = r;
        if (m === i) break;
        [this.k[m], this.k[i]] = [this.k[i], this.k[m]];
        [this.v[m], this.v[i]] = [this.v[i], this.v[m]];
        i = m;
      }
    }
    return top;
  }
}
