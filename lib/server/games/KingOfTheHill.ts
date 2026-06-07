// King of the Lava Islands — the series FINALE. The floor is lava; a scattering
// of islands of various sizes rises, holds, then SINKS back into the magma. You
// have to hop from island to island to stay off the floor, scramble for powerups
// (a shield is gold), and shove rivals into the lava. As the round wears on the
// islands get scarcer and smaller, then it collapses to one shrinking last-stand
// island. Last blob not-on-fire is champion. Decisive by design.

import { ArenaGame, crownOne, type GameContext, type ArenaActor, type MinigameResult } from "./Minigame";
import type { GameId, Snapshot } from "../../shared/types";
import { ARENA_W, ARENA_H, PLAYER_RADIUS } from "../../shared/constants";
import { dist } from "../../shared/util";
import { PowerupField } from "./Powerups";

const TIME_CAP = 60;
const BURN_GRACE = 0.95; // seconds standing in lava before you burn out

// island sizing (arena units)
const R_SMALL = 56;
const R_LARGE = 150;
const FINAL_R = 32; // sudden-death floor — too small to hold a crowd

interface Island {
  id: number;
  x: number;
  y: number;
  r: number; // current (eased) radius
  targetR: number; // radius r eases toward
  maxR: number; // full size once risen
  phase: "rising" | "stable" | "sinking";
  timer: number; // seconds until this phase ends (used while stable)
  final?: boolean; // the chosen last-stand island in sudden death
}

export class KingOfTheHill extends ArenaGame {
  id: GameId = "koth";
  private cx = ARENA_W / 2;
  private cy = ARENA_H / 2;
  private islands: Island[] = [];
  private islandSeq = 1;
  private spawnTimer = 1.5;
  private suddenDeath = false;
  private kingId: string | null = null;
  private powerups: PowerupField;
  private elimOrder: { id: string; note?: string }[] = [];

  constructor(ctx: GameContext) {
    super(ctx);
    // Powerups spawn on a *random* island (area-weighted), kept clear of its
    // molten edge — never out in the lava — and they sink with it (see cull).
    this.powerups = new PowerupField(ctx.rng, {
      every: 2.5,
      max: 6,
      goodWeight: 0.55,
      margin: 40,
      spawnRegions: () =>
        this.islands.filter((i) => i.phase !== "sinking" && i.r > 46).map((i) => ({ x: i.x, y: i.y, r: i.r })),
    });
  }

  start(): void {
    // A randomized opening spread — no guaranteed island in the middle, so the
    // safe ground is different every finale and you actually have to hop around
    // to chase it (the old layout always kept a comfy central island).
    const nStart = 5;
    for (let i = 0; i < nStart; i++) {
      const maxR = R_SMALL + 18 + this.ctx.rng() * (R_LARGE - R_SMALL - 18);
      const isl = this.spawnIsland(maxR);
      isl.r = maxR; // start fully risen
      isl.phase = "stable";
      isl.timer = 7 + this.ctx.rng() * 7; // linger a good while before sinking
    }

    const ps = this.ctx.players;
    ps.forEach((p, i) => {
      // drop each blob ONTO an existing island (never in the lava) so the start is fair
      const isl = this.islands[i % this.islands.length];
      const ang = this.ctx.rng() * Math.PI * 2;
      const rad = this.ctx.rng() * Math.max(0, isl.r - PLAYER_RADIUS - 6);
      const a = this.addActor(p, isl.x + Math.cos(ang) * rad, isl.y + Math.sin(ang) * rad);
      a.data!.burnT = 0;
      a.data!.kingT = 0;
    });
    this.ctx.toast("The floor is LAVA! Hop between the sinking islands — and RAM rivals into the magma!", "bad");
  }

  private aliveActors() {
    return [...this.actors.values()].filter((a) => a.alive);
  }

  // the island a point is standing on (nearest center if several overlap), or null
  private islandUnder(a: { x: number; y: number }): Island | null {
    let best: Island | null = null;
    let bd = Infinity;
    for (const isl of this.islands) {
      const d = dist(a.x, a.y, isl.x, isl.y);
      if (d <= isl.r && d < bd) {
        bd = d;
        best = isl;
      }
    }
    return best;
  }

