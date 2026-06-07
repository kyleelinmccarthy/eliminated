// Reusable powerup field for the movement (arena) games. Spawns glowing orbs on
// a cadence; walking over one applies its effect via the shared status timers on
// ArenaActor (see ArenaGame.moveActor / updateStatus). Mix of good and bad.

import type { ArenaActor } from "./Minigame";
import type { Effect } from "../../shared/types";
import { ARENA_W, ARENA_H, PLAYER_RADIUS } from "../../shared/constants";
import { dist, type Rng } from "../../shared/util";
import { GOOD_POWERUPS, BAD_POWERUPS, pickupReveal, type PowerupKind } from "../../shared/powerups";

export interface Pickup {
  id: number;
  kind: PowerupKind;
  x: number;
  y: number;
  bob: number;
}

// Effect durations in seconds (shield is consumed on use, not timed).
const DURATIONS: Record<PowerupKind, number> = {
  speed: 7,
  shield: 0,
  tiny: 9,
  vision: 10,
  bamboozled: 5,
  slow: 6,
  giant: 8,
  dizzy: 5,
};

export interface PowerupFieldOpts {
  every?: number; // base seconds between spawns
  max?: number; // max pickups on the field at once
  goodWeight?: number; // 0..1 chance a spawn is a *good* powerup
  margin?: number; // keep spawns this far from the walls (or, with spawnCircle, from its edge)
  firstDelay?: number;
  // Optional dynamic spawn region. When set, spawns land uniformly *inside this
  // circle* instead of the rectangular margin — e.g. the shrinking safe island in
  // King of the Lava Island, so powerups never appear out in the lava.
  spawnCircle?: () => { x: number; y: number; r: number };
  // Optional set of dynamic spawn regions (e.g. the several sinking islands in
  // King of the Lava Islands). A spawn lands on a *random* one, weighted by its
  // usable area so bigger islands host more orbs. If this returns an empty list
  // there's no safe ground right now, so the spawn is skipped (never the lava).
  spawnRegions?: () => { x: number; y: number; r: number }[];
  // Optional fx sink. When set, collect() announces each pickup right over the
  // blob (icon + name, good/bad color) so it's obvious what you just grabbed —
  // the reveal for an otherwise-identical mystery orb. Wire it to the game's
  // boom() so the burst rides along in the snapshot.
  emit?: (kind: Effect["kind"], x: number, y: number, extra?: Partial<Effect>) => void;
}

export class PowerupField {
  pickups: Pickup[] = [];
  private spawnTimer: number;
  private nextId = 1;

  constructor(private rng: Rng, private opts: PowerupFieldOpts = {}) {
    this.spawnTimer = opts.firstDelay ?? 1.5;
  }

  tick(dt: number): void {
    this.spawnTimer -= dt;
    const max = this.opts.max ?? 4;
    if (this.spawnTimer <= 0 && this.pickups.length < max) {
      const pk = this.spawn();
      if (pk) {
        const every = this.opts.every ?? 3.5;
        this.spawnTimer = every + this.rng() * every;
        this.pickups.push(pk);
      } else {
        // no safe ground to spawn on right now — try again shortly
        this.spawnTimer = 0.6;
      }
    }
    for (const p of this.pickups) p.bob += dt * 4;
  }

  private spawn(): Pickup | null {
    const goodW = this.opts.goodWeight ?? 0.58;
    const pool = this.rng() < goodW ? GOOD_POWERUPS : BAD_POWERUPS;
    const kind = pool[Math.floor(this.rng() * pool.length)];
    const margin = this.opts.margin ?? 150;
    let x: number;
    let y: number;
    const regions = this.opts.spawnRegions?.();
    const circle = this.opts.spawnCircle?.();
    if (regions) {
      if (!regions.length) return null; // nowhere safe — skip this spawn
      // pick a region weighted by usable area, then a uniform point inside it
      const usable = regions.map((c) => Math.max(0, c.r - margin));
      const weights = usable.map((u) => u * u);
      const total = weights.reduce((a, b) => a + b, 0);
      let pick = regions[0];
      let pickR = usable[0];
      if (total > 0) {
        let r = this.rng() * total;
        for (let i = 0; i < regions.length; i++) {
          r -= weights[i];
          if (r <= 0) {
            pick = regions[i];
            pickR = usable[i];
            break;
          }
        }
      }
      const ang = this.rng() * Math.PI * 2;
      const rad = Math.sqrt(this.rng()) * pickR;
      x = pick.x + Math.cos(ang) * rad;
      y = pick.y + Math.sin(ang) * rad;
    } else if (circle) {
      // Uniform point within the circle (sqrt keeps it even, not center-biased),
      // kept `margin` clear of the edge so a fresh spawn never lands in the lava.
      const ang = this.rng() * Math.PI * 2;
      const rad = Math.sqrt(this.rng()) * Math.max(0, circle.r - margin);
      x = circle.x + Math.cos(ang) * rad;
      y = circle.y + Math.sin(ang) * rad;
    } else {
      x = margin + this.rng() * (ARENA_W - 2 * margin);
      y = margin + this.rng() * (ARENA_H - 2 * margin);
    }
    return { id: this.nextId++, kind, x, y, bob: this.rng() * Math.PI * 2 };
  }

  // Drop pickups that no longer belong on the field (e.g. ones the shrinking lava
  // has swallowed). Caller supplies the keep test; called once per tick.
  cull(keep: (p: Pickup) => boolean): void {
    this.pickups = this.pickups.filter(keep);
  }

  // If `a` overlaps a pickup, apply it and remove it. Returns the kind (for fx),
  // or null. Frozen / dead actors should be filtered by the caller.
  collect(a: ArenaActor): PowerupKind | null {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      if (dist(a.x, a.y, pk.x, pk.y) < PLAYER_RADIUS * a.scale + 18) {
        this.apply(a, pk.kind);
        this.pickups.splice(i, 1);
        const r = pickupReveal(pk.kind);
        this.opts.emit?.("spark", pk.x, pk.y, { color: r.color });
        this.opts.emit?.("pickup", a.x, a.y - PLAYER_RADIUS * a.scale - 24, { text: r.text, color: r.color });
        return pk.kind;
      }
    }
    return null;
  }

  apply(a: ArenaActor, kind: PowerupKind): void {
    const d = (a.data ??= {});
    switch (kind) {
      case "speed":
        d.puSpeedT = DURATIONS.speed;
        break;
      case "shield":
        a.shield = true;
        break;
      case "tiny":
        a.scale = 0.62;
        d.puTinyT = DURATIONS.tiny;
        break;
      case "vision":
        d.puVisionT = DURATIONS.vision;
        break;
      case "bamboozled":
        d.puReverseT = DURATIONS.bamboozled;
        break;
      case "slow":
        d.puSlowT = DURATIONS.slow;
        break;
      case "giant":
        a.scale = 1.5;
        d.puGiantT = DURATIONS.giant;
        break;
      case "dizzy":
        d.puDizzyT = DURATIONS.dizzy;
        break;
    }
  }

  // Compact list for the snapshot (the renderer draws icons from the catalog).
  snapshot() {
    return this.pickups.map((p) => ({
      id: p.id,
      kind: p.kind,
      x: Math.round(p.x),
      y: Math.round(p.y),
      bob: +p.bob.toFixed(2),
    }));
  }
}
