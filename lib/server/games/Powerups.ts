// Reusable powerup field for the movement (arena) games. Spawns glowing orbs on
// a cadence; walking over one applies its effect via the shared status timers on
// ArenaActor (see ArenaGame.moveActor / updateStatus). Mix of good and bad.

import type { ArenaActor } from "./Minigame";
import { ARENA_W, ARENA_H, PLAYER_RADIUS } from "../../shared/constants";
import { dist, type Rng } from "../../shared/util";
import { GOOD_POWERUPS, BAD_POWERUPS, type PowerupKind } from "../../shared/powerups";

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
      const every = this.opts.every ?? 3.5;
      this.spawnTimer = every + this.rng() * every;
      this.pickups.push(this.spawn());
    }
    for (const p of this.pickups) p.bob += dt * 4;
  }

  private spawn(): Pickup {
    const goodW = this.opts.goodWeight ?? 0.58;
    const pool = this.rng() < goodW ? GOOD_POWERUPS : BAD_POWERUPS;
    const kind = pool[Math.floor(this.rng() * pool.length)];
    const margin = this.opts.margin ?? 150;
    let x: number;
    let y: number;
    const circle = this.opts.spawnCircle?.();
    if (circle) {
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