  tick(dt: number, _now: number): void {
    this.elapsed += dt;
    this.powerups.tick(dt);

    this.updateIslands(dt);

    // any powerup the lava has now swallowed (no island under it) is gone
    this.powerups.cull((p) => this.islands.some((isl) => dist(p.x, p.y, isl.x, isl.y) <= isl.r - 6));

    for (const a of this.actors.values()) {
      if (!a.alive) continue;
      this.updateStatus(a, dt);
      if (a.isBot) this.botThink(a);
      this.moveActor(a, dt);
      this.powerups.collect(a);
    }

    this.separate();
    this.lava(dt);
    this.crown(dt);

    const alive = this.aliveActors();
    if (alive.length <= 1 || this.elapsed >= TIME_CAP) this.done = true;
  }

  // --- island lifecycle: rise -> hold -> sink, with the field thinning over time ---
  private updateIslands(dt: number): void {
    const t = this.elapsed;

    // Late in the round (or once the field has thinned) collapse to a single
    // shrinking last-stand island so the game ends decisively — classic KotH.
    if (!this.suddenDeath && (t >= TIME_CAP * 0.72 || this.aliveActors().length <= 2)) {
      this.enterSuddenDeath();
    }

    if (this.suddenDeath) {
      for (const isl of this.islands) {
        if (isl.final) {
          isl.targetR = Math.max(FINAL_R, isl.targetR - dt * 7); // close in steadily
        } else {
          isl.phase = "sinking";
          isl.targetR = 0;
        }
      }
    } else {
      for (const isl of this.islands) {
        if (isl.phase === "rising") {
          isl.targetR = isl.maxR;
          if (isl.r >= isl.maxR - 4) {
            isl.phase = "stable";
            isl.timer = 6 + this.ctx.rng() * 6; // hold longer before sinking
          }
        } else if (isl.phase === "stable") {
          isl.timer -= dt;
          if (isl.timer <= 0) {
            isl.phase = "sinking";
            isl.targetR = 0;
            this.boom("ring", isl.x, isl.y, { color: "#ff6d00", scale: isl.maxR / 90 });
          }
        } else {
          isl.targetR = 0;
        }
      }

      // keep enough islands afloat; the desired count eases down only gently so
      // there's always somewhere to hop (islands no longer vanish faster than you
      // can cross). Spawn replacements promptly.
      const desired = Math.max(3, Math.round(5 - (t / TIME_CAP) * 2)); // 5 -> 3
      const afloat = this.islands.filter((i) => i.phase !== "sinking").length;
      this.spawnTimer -= dt;
      if (afloat < desired && this.spawnTimer <= 0) {
        this.spawnTimer = 0.6 + this.ctx.rng() * 1.0;
        const shrink = 1 - 0.28 * (t / TIME_CAP); // late islands run a bit smaller
        const maxR = (R_SMALL + this.ctx.rng() * (R_LARGE - R_SMALL)) * shrink;
        this.spawnIsland(maxR);
      }
    }

    // ease every radius toward its target — sinking eases SLOWER so an island
    // fades out gradually (it used to vanish too fast to react), then drop the
    // fully-sunken ones.
    for (const isl of this.islands) {
      const speed = isl.phase === "sinking" ? 1.6 : 3;
      isl.r += (isl.targetR - isl.r) * Math.min(1, dt * speed);
    }
    this.islands = this.islands.filter((i) => i.final || !(i.phase === "sinking" && i.r < 3));
  }

  private enterSuddenDeath(): void {
    this.suddenDeath = true;
    // the last stand is whichever island currently holds the most blobs (ties to
    // the biggest), so the crowd doesn't get rug-pulled off solid ground
    let best: Island | null = null;
    let bestScore = -1;
    for (const isl of this.islands) {
      const occ = this.aliveActors().filter((a) => dist(a.x, a.y, isl.x, isl.y) <= isl.r).length;
      const score = occ * 10000 + isl.r;
      if (score > bestScore) {
        bestScore = score;
        best = isl;
      }
    }
    if (!best) best = this.spawnIsland(R_LARGE * 0.8, { x: this.cx, y: this.cy });
    best.final = true;
    best.phase = "stable";
    best.targetR = Math.max(FINAL_R, Math.min(best.maxR, 140));
    this.ctx.toast("⚠️ SUDDEN DEATH — one island left. Fight for it!", "bad");
  }

