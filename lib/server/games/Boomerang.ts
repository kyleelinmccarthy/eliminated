import { ArenaGame, type GameContext, type ArenaActor, type MinigameResult } from "./Minigame";
import type { GameId, Snapshot } from "../../shared/types";
import { ARENA_W, ARENA_H, PLAYER_RADIUS } from "../../shared/constants";
import { dist, clamp } from "../../shared/util";
import type { GameInput } from "../../shared/protocol";

type Power = "speed" | "bigrang" | "multishot" | "shield" | "tiny" | "magnet";
const POWERS: Power[] = ["speed", "bigrang", "multishot", "shield", "tiny", "magnet"];

interface Rang {
  id: number;
  owner: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  returning: boolean;
  spin: number;
  curve: number;
  hitR: number;
  magnet: boolean;
}

interface Pickup {
  id: number;
  kind: Power;
  x: number;
  y: number;
  bob: number;
}

const THROW_SPEED = 540;
const RANG_LIFE = 2.4;
const CATCH_R = 36;
const BASE_HIT_R = 15;
const DASH_DUR = 0.18;
const DASH_CD = 1.4;
const DASH_SPEED = 3.1;
const TIME_LIMIT = 50;
const MIN_PLAY = 12; // keep the brawl going at least this long before the target ends it

export class Boomerang extends ArenaGame {
  id: GameId = "boomerang";
  private rangs: Rang[] = [];
  private pickups: Pickup[] = [];
  private nextId = 1;
  private spawnTimer = 1.5;
  private startCount = 0;
  private target = 1;
  private elimOrder: { id: string; note?: string }[] = [];

  start(): void {
    const ps = this.ctx.players;
    this.startCount = ps.length;
    // survivors target scales with series intensity (keep more alive early)
    this.target = Math.max(1, Math.round(ps.length * (1 - 0.5 * this.ctx.intensity)));
    ps.forEach((p, i) => {
      const ang = (i / ps.length) * Math.PI * 2;
      const a = this.addActor(
        p,
        ARENA_W / 2 + Math.cos(ang) * 320,
        ARENA_H / 2 + Math.sin(ang) * 220,
      );
      a.data!.aim = ang + Math.PI;
      a.data!.dashCd = 0;
      a.data!.dashT = 0;
      a.data!.invuln = 0;
      a.data!.kills = 0;
      a.data!.rangs = 0; // active rang count
      a.data!.maxRangs = 1;
      a.data!.speedMul = 1;
      a.data!.botCd = this.ctx.rng();
    });
    this.ctx.toast("Last blob standing wins. Grab powerups. Trust no one.", "info");
  }

  protected onAction(a: ArenaActor, input: GameInput): void {
    if (input.kind === "aim") {
      a.data!.aim = input.angle;
    } else if (input.kind === "action") {
      if (input.name === "throw") a.data!.wantThrow = 1;
      else if (input.name === "dash") a.data!.wantDash = 1;
    }
  }

  private aliveActors() {
    return [...this.actors.values()].filter((a) => a.alive);
  }

  private doThrow(a: ArenaActor) {
    if ((a.data!.rangs || 0) >= (a.data!.maxRangs || 1)) return;
    const ang = a.data!.aim ?? a.facing;
    const big = (a.data!.bigT || 0) > 0;
    const r: Rang = {
      id: this.nextId++,
      owner: a.id,
      x: a.x + Math.cos(ang) * 24,
      y: a.y + Math.sin(ang) * 24,
      vx: Math.cos(ang) * THROW_SPEED,
      vy: Math.sin(ang) * THROW_SPEED,
      t: 0,
      life: RANG_LIFE,
      returning: false,
      spin: 0,
      curve: this.ctx.rng() < 0.5 ? 1 : -1,
      hitR: big ? BASE_HIT_R * 2.1 : BASE_HIT_R,
      magnet: (a.data!.magnetT || 0) > 0,
    };
    this.rangs.push(r);
    a.data!.rangs = (a.data!.rangs || 0) + 1;
    this.boom("spark", r.x, r.y, { color: "#fff59d", scale: 0.6 });
  }

