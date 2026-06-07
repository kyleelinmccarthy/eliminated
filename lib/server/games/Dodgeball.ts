// Dodgeball. Two teams, split by a center line. Grab a ball, hurl it across;
// any enemy it hits (no shield, not mid-dodge) is out. Dash for a brief dodge.
// Reuses the Boomerang feel (aim/throw/dash + dodge AI) on a team layout.

import { ArenaGame, type GameContext, type ArenaActor, type MinigameResult, buildRanking } from "./Minigame";
import type { GameId, Snapshot } from "../../shared/types";
import type { GameInput } from "../../shared/protocol";
import { ARENA_W, ARENA_H, PLAYER_RADIUS } from "../../shared/constants";
import { dist, clamp, shuffle } from "../../shared/util";
import { PowerupField } from "./Powerups";

interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: "ground" | "held" | "flight";
  holder?: string;
  team?: number; // thrower's team while in flight
  t: number;
}

const TIME_LIMIT = 45;
const BALL_SPEED = 640;
const BALL_HIT_R = 15;
const BALL_LIFE = 1.7;
const DASH_DUR = 0.18;
const DASH_CD = 1.3;
const DASH_SPEED = 3.0;
const DIV_PAD = 8;

export class Dodgeball extends ArenaGame {
  id: GameId = "dodgeball";
  private balls: Ball[] = [];
  private nextId = 1;
  private powerups: PowerupField;
  private elimOrder: { id: string; note?: string }[] = [];
  private get mid() {
    return ARENA_W / 2;
  }

  constructor(ctx: GameContext) {
    super(ctx);
    this.powerups = new PowerupField(ctx.rng, { every: 3, max: 5, goodWeight: 0.58 });
  }

  start(): void {
    const ps = shuffle(this.ctx.rng, this.ctx.players);
    ps.forEach((p, i) => {
      const team = i % 2;
      const x = team === 0 ? ARENA_W * 0.25 : ARENA_W * 0.75;
      const a = this.addActor(p, x + (this.ctx.rng() - 0.5) * 120, 140 + this.ctx.rng() * (ARENA_H - 280));
      a.team = team;
      a.facing = team === 0 ? 0 : Math.PI;
      a.data!.aim = a.facing;
      a.data!.dashCd = 0;
      a.data!.dashT = 0;
      a.data!.invuln = 0;
      a.data!.botCd = this.ctx.rng();
    });
    const n = Math.max(3, Math.ceil(ps.length / 2));
    for (let i = 0; i < n; i++) {
      this.balls.push({
        id: this.nextId++,
        x: this.mid,
        y: (ARENA_H * (i + 1)) / (n + 1),
        vx: 0,
        vy: 0,
        state: "ground",
        t: 0,
      });
    }
    this.ctx.toast("Grab a ball — peg the other team, it's cheaper than therapy!", "info");
  }

  protected onAction(a: ArenaActor, input: GameInput): void {
    if (input.kind === "aim") a.data!.aim = input.angle;
    else if (input.kind === "action") {
      if (input.name === "throw") a.data!.wantThrow = 1;
      else if (input.name === "dash") a.data!.wantDash = 1;
    }
  }

  private aliveActors() {
    return [...this.actors.values()].filter((a) => a.alive);
  }

  private clampSide(a: ArenaActor): void {
    const r = PLAYER_RADIUS * a.scale;
    if (a.team === 0) a.x = clamp(a.x, r, this.mid - DIV_PAD - r);
    else a.x = clamp(a.x, this.mid + DIV_PAD + r, ARENA_W - r);
  }

  private heldBall(id: string): Ball | undefined {
    return this.balls.find((b) => b.state === "held" && b.holder === id);
  }

  private doThrow(a: ArenaActor): void {
    const b = this.heldBall(a.id);
    if (!b) return;
    const ang = a.data!.aim ?? a.facing;
    b.state = "flight";
    b.vx = Math.cos(ang) * BALL_SPEED;
    b.vy = Math.sin(ang) * BALL_SPEED;
    b.team = a.team;
    b.t = 0;
    b.holder = undefined;
    a.carrying = undefined;
    this.boom("spark", b.x, b.y, { color: "#fff59d", scale: 0.6 });
  }