  private spawnIsland(maxR: number, at?: { x: number; y: number }): Island {
    const pos = at ?? this.pickSpot(maxR);
    const isl: Island = {
      id: this.islandSeq++,
      x: pos.x,
      y: pos.y,
      r: 6,
      targetR: maxR,
      maxR,
      phase: "rising",
      timer: 0,
    };
    this.islands.push(isl);
    this.boom("ring", isl.x, isl.y, { color: "#80d8ff", scale: maxR / 90 });
    return isl;
  }

  // find a spot for a new island: within the walls and a hop-able gap from the
  // others (not so close it overlaps, not so far you can't cross before you burn)
  private pickSpot(maxR: number): { x: number; y: number } {
    const margin = maxR + 24;
    let best = { x: this.cx, y: this.cy };
    let bestGap = -Infinity;
    for (let tries = 0; tries < 16; tries++) {
      const x = margin + this.ctx.rng() * (ARENA_W - 2 * margin);
      const y = margin + this.ctx.rng() * (ARENA_H - 2 * margin);
      let gap = Infinity;
      for (const isl of this.islands) gap = Math.min(gap, dist(x, y, isl.x, isl.y) - isl.maxR - maxR);
      if (gap === Infinity) return { x, y };
      if (gap > 40 && gap < 230) return { x, y }; // close enough to hop, far enough to read
      if (gap > bestGap) {
        bestGap = gap;
        best = { x, y };
      }
    }
    return best;
  }