  private doDash(a: ArenaActor) {
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
    a.data!.invuln = Math.max(a.data!.invuln || 0, 0.26);
    this.boom("poof", a.x, a.y, { color: "#b2ebf2" });
  }

  tick(dt: number, _now: number): void {
    this.elapsed += dt;

    // pickup spawns
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.pickups.length < 5) {
      this.spawnTimer = 3.2 + this.ctx.rng() * 2;
      this.pickups.push({
        id: this.nextId++,
        kind: POWERS[Math.floor(this.ctx.rng() * POWERS.length)],
        x: 140 + this.ctx.rng() * (ARENA_W - 280),
        y: 140 + this.ctx.rng() * (ARENA_H - 280),
        bob: this.ctx.rng() * Math.PI * 2,
      });
    }

    // actors
    for (const a of this.actors.values()) {
      if (!a.alive) continue;
      this.updateTimers(a, dt);
      if (a.isBot) this.botThink(a, dt);

      // dash overrides movement
      if ((a.data!.dashT || 0) > 0) {
        a.data!.dashT! -= dt;
        a.inDx = a.data!.dashDx!;
        a.inDy = a.data!.dashDy!;
        this.moveActor(a, dt, DASH_SPEED);
        a.anim = "run";
      } else {
        this.moveActor(a, dt, a.data!.speedMul || 1);
      }
      a.facing = a.data!.aim ?? a.facing;
      a.ghost = (a.data!.invuln || 0) > 0;

      // consume queued actions
      if (a.data!.wantThrow) {
        a.data!.wantThrow = 0;
        this.doThrow(a);
      }
      if (a.data!.wantDash) {
        a.data!.wantDash = 0;
        this.doDash(a);
      }

      // pickups
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const pk = this.pickups[i];
        if (dist(a.x, a.y, pk.x, pk.y) < PLAYER_RADIUS + 18) {
          this.applyPower(a, pk.kind);
          this.pickups.splice(i, 1);
          this.boom("pickup", a.x, a.y - 36, { text: pk.kind.toUpperCase(), color: "#fff" });
          this.boom("spark", pk.x, pk.y, { color: "#ffd54f" });
        }
      }
    }

    // rangs
    for (let i = this.rangs.length - 1; i >= 0; i--) {
      const r = this.rangs[i];
      r.t += dt;
      r.spin += dt * 18;
      const owner = this.actors.get(r.owner);

      if (!r.returning && r.t > r.life * 0.42) r.returning = true;

      if (!r.returning) {
        // arc out, optional magnet toward nearest enemy
        const ang = Math.atan2(r.vy, r.vx) + r.curve * 2.4 * dt;
        let sp = Math.hypot(r.vx, r.vy);
        r.vx = Math.cos(ang) * sp;
        r.vy = Math.sin(ang) * sp;
        if (r.magnet) {
          const tgt = this.nearestEnemy(r.x, r.y, r.owner);
          if (tgt) {
            const da = Math.atan2(tgt.y - r.y, tgt.x - r.x);
            r.vx = lerpAngleVec(r.vx, r.vy, da, sp, 0.06).x;
            r.vy = lerpAngleVec(r.vx, r.vy, da, sp, 0.06).y;
          }
        }
      } else if (owner && owner.alive) {
        const da = Math.atan2(owner.y - r.y, owner.x - r.x);
        const desVx = Math.cos(da) * THROW_SPEED;
        const desVy = Math.sin(da) * THROW_SPEED;
        r.vx += (desVx - r.vx) * 0.14;
        r.vy += (desVy - r.vy) * 0.14;
      }

      r.x += r.vx * dt;
      r.y += r.vy * dt;

      // wall bounce
      if (r.x < 12 || r.x > ARENA_W - 12) {
        r.vx *= -1;
        r.x = clamp(r.x, 12, ARENA_W - 12);
      }
      if (r.y < 12 || r.y > ARENA_H - 12) {
        r.vy *= -1;
        r.y = clamp(r.y, 12, ARENA_H - 12);
      }

      // catch
      if (r.returning && owner && owner.alive && dist(r.x, r.y, owner.x, owner.y) < CATCH_R) {
        this.removeRang(i, r);
        continue;
      }

      // hits
      let hit = false;
      for (const a of this.actors.values()) {
        if (!a.alive || a.id === r.owner) continue;
        if ((a.data!.invuln || 0) > 0) continue;
        const rr = r.hitR + PLAYER_RADIUS * a.scale;
        if (dist(r.x, r.y, a.x, a.y) < rr) {
          if (a.shield || (a.data!.shieldOn || 0) > 0) {
            a.shield = false;
            a.data!.shieldOn = 0;
            this.boom("shockwave", a.x, a.y, { color: "#80d8ff" });
            hit = true;
            break;
          }
          this.kill(a, r.owner);
          hit = true;
          break;
        }
      }
      if (hit) {
        this.removeRang(i, r);
        continue;
      }

      if (r.t >= r.life) this.removeRang(i, r);
    }

    // pickup bob
    for (const pk of this.pickups) pk.bob += dt * 4;

    // end conditions
    const alive = this.aliveActors();
    if ((alive.length <= this.target && this.elapsed >= MIN_PLAY) || alive.length <= 1 || this.elapsed >= TIME_LIMIT) {
      this.done = true;
    }
  }

  private removeRang(i: number, r: Rang) {
    this.rangs.splice(i, 1);
    const o = this.actors.get(r.owner);
    if (o) o.data!.rangs = Math.max(0, (o.data!.rangs || 1) - 1);
  }

  private kill(a: ArenaActor, killerId: string) {
    a.alive = false;
    a.anim = "dead";
    this.elimOrder.push({ id: a.id, note: "Caught a boomerang" });
    const killer = this.actors.get(killerId);
    if (killer) killer.data!.kills = (killer.data!.kills || 0) + 1;
    this.boom("death", a.x, a.y, { color: "#ff1744" });
    this.boom("splat", a.x, a.y, { color: "#e53935" });
    // drop any active powerup as a fun bonus
  }

  private applyPower(a: ArenaActor, kind: Power) {
    const d = a.data!;
    switch (kind) {
      case "speed":
        d.speedMul = 1.6;
        d.speedT = 8;
        break;
      case "bigrang":
        d.bigT = 10;
        break;
      case "multishot":
        d.maxRangs = 3;
        d.multiT = 10;
        break;
      case "shield":
        a.shield = true;
        d.shieldOn = 1;
        break;
      case "tiny":
        a.scale = 0.62;
        d.tinyT = 10;
        break;
      case "magnet":
        d.magnetT = 10;
        break;
    }
  }

  private updateTimers(a: ArenaActor, dt: number) {
    const d = a.data!;
    if ((d.dashCd || 0) > 0) d.dashCd = Math.max(0, d.dashCd! - dt);
    if ((d.invuln || 0) > 0) d.invuln = Math.max(0, d.invuln! - dt);
    if ((d.speedT || 0) > 0) {
      d.speedT! -= dt;
      if (d.speedT! <= 0) d.speedMul = 1;
    }
    if ((d.bigT || 0) > 0) d.bigT! -= dt;
    if ((d.magnetT || 0) > 0) d.magnetT! -= dt;
    if ((d.multiT || 0) > 0) {
      d.multiT! -= dt;
      if (d.multiT! <= 0) d.maxRangs = 1;
    }
    if ((d.tinyT || 0) > 0) {
      d.tinyT! -= dt;
      if (d.tinyT! <= 0) a.scale = 1;
    }
  }

  private nearestEnemy(x: number, y: number, ownerId: string): ArenaActor | null {
    let best: ArenaActor | null = null;
    let bd = Infinity;
    for (const a of this.actors.values()) {
      if (!a.alive || a.id === ownerId) continue;
      const d = dist(x, y, a.x, a.y);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  private botThink(a: ArenaActor, dt: number) {
    const d = a.data!;
    const enemy = this.nearestEnemy(a.x, a.y, a.id);

    // dodge: find incoming rang heading toward us
    let danger: Rang | null = null;
    let dgd = Infinity;
    for (const r of this.rangs) {
      if (r.owner === a.id) continue;
      const dd = dist(r.x, r.y, a.x, a.y);
      const heading = (r.x - a.x) * r.vx + (r.y - a.y) * r.vy < 0; // moving toward us
      if (dd < 150 && heading && dd < dgd) {
        dgd = dd;
        danger = r;
      }
    }

    if (danger) {
      // strafe perpendicular to the rang velocity, dash if very close
      const perp = Math.atan2(danger.vy, danger.vx) + Math.PI / 2;
      const side = ((a.x * 13 + a.y * 7) | 0) % 2 === 0 ? 1 : -1;
      a.inDx = Math.cos(perp) * side;
      a.inDy = Math.sin(perp) * side;
      if (dgd < 70 && (d.dashCd || 0) === 0 && this.ctx.rng() < 0.6) d.wantDash = 1;
    } else if (enemy) {
      // seek a nearby powerup if very close & convenient
      let pk: Pickup | null = null;
      let pkd = 260;
      for (const p of this.pickups) {
        const pd = dist(a.x, a.y, p.x, p.y);
        if (pd < pkd) {
          pkd = pd;
          pk = p;
        }
      }
      if (pk && this.ctx.rng() < 0.7) {
        a.inDx = Math.sign(pk.x - a.x) * Math.min(1, Math.abs(pk.x - a.x) / 50);
        a.inDy = Math.sign(pk.y - a.y) * Math.min(1, Math.abs(pk.y - a.y) / 50);
      } else {
        // keep mid-range distance from enemy
        const de = dist(a.x, a.y, enemy.x, enemy.y);
        const want = 260;
        const dir = de < want ? -1 : 1;
        a.inDx = Math.sign(enemy.x - a.x) * dir * 0.7 + Math.sin(this.elapsed + a.y) * 0.3;
        a.inDy = Math.sign(enemy.y - a.y) * dir * 0.7 + Math.cos(this.elapsed + a.x) * 0.3;
      }
      // aim at enemy with lead + error
      const lead = 0.18;
      const tx = enemy.x + enemy.vx * lead;
      const ty = enemy.y + enemy.vy * lead;
      const err = (this.ctx.rng() - 0.5) * 0.4;
      d.aim = Math.atan2(ty - a.y, tx - a.x) + err;
      // throw on cadence when roughly aimed and rang available
      d.botCd = (d.botCd || 0) - dt;
      if (d.botCd! <= 0 && (d.rangs || 0) < (d.maxRangs || 1)) {
        d.botCd = 0.7 + this.ctx.rng() * 1.1;
        if (dist(a.x, a.y, enemy.x, enemy.y) < 620) d.wantThrow = 1;
      }
    } else {
      a.inDx = Math.sin(this.elapsed) * 0.4;
      a.inDy = Math.cos(this.elapsed) * 0.4;
    }
  }

  snapshot(now: number): Snapshot {
    return {
      game: this.id,
      t: now,
      actors: [...this.actors.values()].map((a) => this.toActor(a)),
      data: {
        timeLeft: Math.max(0, TIME_LIMIT - this.elapsed),
        alive: this.aliveActors().length,
        target: this.target,
        night: this.ctx.night,
        rangs: this.rangs.map((r) => ({
          id: r.id,
          x: Math.round(r.x),
          y: Math.round(r.y),
          spin: +r.spin.toFixed(2),
          big: r.hitR > BASE_HIT_R * 1.5,
          owner: r.owner,
        })),
        pickups: this.pickups.map((p) => ({ id: p.id, kind: p.kind, x: p.x, y: p.y, bob: +p.bob.toFixed(2) })),
      },
      fx: this.drainFx(),
    };
  }

  result(): MinigameResult {
    const survivors = this.aliveActors();
    survivors.sort((a, b) => (b.data!.kills || 0) - (a.data!.kills || 0));
    const ranking: MinigameResult["ranking"] = [];
    let place = 1;
    for (const a of survivors) ranking.push({ playerId: a.id, survived: true, placement: place++ });
    for (const e of [...this.elimOrder].reverse())
      ranking.push({ playerId: e.id, survived: false, placement: place++, note: e.note });
    return { survivorIds: survivors.map((a) => a.id), ranking };
  }
}

function lerpAngleVec(vx: number, vy: number, targetAng: number, sp: number, t: number) {
  const cur = Math.atan2(vy, vx);
  let diff = targetAng - cur;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const na = cur + diff * t;
  return { x: Math.cos(na) * sp, y: Math.sin(na) * sp };
}
