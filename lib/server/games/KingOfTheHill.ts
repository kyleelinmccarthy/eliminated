// King of Lava Island — the series FINALE. A central safe "island" shrinks in
// waves; everything outside is lava. Linger in lava and you burn out. Blobs
// shove each other, scramble for powerups (a shield is gold), and fight for the
// crown. Last blob on the hill is the champion. Decisive by design.

import { ArenaGame, type GameContext, type ArenaActor, type MinigameResult, buildRanking } from "./Minigame";
import type { GameId, Snapshot } from "../../shared/types";
import { ARENA_W, ARENA_H, PLAYER_RADIUS } from "../../shared/constants";
import { dist } from "../../shared/util";
import { PowerupField } from "./Powerups";

const START_R = 330;
const MIN_R = 72;
const FINAL_R = 22; // sudden-death floor — too small to hold a crowd
const NUM_WAVES = 8;
const WAVE_INTERVAL = 4.2;
const BURN_GRACE = 0.85; // seconds in lava before you go
const TIME_CAP = 60;

export class KingOfTheHill extends ArenaGame {
  id: GameId = "koth";
  private cx = ARENA_W / 2;
  private cy = ARENA_H / 2;
  private safeR = START_R;
  private targetR = START_R;
  private waveT = WAVE_INTERVAL;
  private step = (START_R - MIN_R) / NUM_WAVES;
  private suddenDeath = false;
  private kingId: string | null = null;
  private powerups: PowerupField;
  private elimOrder: { id: string; note?: string }[] = [];

  constructor(ctx: GameContext) {
    super(ctx);
    // Spawn powerups *inside the current safe island* (a circle), kept clear of
    // its edge — never out in the lava — and they shrink/cull with it (see tick).
    this.powerups = new PowerupField(ctx.rng, {
      every: 4.5,
      max: 3,
      goodWeight: 0.6,
      margin: 64,
      spawnCircle: () => ({ x: this.cx, y: this.cy, r: this.safeR }),
    });
  }

  start(): void {
    const ps = this.ctx.players;
    ps.forEach((p, i) => {
      const ang = (i / ps.length) * Math.PI * 2;
      const a = this.addActor(p, this.cx + Math.cos(ang) * 150, this.cy + Math.sin(ang) * 130);
      a.data!.burnT = 0;
      a.data!.kingT = 0;
    });
    this.ctx.toast("The floor is LAVA! Hold the island, shove the rest!", "bad");
  }

  private aliveActors() {
    return [...this.actors.values()].filter((a) => a.alive);
  }

  tick(dt: number, _now: number): void {
    this.elapsed += dt;
    this.powerups.tick(dt);

    // shrink the hill in waves, then sudden-death until just one blob remains
    this.waveT -= dt;
    if (this.waveT <= 0 && this.targetR > MIN_R) {
      this.waveT = WAVE_INTERVAL;
      this.targetR = Math.max(MIN_R, this.targetR - this.step);
      this.boom("ring", this.cx, this.cy, { color: "#ff6d00", scale: this.targetR / 90 });
      this.ctx.toast("🌋 The lava rises. So does the rent.", "bad");
    } else if (this.targetR <= MIN_R && this.aliveActors().length > 1) {
      // sudden death: close in relentlessly so the hill can't hold a crowd
      if (!this.suddenDeath) {
        this.suddenDeath = true;
        this.ctx.toast("⚠️ SUDDEN DEATH — the island has had enough of all of you!", "bad");
      }
      this.targetR = Math.max(FINAL_R, this.targetR - dt * 16);
    }
    // ease the visible radius toward the target
    this.safeR += (this.targetR - this.safeR) * Math.min(1, dt * 3);

    // any powerup the lava has now reached is gone — no orbs stranded off-island
    this.powerups.cull((p) => dist(p.x, p.y, this.cx, this.cy) <= this.safeR);

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
          // heavier (giant) blobs get pushed less; tiny blobs get shoved more
          const wa = b.scale / (a.scale + b.scale);
          const wb = a.scale / (a.scale + b.scale);
          a.x -= nx * overlap * 2 * wa;
          a.y -= ny * overlap * 2 * wa;
          b.x += nx * overlap * 2 * wb;
          b.y += ny * overlap * 2 * wb;
        }
      }
    }
  }

  private lava(dt: number): void {
    for (const a of this.aliveActors()) {
      const d = dist(a.x, a.y, this.cx, this.cy);
      const inLava = d > this.safeR;
      a.burning = inLava;
      if (inLava) {
        a.data!.burnT = (a.data!.burnT || 0) + dt;
        if ((a.data!.burnT || 0) >= BURN_GRACE) {
          if (a.shield) {
            a.shield = false;
            a.data!.burnT = 0;
            this.boom("shockwave", a.x, a.y, { color: "#80d8ff" });
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

  private crown(dt: number): void {
    let king: ArenaActor | null = null;
    let bd = Infinity;
    for (const a of this.aliveActors()) {
      const d = dist(a.x, a.y, this.cx, this.cy);
      if (d < bd) {
        bd = d;
        king = a;
      }
    }
    this.kingId = king ? king.id : null;
    if (king) king.data!.kingT = (king.data!.kingT || 0) + dt;
  }

  private botThink(a: ArenaActor): void {
    const d = dist(a.x, a.y, this.cx, this.cy);
    // base drive: head for the center, harder the closer to the edge
    const inward = Math.min(1, d / Math.max(1, this.safeR));
    let dx = (this.cx - a.x) / Math.max(1, d);
    let dy = (this.cy - a.y) / Math.max(1, d);
    let wx = dx * (0.4 + inward * 0.8);
    let wy = dy * (0.4 + inward * 0.8);

    // grab a nearby powerup if it's not deep in lava
    let pk: { x: number; y: number } | null = null;
    let pd = 240;
    for (const p of this.powerups.pickups) {
      const dpk = dist(a.x, a.y, p.x, p.y);
      const pkSafe = dist(p.x, p.y, this.cx, this.cy) < this.safeR + 40;
      if (pkSafe && dpk < pd) {
        pd = dpk;
        pk = p;
      }
    }
    if (pk && this.ctx.rng() < 0.5) {
      wx += ((pk.x - a.x) / (pd || 1)) * 0.7;
      wy += ((pk.y - a.y) / (pd || 1)) * 0.7;
    }

    // occasionally shove a rival who's nearer the edge than we are
    if (this.ctx.rng() < 0.35) {
      let foe: ArenaActor | null = null;
      let fd = 120;
      for (const o of this.aliveActors()) {
        if (o === a) continue;
        const od = dist(a.x, a.y, o.x, o.y);
        if (od < fd && dist(o.x, o.y, this.cx, this.cy) > d) {
          fd = od;
          foe = o;
        }
      }
      if (foe) {
        wx += (foe.x - a.x) / (fd || 1);
        wy += (foe.y - a.y) / (fd || 1);
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
        cx: this.cx,
        cy: this.cy,
        safeR: Math.round(this.safeR),
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
    const survivors = this.aliveActors().sort((a, b) => (b.data!.kingT || 0) - (a.data!.kingT || 0));
    return {
      survivorIds: survivors.map((a) => a.id),
      ranking: buildRanking(
        survivors.map((a) => a.id),
        this.elimOrder,
      ),
    };
  }
}
