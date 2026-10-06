/** Small seedable PRNG so battles can be replayed deterministically in tests. */
export class Rng {
  constructor(private s = (Math.random() * 2 ** 32) >>> 0) {}
  next() {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  int(a: number, b: number) { return Math.floor(this.range(a, b + 1)); }
  pick<T>(xs: readonly T[]): T { return xs[Math.floor(this.next() * xs.length)]; }
  chance(p: number) { return this.next() < p; }
  weighted<T>(xs: readonly T[], w: (x: T) => number): T {
    const ws = xs.map(w);
    let r = this.next() * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < xs.length; i++) if ((r -= ws[i]) <= 0) return xs[i];
    return xs[xs.length - 1];
  }
}
export const rng = new Rng();