  // gentle body collisions so blobs can shove rivals toward the lava
  private separate(): void {
    const alive = this.aliveActors();
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        const rr = PLAYER_RADIUS * a.scale + PLAYER_RADIUS * b.scale;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d < rr) {
          const overlap = (rr - d) / 2;
          const nx = dx / d;
          const ny = dy / d;
          // heavier (giant) blobs get pushed less; tiny blobs get shoved more.
          // A punchier shove (3.4×) so ramming a rival actually launches them —
          // it used to be a feeble nudge that barely moved anyone toward the lava.
          const wa = b.scale / (a.scale + b.scale);
          const wb = a.scale / (a.scale + b.scale);
          const PUSH = 3.4;
          a.x -= nx * overlap * PUSH * wa;
          a.y -= ny * overlap * PUSH * wa;
          b.x += nx * overlap * PUSH * wb;
          b.y += ny * overlap * PUSH * wb;
          // a little spark on a solid collision so the shove reads as intentional
          if (overlap > 6) this.boom("spark", (a.x + b.x) / 2, (a.y + b.y) / 2, { color: "#ffd54f" });
        }
      }
    }
  }

  private lava(dt: number): void {
    for (const a of this.aliveActors()) {
      const inLava = !this.islandUnder(a);
      a.burning = inLava;
      if (inLava) {
        a.data!.burnT = (a.data!.burnT || 0) + dt;
        if ((a.data!.burnT || 0) >= BURN_GRACE) {
          if (a.shield) {
            a.shield = false;
            a.data!.burnT = 0;
            this.boom("shockwave", a.x, a.y, { color: "#80d8ff" });
          } else if (this.aliveActors().length <= 1) {
            // the lava won't take the last blob standing — someone wears the crown
            a.data!.burnT = BURN_GRACE * 0.5;
          } else {
            a.alive = false;
            a.anim = "dead";
            a.burning = false;
            this.elimOrder.push({ id: a.id, note: "Lava'd!" });
            this.boom("death", a.x, a.y, { color: "#ff3d00" });
            this.boom("splat", a.x, a.y, { color: "#ff6d00" });
          }
        }
      } else {
        a.data!.burnT = Math.max(0, (a.data!.burnT || 0) - dt * 1.5);
      }
    }
  }

  // the crown goes to whoever is most snugly centered on an island (a tiebreaker
  // for the final ranking, and a fun thing to chase)
  private crown(dt: number): void {
    let king: ArenaActor | null = null;
    let bd = Infinity;
    for (const a of this.aliveActors()) {
      const isl = this.islandUnder(a);
      if (!isl) continue;
      const d = dist(a.x, a.y, isl.x, isl.y);
      if (d < bd) {
        bd = d;
        king = a;
      }
    }
    this.kingId = king ? king.id : null;
    if (king) king.data!.kingT = (king.data!.kingT || 0) + dt;
  }

  // pick the safest island to head for: stay put if we're solidly on a non-sinking
  // one, else hop to the nearest island that isn't a doomed sliver
  private nearestIsland(a: ArenaActor, exclude: Island | null): Island | null {
    let best: Island | null = null;
    let bd = Infinity;
    for (const isl of this.islands) {
      if (isl === exclude) continue;
      if (isl.phase === "sinking" && isl.r < PLAYER_RADIUS) continue;
      const d = dist(a.x, a.y, isl.x, isl.y) - isl.r;
      if (d < bd) {
        bd = d;
        best = isl;
      }
    }
    return best;
  }

  private botThink(a: ArenaActor): void {
    const here = this.islandUnder(a);
    const safeHere = here && here.phase !== "sinking" && here.r > PLAYER_RADIUS * 1.4;
    const target = safeHere ? here : this.nearestIsland(a, here) || here;

    let wx = 0;
    let wy = 0;
    if (target) {
      const d = dist(a.x, a.y, target.x, target.y) || 1;
      // hustle toward an island we're off; once on it, just hug the center
      const pull = d > target.r ? 1 : 0.3;
      wx += ((target.x - a.x) / d) * pull;
      wy += ((target.y - a.y) / d) * pull;
    }

    // grab a nearby powerup if it's close
    let pk: { x: number; y: number } | null = null;
    let pd = 240;
    for (const p of this.powerups.pickups) {
      const dpk = dist(a.x, a.y, p.x, p.y);
      if (dpk < pd) {
        pd = dpk;
        pk = p;
      }
    }
    if (pk && this.ctx.rng() < 0.5) {
      wx += ((pk.x - a.x) / (pd || 1)) * 0.6;
      wy += ((pk.y - a.y) / (pd || 1)) * 0.6;
    }

    // when we share an island with a rival, give the nearest one a shove
    if (here && this.ctx.rng() < 0.3) {
      let foe: ArenaActor | null = null;
      let fd = 110;
      for (const o of this.aliveActors()) {
        if (o === a) continue;
        const od = dist(a.x, a.y, o.x, o.y);
        if (od < fd) {
          fd = od;
          foe = o;
        }
      }
      if (foe) {
        wx += ((foe.x - a.x) / (fd || 1)) * 0.8;
        wy += ((foe.y - a.y) / (fd || 1)) * 0.8;
      }
    }

    const m = Math.hypot(wx, wy) || 1;
    a.inDx = wx / m;
    a.inDy = wy / m;
  }

  snapshot(now: number): Snapshot {
    return {
      game: this.id,
      t: now,
      actors: [...this.actors.values()].map((a) => this.toActor(a)),
      data: {
        islands: this.islands.map((i) => ({
          x: Math.round(i.x),
          y: Math.round(i.y),
          r: Math.round(i.r),
          final: i.final || undefined,
        })),
        timeLeft: Math.max(0, TIME_CAP - this.elapsed),
        kingId: this.kingId,
        alive: this.aliveActors().length,
        night: this.ctx.night,
        pickups: this.powerups.snapshot(),
      },
      fx: this.drainFx(),
    };
  }

  result(): MinigameResult {
    // ranked best-first by time spent crowned on an island; the finale crowns the
    // most decisive island-holder if the buzzer caught more than one still hopping
    const ranked = this.aliveActors().sort((a, b) => (b.data!.kingT || 0) - (a.data!.kingT || 0));
    return crownOne(
      ranked.map((a) => a.id),
      this.elimOrder,
      this.ctx.forceSingleSurvivor,
      "Ran out of ground",
    );
  }
}