  private doDash(a: ArenaActor): void {
    if ((a.data!.dashCd || 0) > 0 || (a.data!.dashT || 0) > 0) return;
    let dx = a.inDx;
    let dy = a.inDy;
    if (Math.hypot(dx, dy) < 0.1) {
      const ang = a.data!.aim ?? a.facing;
      dx = Math.cos(ang);
      dy = Math.sin(ang);
    }
    const m = Math.hypot(dx, dy) || 1;
    a.data!.dashDx = dx / m;
    a.data!.dashDy = dy / m;
    a.data!.dashT = DASH_DUR;
    a.data!.dashCd = DASH_CD;
    a.data!.invuln = Math.max(a.data!.invuln || 0, 0.3);
    this.boom("poof", a.x, a.y, { color: "#b2ebf2" });
  }

  tick(dt: number, _now: number): void {
    this.elapsed += dt;
    this.powerups.tick(dt);

    for (const a of this.actors.values()) {
      if (!a.alive) continue;
      this.updateStatus(a, dt);
      if ((a.data!.dashCd || 0) > 0) a.data!.dashCd = Math.max(0, a.data!.dashCd - dt);
      if ((a.data!.invuln || 0) > 0) a.data!.invuln = Math.max(0, a.data!.invuln - dt);
      if (a.isBot) this.botThink(a, dt);

      if ((a.data!.dashT || 0) > 0) {
        a.data!.dashT -= dt;
        a.inDx = a.data!.dashDx!;
        a.inDy = a.data!.dashDy!;
        this.moveActor(a, dt, DASH_SPEED);
        a.anim = "run";
      } else {
        this.moveActor(a, dt);
      }
      this.clampSide(a);
      a.ghost = (a.data!.invuln || 0) > 0;
      a.facing = a.data!.aim ?? a.facing;

      if (a.data!.wantThrow) {
        a.data!.wantThrow = 0;
        this.doThrow(a);
      }
      if (a.data!.wantDash) {
        a.data!.wantDash = 0;
        this.doDash(a);
      }

      // pick up a ground ball if empty-handed
      if (!a.carrying) {
        for (const b of this.balls) {
          if (b.state !== "ground") continue;
          if (dist(a.x, a.y, b.x, b.y) < PLAYER_RADIUS * a.scale + 16) {
            b.state = "held";
            b.holder = a.id;
            a.carrying = "ball";
            break;
          }
        }
      }
      // powerups
      this.powerups.collect(a);
    }

    // held balls follow their holder (held just in front)
    for (const b of this.balls) {
      if (b.state !== "held" || !b.holder) continue;
      const h = this.actors.get(b.holder);
      if (!h || !h.alive) {
        b.state = "ground";
        b.holder = undefined;
        continue;
      }
      const ang = h.data!.aim ?? h.facing;
      b.x = h.x + Math.cos(ang) * 26;
      b.y = h.y + Math.sin(ang) * 26;
    }

    // flight balls
    for (const b of this.balls) {
      if (b.state !== "flight") continue;
      b.t += dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      // walls -> drop
      if (b.x < 14 || b.x > ARENA_W - 14 || b.y < 14 || b.y > ARENA_H - 14 || b.t > BALL_LIFE) {
        b.x = clamp(b.x, 16, ARENA_W - 16);
        b.y = clamp(b.y, 16, ARENA_H - 16);
        this.dropBall(b);
        continue;
      }
      // hits
      for (const a of this.aliveActors()) {
        if (a.team === b.team) continue;
        if ((a.data!.invuln || 0) > 0) continue;
        if (dist(b.x, b.y, a.x, a.y) < BALL_HIT_R + PLAYER_RADIUS * a.scale) {
          if (a.shield) {
            a.shield = false;
            this.boom("shockwave", a.x, a.y, { color: "#80d8ff" });
          } else {
            this.eliminate(a);
          }
          this.dropBall(b);
          break;
        }
      }
    }

    // end conditions
    const t0 = this.aliveActors().filter((a) => a.team === 0).length;
    const t1 = this.aliveActors().filter((a) => a.team === 1).length;
    if (t0 === 0 || t1 === 0 || this.elapsed >= TIME_LIMIT) this.done = true;
  }

  private dropBall(b: Ball): void {
    b.state = "ground";
    b.vx = 0;
    b.vy = 0;
    b.team = undefined;
    b.holder = undefined;
    b.t = 0;
  }

  private eliminate(a: ArenaActor): void {
    a.alive = false;
    a.anim = "dead";
    if (a.carrying) {
      const held = this.heldBall(a.id);
      if (held) this.dropBall(held);
      a.carrying = undefined;
    }
    this.elimOrder.push({ id: a.id, note: "Pegged out!" });
    this.boom("death", a.x, a.y, { color: "#ff1744" });
    this.boom("splat", a.x, a.y, { color: "#ff7043" });
  }

