import { ArenaGame, type GameContext, type ArenaActor, type MinigameResult } from "./Minigame";
import type { GameId, Snapshot } from "../../shared/types";
import { ARENA_W, ARENA_H } from "../../shared/constants";

// Horizontal track: blobs start at the left edge and race RIGHT toward the Doll.
// The arena is landscape (1280×720), so running across the long axis gives ~2×
// the distance of the old vertical track — you can't clear it in one green light.
const START_X = 90;
const FINISH_X = ARENA_W - 120; // finish line near the right edge (Doll lives past it)
const TIME_LIMIT = 70; // seconds
const GRACE = 0.38; // seconds after red before detection is lethal
const MOVE_EPS = 12; // units/sec considered "moving"
// This game runs slower than the shared PLAYER_SPEED (240) on purpose: the race
// should read as a tense creep toward the Doll, not a frantic zoom. Applies to
// blobs and bots alike (bots share moveActor), so it fixes the "too fast" feel
// for both. Easy to tune.
const RACE_SPEED = 150; // units/sec, this game only

export class RedLightGreenLight extends ArenaGame {
  id: GameId = "redlight";
  private light: "green" | "red" = "green";
  private phaseTime = 0;
  private phaseDur = 2.2;
  private redLethalIn = 0;
  private finishOrder: string[] = [];
  private elimOrder: { id: string; note?: string }[] = [];

  start(): void {
    this.speed = RACE_SPEED;
    const ps = this.ctx.players;
    const n = ps.length;
    // spread the starting line vertically along the left edge
    const spacing = Math.min(110, (ARENA_H - 160) / Math.max(1, n));
    const startY = ARENA_H / 2 - (spacing * (n - 1)) / 2;
    ps.forEach((p, i) => {
      const a = this.addActor(p, START_X, startY + i * spacing);
      a.facing = 0; // facing right, toward the finish
      a.data!.react = 0.12 + this.ctx.rng() * 0.5; // bot reaction delay
      a.data!.reckless = this.ctx.rng() < 0.25 ? 1 : 0;
    });
    this.nextLight(true);
  }

  private nextLight(first = false) {
    if (first || this.light === "red") {
      this.light = "green";
      // Roomier green windows now that blobs move slower, but still capped so a
      // single full-sprint green (max 3.6s ≈ 540u at RACE_SPEED) can't clear the
      // ~1070u track — you always need at least two greens to reach the Doll.
      this.phaseDur = 1.6 + this.ctx.rng() * 2.0;
    } else {
      this.light = "red";
      this.phaseDur = 1.2 + this.ctx.rng() * 1.7;
      this.redLethalIn = GRACE;
      this.boom("ring", FINISH_X + 30, ARENA_H / 2, { color: "#ff1744", scale: 2 });
    }
    this.phaseTime = 0;
  }

  tick(dt: number, _now: number): void {
    this.elapsed += dt;
    this.phaseTime += dt;
    if (this.redLethalIn > 0) this.redLethalIn = Math.max(0, this.redLethalIn - dt);
    if (this.phaseTime >= this.phaseDur) this.nextLight();

    const lethal = this.light === "red" && this.redLethalIn === 0;

    for (const a of this.actors.values()) {
      if (!a.alive || a.data!.finished) continue;
      if (a.isBot) this.botThink(a, dt);
      this.moveActor(a, dt);

      // finish line
      if (a.x >= FINISH_X) {
        a.data!.finished = 1;
        a.anim = "cheer";
        a.inDx = 0;
        a.inDy = 0;
        a.x = FINISH_X;
        this.finishOrder.push(a.id);
        this.boom("confetti", a.x, a.y, { color: "#ffd54f" });
        continue;
      }

      // movement detection on red
      if (lethal) {
        const sp = Math.hypot(a.vx, a.vy);
        if (sp > MOVE_EPS) this.eliminate(a, "Caught moving!");
      }
    }

    // end conditions
    const active = [...this.actors.values()].filter((a) => a.alive && !a.data!.finished);
    if (active.length === 0) this.done = true;
    if (this.elapsed >= TIME_LIMIT) {
      for (const a of active) this.eliminate(a, "Out of time!");
      this.done = true;
    }
  }

  private botThink(a: ArenaActor, dt: number) {
    const d = a.data!;
    if (this.light === "green") {
      // sprint right, slight vertical wiggle to look alive
      a.inDx = 1;
      a.inDy = Math.sin(this.elapsed * 2 + a.y) * 0.15;
      d.stopTimer = 0;
    } else {
      // red: react after delay, recklessly maybe keep going a touch
      d.stopTimer = (d.stopTimer || 0) + dt;
      const react = d.reckless ? d.react + 0.25 : d.react;
      if (d.stopTimer >= react) {
        a.inDx = 0;
        a.inDy = 0;
      }
    }
  }

  private eliminate(a: ArenaActor, note: string) {
    a.alive = false;
    a.anim = "dead";
    a.inDx = 0;
    a.inDy = 0;
    this.elimOrder.push({ id: a.id, note });
    this.boom("death", a.x, a.y, { color: "#ff1744" });
    this.boom("splat", a.x, a.y, { color: "#e53935" });
  }

  snapshot(now: number): Snapshot {
    return {
      game: this.id,
      t: now,
      actors: [...this.actors.values()].map((a) => {
        const ac = this.toActor(a);
        ac.progress = a.data!.finished ? 1 : Math.max(0, Math.min(1, (a.x - START_X) / (FINISH_X - START_X)));
        return ac;
      }),
      data: {
        light: this.light,
        finishX: FINISH_X,
        lethal: this.light === "red" && this.redLethalIn === 0,
        timeLeft: Math.max(0, TIME_LIMIT - this.elapsed),
        watch: this.light === "red" ? Math.min(1, this.phaseTime / 0.4) : Math.max(0, 1 - this.phaseTime / 0.3),
      },
      fx: this.drainFx(),
    };
  }

  result(): MinigameResult {
    const survivors = this.finishOrder.filter((id) => this.actors.get(id)?.alive);
    const ranking = [] as MinigameResult["ranking"];
    let place = 1;
    for (const id of this.finishOrder) ranking.push({ playerId: id, survived: true, placement: place++ });
    for (const e of [...this.elimOrder].reverse())
      ranking.push({ playerId: e.id, survived: false, placement: place++, note: e.note });
    return { survivorIds: survivors, ranking };
  }
}
