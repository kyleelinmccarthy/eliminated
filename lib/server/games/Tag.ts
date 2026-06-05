// Freeze Tag (team edition). Two teams chase each other: touching an enemy
// freezes them solid; touching a frozen teammate thaws them. Thawing keeps the
// elimination count low and forgiving — until the final DEEP FREEZE window, when
// thawing stops and anyone still frozen at the buzzer is eliminated. Replaces
// the old hot-potato tag (clearer, team-based, gentler for early rounds).

import { ArenaGame, type GameContext, type ArenaActor, type MinigameResult, buildRanking } from "./Minigame";
import type { GameId, Snapshot } from "../../shared/types";
import { ARENA_W, ARENA_H, PLAYER_RADIUS } from "../../shared/constants";
import { dist, shuffle } from "../../shared/util";
import { PowerupField } from "./Powerups";

const ROUND_TIME = 34;
const FREEZE_R = PLAYER_RADIUS * 2 - 4;
const THAW_R = PLAYER_RADIUS * 2 + 2;
const FREEZE_CD = 0.4; // freezer can't chain-freeze instantly
const THAW_IMMUNE = 0.8; // just-thawed blobs get a head start

export class Tag extends ArenaGame {
  id: GameId = "tag";
  private timer = ROUND_TIME;
  private deepFreezeLen = 5;
  private deepFreeze = false;
  private powerups: PowerupField;
  private elimOrder: { id: string; note?: string }[] = [];

  constructor(ctx: GameContext) {
    super(ctx);
    this.powerups = new PowerupField(ctx.rng, { every: 4, max: 4, goodWeight: 0.6 });
  }

  start(): void {
    const ps = shuffle(this.ctx.rng, this.ctx.players);
    ps.forEach((p, i) => {
      const team = i % 2;
      // teams start on opposite sides for clarity
      const side = team === 0 ? 0.28 : 0.72;
      const a = this.addActor(
        p,
        ARENA_W * side + (this.ctx.rng() - 0.5) * 180,
        ARENA_H * (0.25 + this.ctx.rng() * 0.5),
      );
      a.team = team;
      a.data!.freezeCd = 0;
      a.data!.immune = 0;
    });
    this.deepFreezeLen = 3.5 + this.ctx.intensity * 4.5; // 3.5..8s
    this.ctx.toast("Freeze the other team. Thaw your own. Pick favorites.", "info");
  }

  private aliveActors() {
    return [...this.actors.values()].filter((a) => a.alive);
  }

  tick(dt: number, _now: number): void {
    this.elapsed += dt;
    this.timer -= dt;
    this.deepFreeze = this.timer <= this.deepFreezeLen;
    this.powerups.tick(dt);

    for (const a of this.actors.values()) {
      if (!a.alive) continue;
      this.updateStatus(a, dt);
      if ((a.data!.freezeCd || 0) > 0) a.data!.freezeCd = Math.max(0, a.data!.freezeCd - dt);
      if ((a.data!.immune || 0) > 0) a.data!.immune = Math.max(0, a.data!.immune - dt);
      if (a.frozen) {
        a.inDx = 0;
        a.inDy = 0;
        a.anim = "fall";
        continue;
      }
      if (a.isBot) this.botThink(a);
      this.moveActor(a, dt);
      this.powerups.collect(a);
    }

    this.resolveContacts();

    if (this.timer <= 0) this.buzzer();
    // early end: nobody left who can still act (everyone frozen) — let the buzzer
    // handle eliminations, but stop the clock from running pointlessly.
    else if (this.aliveActors().every((a) => a.frozen)) this.buzzer();
  }

