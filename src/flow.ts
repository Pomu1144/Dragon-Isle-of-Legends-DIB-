/** Shared helpers for starting battles from the overworld and handling their aftermath. */
import { toBattle, toRegion, toTown, BattleResult } from './nav';
import type { Encounter } from './core/encounters';
import { S, save } from './core/state';
import { maps, region } from './core/data';
import { toast } from './ui/dom';

export function fight(enc: Encounter, after?: (r: BattleResult) => void) {
  toBattle({
    enc,
    after: (r) => {
      if (r.outcome === 1) return defeated();
      if (after) after(r);
      else toRegion();
    },
  });
}

export function defeated() {
  const lost = Math.floor(S.silver * 0.1);
  S.silver -= lost;
  S.location = { ...S.lastTown };
  save();
  toast(`Your team was defeated… you lost ${lost} silver and retreat to town.`);
  const spot = maps()[S.location.region].spots[S.location.spot];
  if (spot?.kind === 'town' && spot.ref) toTown(spot.ref);
  else toRegion();
  void region;
}
