// King of the Lava Islands — the series FINALE. The floor is lava; a scattering
// of islands of various sizes rises, holds, then SINKS back into the magma. You
// have to hop from island to island to stay off the floor, scramble for powerups
// (a shield is gold), and shove rivals into the lava. As the round wears on the
// islands get scarcer and smaller, then it collapses to one shrinking last-stand
// island. Last blob not-on-fire is champion. Decisive by design.

import { ArenaGame, crownOne, type GameContext, type ArenaActor, type MinigameResult } from "./Minigame";
import type { GameId, Snapshot } from "../../shared/types";
import type { GameInput } from "../../shared/protocol";
import { ARENA_W, ARENA_H, PLAYER_RADIUS } from "../../shared/constants";
import { dist, clamp } from "../../shared/util";
import { PowerupField } from "./Powerups";

const TIME_CAP = 60;
const BURN_GRACE = 0.95; // seconds standing in lava before you burn out

// --- SHOVE: the active "attack" (mouse-aim + click, or SPACE / button). It was
// never obvious you could bump people out by just walking into them, so the
// real way to launch a rival into the magma is a deliberate forward shove: a
// brief self-lunge plus a hard knockback to anyone in the cone in front of you.
const SHOVE_CD = 0.6; // seconds between shoves
const SHOVE_LUNGE_DUR = 0.12; // brief self-lunge so the attack has weight
const SHOVE_LUNGE_SPEED = 2.6; // moveActor speed multiplier during the lunge
const SHOVE_RANGE = 66; // reach in FRONT, on top of both blobs' radii
const SHOVE_ARC_COS = 0.32; // ~±71° cone — generous, you don't need pixel aim
const SHOVE_IMPULSE = 380; // base knockback velocity (×2 for evenly-matched blobs)
const KB_DECAY = 4.2; // knockback velocity falloff (higher = shorter launch)
// Opening grace: for the first stretch of the round the starting islands hold
// firm and sudden death CAN'T begin — so players get a real chance to hop from
// island to island and read the board before anything starts shrinking. Without
// this the finale (often a 1v1) tripped the `alive <= 2` sudden-death trigger on
// the very first tick and collapsed straight to one closing-in island.
const OPENING_GRACE = 14;