  private nearestEnemy(a: ArenaActor): ArenaActor | null {
    let best: ArenaActor | null = null;
    let bd = Infinity;
    for (const o of this.aliveActors()) {
      if (o.team === a.team || o === a) continue;
      const d = dist(a.x, a.y, o.x, o.y);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  private botThink(a: ArenaActor, dt: number): void {
    const d = a.data!;
    // dodge an incoming enemy flight ball
    let danger: Ball | null = null;
    let dgd = Infinity;
    for (const b of this.balls) {
      if (b.state !== "flight" || b.team === a.team) continue;
      const dd = dist(b.x, b.y, a.x, a.y);
      const toward = (b.x - a.x) * b.vx + (b.y - a.y) * b.vy < 0;
      if (dd < 170 && toward && dd < dgd) {
        dgd = dd;
        danger = b;
      }
    }
    if (danger) {
      const perp = Math.atan2(danger.vy, danger.vx) + Math.PI / 2;
      const side = ((a.x * 13 + a.y * 7) | 0) % 2 === 0 ? 1 : -1;
      a.inDx = Math.cos(perp) * side;
      a.inDy = Math.sin(perp) * side;
      if (dgd < 80 && (d.dashCd || 0) === 0 && this.ctx.rng() < 0.6) d.wantDash = 1;
      return;
    }
    if (a.carrying) {
      const enemy = this.nearestEnemy(a);
      if (enemy) {
        const lead = 0.16;
        const tx = enemy.x + enemy.vx * lead;
        const ty = enemy.y + enemy.vy * lead;
        d.aim = Math.atan2(ty - a.y, tx - a.x) + (this.ctx.rng() - 0.5) * 0.35;
        d.botCd = (d.botCd || 0) - dt;
        if (d.botCd <= 0) {
          d.botCd = 0.5 + this.ctx.rng() * 0.9;
          d.wantThrow = 1;
        }
        // hold near the line, shimmy
        a.inDx = (a.team === 0 ? 1 : -1) * 0.3 + Math.sin(this.elapsed + a.y) * 0.3;
        a.inDy = Math.cos(this.elapsed + a.x) * 0.4;
      }
      return;
    }
    // empty-handed: fetch nearest reachable ground ball
    let best: Ball | null = null;
    let bd = Infinity;
    for (const b of this.balls) {
      if (b.state !== "ground") continue;
      const onSide = a.team === 0 ? b.x <= this.mid : b.x >= this.mid;
      if (!onSide) continue;
      const dd = dist(a.x, a.y, b.x, b.y);
      if (dd < bd) {
        bd = dd;
        best = b;
      }
    }
    if (best) {
      const dx = best.x - a.x;
      const dy = best.y - a.y;
      const m = Math.hypot(dx, dy) || 1;
      a.inDx = dx / m;
      a.inDy = dy / m;
    } else {
      // wait near the line
      const tx = a.team === 0 ? this.mid - 120 : this.mid + 120;
      a.inDx = Math.sign(tx - a.x) * 0.5;
      a.inDy = Math.sin(this.elapsed + a.x) * 0.4;
    }
  }

  snapshot(now: number): Snapshot {
    const t0 = this.aliveActors().filter((a) => a.team === 0).length;
    const t1 = this.aliveActors().filter((a) => a.team === 1).length;
    return {
      game: this.id,
      t: now,
      actors: [...this.actors.values()].map((a) => this.toActor(a)),
      data: {
        timeLeft: Math.max(0, TIME_LIMIT - this.elapsed),
        mid: this.mid,
        teamCounts: [t0, t1],
        balls: this.balls.map((b) => ({ id: b.id, x: Math.round(b.x), y: Math.round(b.y), state: b.state })),
        night: this.ctx.night,
        pickups: this.powerups.snapshot(),
      },
      fx: this.drainFx(),
    };
  }

  result(): MinigameResult {
    // survivors ranked by team size then arbitrary; eliminated by reverse order
    const survivors = this.aliveActors();
    survivors.sort((a, b) => {
      const aw = this.aliveActors().filter((x) => x.team === a.team).length;
      const bw = this.aliveActors().filter((x) => x.team === b.team).length;
      return bw - aw;
    });
    return {
      survivorIds: survivors.map((a) => a.id),
      ranking: buildRanking(
        survivors.map((a) => a.id),
        this.elimOrder,
      ),
    };
  }
}
