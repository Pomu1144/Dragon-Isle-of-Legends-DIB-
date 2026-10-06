import { describe, expect, it } from 'vitest';
import { dungeonEncounter, isSavePoint, nextSavePoint, resumeFloor } from '../src/core/encounters';
import { Rng } from '../src/core/rng';

describe('dungeon save points', () => {
  it('the Abyss has a teleport save point every 10 floors', () => {
    expect([1, 9, 10, 15, 20, 219].map((f) => resumeFloor('The Abyss', f))).toEqual([1, 1, 10, 10, 20, 210]);
    expect(nextSavePoint('The Abyss', 210)).toBe(220);
    expect(nextSavePoint('The Abyss', 7)).toBe(10);
    expect(isSavePoint('The Abyss', 30)).toBe(true);
    expect(isSavePoint('The Abyss', 31)).toBe(false);
  });
  it('other dungeons keep waypoints on floors 1, 6, 11, ...', () => {
    expect([1, 5, 6, 10, 11].map((f) => resumeFloor("No Man's Castle", f))).toEqual([1, 1, 6, 6, 11]);
    expect(nextSavePoint("No Man's Castle", 3)).toBe(6);
    expect(nextSavePoint("No Man's Castle", 6)).toBe(11);
  });
  it('Abyss monsters cannot be captured but pay bonus experience', () => {
    const e = dungeonEncounter('The Abyss', 40, new Rng(3));
    expect(e.capturable).toBe(false);
    expect(e.xpMult).toBeGreaterThan(1);
    expect(dungeonEncounter("No Man's Castle", 2, new Rng(3)).capturable).toBe(true);
  });
});
