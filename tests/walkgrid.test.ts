import { describe, expect, it } from 'vitest';
import { WalkGrid, groundOf, BLOCKED, PATH, GRASS, FOREST } from '../src/core/walkgrid';

/** Paint a grid from rows of characters: ~ water, . path, g grass, F forest. */
function paint(rows: string[]) {
  const colour: Record<string, [number, number, number]> = { '~': [40, 110, 190], '.': [200, 170, 110], g: [150, 210, 90], F: [30, 95, 40] };
  const cols = rows[0].length;
  const px: number[] = [];
  for (const r of rows) for (const ch of r) px.push(...colour[ch], 255);
  return { px, cols, rows: rows.length };
}

describe('ground classification', () => {
  it('reads water, roads, meadow and forest from the painting', () => {
    expect(groundOf(40, 110, 190)).toBe(BLOCKED);
    expect(groundOf(200, 170, 110)).toBe(PATH);
    expect(groundOf(150, 210, 90)).toBe(GRASS);
    expect(groundOf(30, 95, 40)).toBe(FOREST);
  });
});

describe('walk grid', () => {
  const lake = Array.from({ length: 12 }, (_, y) => Array.from({ length: 24 }, (_, x) => (x >= 8 && x <= 15 && y >= 2 && y <= 9 ? '~' : 'g')).join(''));

  it('routes around a lake instead of across it', () => {
    const { px, cols, rows } = paint(lake);
    const g = WalkGrid.fromPixels(px, cols, rows, 10);
    const path = g.path({ x: 35, y: 55 }, { x: 205, y: 55 })!;
    expect(path).not.toBeNull();
    let at = { x: 35, y: 55 };
    for (const p of path) { expect(g.clear(at, p)).toBe(true); at = p; }
    expect(path[path.length - 1]).toEqual({ x: 205, y: 55 });
  });

  it('ignores specks of blue paint too small to be water', () => {
    const rows = Array.from({ length: 10 }, (_, y) => Array.from({ length: 10 }, (_, x) => (x === 5 && y === 5 ? '~' : 'g')).join(''));
    const { px, cols } = paint(rows);
    expect(WalkGrid.fromPixels(px, cols, 10, 10).canStand({ x: 55, y: 55 })).toBe(true);
  });

  it('cuts a ford so linked landmarks on separate shores stay reachable', () => {
    const rows = Array.from({ length: 10 }, () => 'gggg' + '~'.repeat(12) + 'gggg');
    const { px, cols } = paint(rows);
    const keep = [{ x: 15, y: 45 }, { x: 185, y: 45 }];
    expect(WalkGrid.fromPixels(px, cols, 10, 10).path(keep[0], keep[1])).toBeNull();
    expect(WalkGrid.fromPixels(px, cols, 10, 10, keep, [[0, 1]]).path(keep[0], keep[1])).not.toBeNull();
  });

  it('walks to the nearest shore when the target is in the water', () => {
    const { px, cols, rows } = paint(lake);
    const g = WalkGrid.fromPixels(px, cols, rows, 10);
    const path = g.path({ x: 35, y: 55 }, { x: 115, y: 55 })!;
    expect(g.canStand(path[path.length - 1])).toBe(true);
  });
});