  private resolveContacts(): void {
    const alive = this.aliveActors();
    // FREEZE: an unfrozen blob touching an unfrozen enemy freezes them
    for (const f of alive) {
      if (f.frozen || (f.data!.freezeCd || 0) > 0) continue;
      for (const t of alive) {
        if (t === f || t.frozen || t.team === f.team) continue;
        if ((t.data!.immune || 0) > 0) continue;
        if (dist(f.x, f.y, t.x, t.y) < FREEZE_R * Math.max(f.scale, t.scale)) {
          if (t.shield) {
            t.shield = false;
            this.boom("shockwave", t.x, t.y, { color: "#80d8ff" });
          } else {
            t.frozen = true;
            t.anim = "fall";
            t.inDx = 0;
            t.inDy = 0;
            this.boom("spark", t.x, t.y, { color: "#80d8ff" });
            this.boom("pickup", t.x, t.y - 30, { text: "FROZEN!", color: "#bbe9ff" });
          }
          f.data!.freezeCd = FREEZE_CD;
          break;
        }
      }
    }
    // THAW: outside deep freeze, an unfrozen blob touching a frozen teammate frees them
    if (!this.deepFreeze) {
      for (const r of alive) {
        if (r.frozen) continue;
        for (const t of alive) {
          if (t === r || !t.frozen || t.team !== r.team) continue;
          if (dist(r.x, r.y, t.x, t.y) < THAW_R) {
            t.frozen = false;
            t.anim = "idle";
            t.data!.immune = THAW_IMMUNE;
            this.boom("poof", t.x, t.y, { color: "#69f0ae" });
            this.boom("pickup", t.x, t.y - 30, { text: "THAW!", color: "#b9f6ca" });
          }
        }
      }
    }
  }

  private buzzer(): void {
    if (this.done) return;
    const alive = this.aliveActors();
    let frozen = alive.filter((a) => a.frozen);
    // never wipe everyone: if all alive are frozen, spare the lowest-id blob
    if (frozen.length === alive.length && alive.length > 0) {
      const spared = frozen[0];
      spared.frozen = false;
      frozen = frozen.filter((a) => a !== spared);
    }
    for (const l of frozen) {
      l.alive = false;
      l.anim = "dead";
      this.elimOrder.push({ id: l.id, note: "Frozen at the buzzer!" });
      this.boom("death", l.x, l.y, { color: "#4fc3f7" });
      this.boom("splat", l.x, l.y, { color: "#81d4fa" });
    }
    this.ctx.toast(frozen.length ? "BUZZ! ❄️ The frozen shatter. Tragic. Anyway." : "BUZZ! Everyone thawed in time. Boring, but alive.", frozen.length ? "bad" : "good");
    this.done = true;
  }

  private botThink(a: ArenaActor): void {
    const alive = this.aliveActors();
    const enemies = alive.filter((o) => o.team !== a.team && !o.frozen);
    const frozenAllies = alive.filter((o) => o.team === a.team && o.frozen && o !== a);

    const nearest = (list: ArenaActor[]) => {
      let best: ArenaActor | null = null;
      let bd = Infinity;
      for (const o of list) {
        const d = dist(a.x, a.y, o.x, o.y);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      return { best, bd };
    };

    const enemy = nearest(enemies);
    const rescue = nearest(frozenAllies);

    let goal: ArenaActor | null = null;
    if (!this.deepFreeze && rescue.best && (!enemy.best || rescue.bd < enemy.bd * 1.2)) {
      goal = rescue.best; // go thaw a teammate
    } else {
      goal = enemy.best; // chase an enemy to freeze
    }

    if (goal) {
      const dx = goal.x - a.x;
      const dy = goal.y - a.y;
      const m = Math.hypot(dx, dy) || 1;
      a.inDx = (dx / m) + (ARENA_W / 2 - a.x) / ARENA_W * 0.2;
      a.inDy = (dy / m) + (ARENA_H / 2 - a.y) / ARENA_H * 0.2;
    } else {
      a.inDx = Math.sin(this.elapsed + a.y) * 0.4;
      a.inDy = Math.cos(this.elapsed + a.x) * 0.4;
    }
  }

  snapshot(now: number): Snapshot {
    const alive = this.aliveActors();
    const teamCounts = [0, 0];
    for (const a of alive) if (a.team != null) teamCounts[a.team]++;
    return {
      game: this.id,
      t: now,
      actors: [...this.actors.values()].map((a) => this.toActor(a)),
      data: {
        timeLeft: Math.max(0, this.timer),
        deepFreeze: this.deepFreeze,
        frozen: alive.filter((a) => a.frozen).length,
        teamCounts,
        night: this.ctx.night,
        pickups: this.powerups.snapshot(),
      },
      fx: this.drainFx(),
    };
  }

  result(): MinigameResult {
    const survivors = this.aliveActors().map((a) => a.id);
    return { survivorIds: survivors, ranking: buildRanking(survivors, this.elimOrder) };
  }
}