// island sizing (arena units)
const R_SMALL = 56;
const R_LARGE = 150;
const FINAL_R = 32; // sudden-death floor — too small to hold a crowd
const SINK_RATE = 45; // units/sec a sinking island's radius recedes (steady & linear, not eased)

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
      emit: (k, x, y, e) => this.boom(k, x, y, e),
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
      // staggered holds so the opening spread STARTS CHANGING early (the first
      // island sinks ~7s in) — a long static opening felt dead — while never all
      // going at once. Sudden death is still gated by OPENING_GRACE further down.
      isl.timer = 7 + this.ctx.rng() * 9; // ~7–16s, staggered, before each starting island sinks
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
    this.ctx.toast("The floor is LAVA! Hop between the sinking islands — aim and CLICK to SHOVE rivals into the magma!", "bad");
  }

  // mouse aim sets our facing; click / SPACE / button fires a shove next tick
  protected onAction(a: ArenaActor, input: GameInput): void {
    if (input.kind === "aim") a.data!.aim = input.angle;
    else if (input.kind === "action" && input.name === "shove") a.data!.wantShove = 1;
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
      if ((a.data!.shoveCd || 0) > 0) a.data!.shoveCd = Math.max(0, a.data!.shoveCd! - dt);
      if (a.isBot) this.botThink(a);

      // fire a queued shove BEFORE moving so the self-lunge starts this very tick
      if (a.data!.wantShove) {
        a.data!.wantShove = 0;
        this.doShove(a);
      }

      // mid-lunge we override the joystick with the locked-in shove direction
      if ((a.data!.shoveT || 0) > 0) {
        a.data!.shoveT! -= dt;
        a.inDx = a.data!.shoveDx!;
        a.inDy = a.data!.shoveDy!;
        this.moveActor(a, dt, SHOVE_LUNGE_SPEED);
        a.anim = "run";
      } else {
        this.moveActor(a, dt);
      }
      // desktop mouse aim drives facing; mobile/keyboard keeps movement facing
      if (a.data!.aim !== undefined) a.facing = a.data!.aim;
      this.applyKnockback(a, dt);
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
    // The opening grace gates BOTH triggers: a small finale field shouldn't drop
    // into sudden death until everyone's had a fair shot at hopping around first.
    if (!this.suddenDeath && t >= OPENING_GRACE && (t >= TIME_CAP * 0.72 || this.aliveActors().length <= 2)) {
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

    // Rising/stable islands EASE toward their target; a SINKING island recedes at
    // a steady LINEAR rate instead. Exponential easing was front-loaded — a big
    // island lost most of its radius in the first half-second, so a blob couldn't
    // cross to a neighbour before the ground vanished out from under it. A constant
    // recede gives the same readable warning whether you're centred or at the edge,
    // and bigger islands (where crowds gather) stay standable proportionally longer.
    for (const isl of this.islands) {
      if (isl.phase === "sinking") {
        isl.r = Math.max(0, isl.r - SINK_RATE * dt);
      } else {
        isl.r += (isl.targetR - isl.r) * Math.min(1, dt * 3);
      }
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

  // The active attack: a forward lunge that LAUNCHES every rival caught in the
  // cone ahead of you. Aimed with the mouse (or your last movement direction on
  // touch). This — not bumping shoulders — is the intended way to make a kill.
  private doShove(a: ArenaActor): void {
    const d = a.data!;
    if ((d.shoveCd || 0) > 0) return; // still cooling down (server is the authority)
    const ang = d.aim ?? a.facing;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    d.shoveDx = dx;
    d.shoveDy = dy;
    d.shoveT = SHOVE_LUNGE_DUR;
    d.shoveCd = SHOVE_CD;
    a.facing = ang;

    let hit = false;
    for (const o of this.aliveActors()) {
      if (o === a) continue;
      const ox = o.x - a.x;
      const oy = o.y - a.y;
      const dd = Math.hypot(ox, oy) || 0.001;
      if (dd > SHOVE_RANGE + PLAYER_RADIUS * (a.scale + o.scale)) continue; // out of reach
      if ((ox / dd) * dx + (oy / dd) * dy < SHOVE_ARC_COS) continue; // not in the front cone
      // launch them straight away from us; heavier blobs take less, tiny ones fly
      const power = SHOVE_IMPULSE * ((a.scale / (a.scale + o.scale)) * 2);
      o.data!.kbX = (o.data!.kbX || 0) + (ox / dd) * power;
      o.data!.kbY = (o.data!.kbY || 0) + (oy / dd) * power;
      o.flash = 1;
      this.boom("spark", o.x, o.y, { color: "#ff8a65" });
      hit = true;
    }
    // the shove "tell": a shockwave + puff in front so the attack always reads
    this.boom("shockwave", a.x + dx * 18, a.y + dy * 18, { color: hit ? "#ff5252" : "#ffd54f" });
    this.boom("poof", a.x + dx * 24, a.y + dy * 24, { color: "#ffffff" });
  }

  // carry a shoved blob along its knockback velocity, easing it out over ~half a
  // second (long enough to skid off an island, short enough to scramble back).
  private applyKnockback(a: ArenaActor, dt: number): void {
    const d = a.data!;
    const kx = d.kbX || 0;
    const ky = d.kbY || 0;
    if (kx === 0 && ky === 0) return;
    a.x += kx * dt;
    a.y += ky * dt;
    const r = PLAYER_RADIUS * a.scale;
    a.x = clamp(a.x, r, ARENA_W - r);
    a.y = clamp(a.y, r, ARENA_H - r);
    const f = Math.max(0, 1 - dt * KB_DECAY);
    d.kbX = kx * f;
    d.kbY = ky * f;
    if (Math.hypot(d.kbX, d.kbY) < 8) {
      d.kbX = 0;
      d.kbY = 0;
    }
  }

  // gentle body collisions so blobs don't stack — the real launches come from
  // doShove now, so this is just light separation (a feeble nudge, by design)
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
          // Just enough to keep blobs from stacking — the real launch comes from
          // the active SHOVE (doShove), so passive contact is only a light nudge.
          const wa = b.scale / (a.scale + b.scale);
          const wb = a.scale / (a.scale + b.scale);
          const PUSH = 1.5;
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

    // hunt the nearest rival: close in, and once they're in range fire an actual
    // SHOVE (the same attack players use) to launch them off toward the lava
    if (here) {
      let foe: ArenaActor | null = null;
      let fd = Infinity;
      for (const o of this.aliveActors()) {
        if (o === a) continue;
        const od = dist(a.x, a.y, o.x, o.y);
        if (od < fd) {
          fd = od;
          foe = o;
        }
      }
      if (foe && fd < 160) {
        wx += ((foe.x - a.x) / (fd || 1)) * 0.8;
        wy += ((foe.y - a.y) / (fd || 1)) * 0.8;
        const reach = SHOVE_RANGE + PLAYER_RADIUS * (a.scale + foe.scale);
        if ((a.data!.shoveCd || 0) <= 0 && fd < reach && this.ctx.rng() < 0.4) {
          a.facing = Math.atan2(foe.y - a.y, foe.x - a.x);
          a.data!.wantShove = 1;
        }
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
