import { ArenaGame, type GameContext, type ArenaActor, type MinigameResult } from "./Minigame";
import type { GameId, Snapshot } from "../../shared/types";
import { ARENA_W, ARENA_H } from "../../shared/constants";
import { dist } from "../../shared/util";

interface Room {
  x: number;
  y: number;
  r: number;
}

export class Mingle extends ArenaGame {
  id: GameId = "mingle";
  private rooms: Room[] = [];
  private phase: "wander" | "mingle" | "flash" = "wander";
  private timer = 2.5;
  private callN = 2;
  private round = 0;
  private startCount = 0;
  private elimOrder: { id: string; note?: string }[] = [];
  private lastEval: { roomCounts: number[] } = { roomCounts: [] };

  start(): void {
    const ps = this.ctx.players;
    this.startCount = ps.length;
    // grid of rooms
    const cols = 4;
    const rows = 2;
    const mx = 220;
    const my = 200;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.rooms.push({
          x: mx + (c * (ARENA_W - 2 * mx)) / (cols - 1),
          y: my + (r * (ARENA_H - 2 * my)) / (rows - 1),
          r: 96,
        });
      }
    }
    ps.forEach((p, i) => {
      const ang = (i / ps.length) * Math.PI * 2;
      this.addActor(p, ARENA_W / 2 + Math.cos(ang) * 120, ARENA_H / 2 + Math.sin(ang) * 90);
    });
    this.phase = "wander";
    this.timer = 2.5;
  }

  private aliveActors() {
    return [...this.actors.values()].filter((a) => a.alive);
  }

  private roomOf(a: ArenaActor): number {
    for (let i = 0; i < this.rooms.length; i++) {
      const r = this.rooms[i];
      if (dist(a.x, a.y, r.x, r.y) <= r.r) return i;
    }
    return -1;
  }

  private roomCounts(): number[] {
    const counts = new Array(this.rooms.length).fill(0);
    for (const a of this.aliveActors()) {
      const ri = this.roomOf(a);
      if (ri >= 0) counts[ri]++;
    }
    return counts;
  }

  tick(dt: number, _now: number): void {
    this.elapsed += dt;
    this.timer -= dt;

    for (const a of this.actors.values()) {
      if (!a.alive) continue;
      if (a.isBot) this.botThink(a);
      this.moveActor(a, dt);
    }

    if (this.phase === "wander") {
      if (this.timer <= 0) this.beginMingle();
    } else if (this.phase === "mingle") {
      this.lastEval.roomCounts = this.roomCounts();
      if (this.timer <= 0) this.evaluate();
    } else if (this.phase === "flash") {
      if (this.timer <= 0) this.afterFlash();
    }
  }

  private beginMingle() {
    this.round++;
    const alive = this.aliveActors().length;
    const choices = [2, 3, 4].filter((n) => n < alive);
    this.callN = choices.length ? choices[Math.floor(this.ctx.rng() * choices.length)] : 2;
    this.phase = "mingle";
    this.timer = Math.max(4.5, 7 - this.round * 0.5);
    this.ctx.toast(`MINGLE! Groups of ${this.callN} — odd ones out get got!`, "info");
    this.boom("ring", ARENA_W / 2, ARENA_H / 2, { color: "#ffd54f", scale: 3 });
  }

  private evaluate() {
    const counts = this.roomCounts();
    for (const a of this.aliveActors()) {
      const ri = this.roomOf(a);
      const ok = ri >= 0 && counts[ri] === this.callN;
      if (!ok) {
        a.alive = false;
        a.anim = "dead";
        const note = ri < 0 ? "No room!" : "Wrong group size!";
        this.elimOrder.push({ id: a.id, note });
        this.boom("death", a.x, a.y, { color: "#ff1744" });
        this.boom("splat", a.x, a.y, { color: "#7e57c2" });
      } else {
        this.boom("confetti", a.x, a.y, { color: "#69f0ae" });
      }
    }
    this.lastEval.roomCounts = counts;
    this.phase = "flash";
    this.timer = 2.0;
  }

  private afterFlash() {
    const alive = this.aliveActors().length;
    // keep more alive (and run fewer rounds) early in a series
    const target = Math.max(2, Math.ceil(this.startCount * (1 - 0.5 * this.ctx.intensity)));
    const maxRounds = this.ctx.intensity < 0.4 ? 2 : this.ctx.intensity < 0.7 ? 3 : 4;
    if (alive <= target || this.round >= maxRounds || alive <= 2) {
      this.done = true;
    } else {
      this.phase = "wander";
      this.timer = 2.5;
    }
  }

  private botThink(a: ArenaActor) {
    if (this.phase !== "mingle") {
      // mill near center
      a.inDx = Math.sin(this.elapsed * 1.5 + a.y) * 0.4;
      a.inDy = Math.cos(this.elapsed * 1.3 + a.x) * 0.4;
      return;
    }
    const counts = this.roomCounts();
    const myRoom = this.roomOf(a);
    if (myRoom >= 0 && counts[myRoom] === this.callN) {
      // stay put, we're safe — small jitter
      a.inDx *= 0.5;
      a.inDy *= 0.5;
      return;
    }
    // pick best room: prefer rooms with count in [1, N-1] closest to N, nearest
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < this.rooms.length; i++) {
      const c = counts[i] - (myRoom === i ? 1 : 0); // exclude self if already there
      if (c >= this.callN) continue;
      const d = dist(a.x, a.y, this.rooms[i].x, this.rooms[i].y);
      const fillScore = c; // closer to N is better
      const score = fillScore * 200 - d;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) best = 0;
    const r = this.rooms[best];
    const dx = r.x - a.x;
    const dy = r.y - a.y;
    const m = Math.hypot(dx, dy) || 1;
    a.inDx = dx / m;
    a.inDy = dy / m;
  }

  snapshot(now: number): Snapshot {
    const counts = this.lastEval.roomCounts.length ? this.lastEval.roomCounts : this.roomCounts();
    return {
      game: this.id,
      t: now,
      actors: [...this.actors.values()].map((a) => this.toActor(a)),
      data: {
        phase: this.phase,
        n: this.callN,
        round: this.round,
        timeLeft: Math.max(0, this.timer),
        rooms: this.rooms.map((r, i) => ({
          x: r.x,
          y: r.y,
          r: r.r,
          count: counts[i] || 0,
          ok: (counts[i] || 0) === this.callN,
        })),
      },
      fx: this.drainFx(),
    };
  }

  result(): MinigameResult {
    const survivors = this.aliveActors().map((a) => a.id);
    const ranking: MinigameResult["ranking"] = [];
    let place = 1;
    for (const id of survivors) ranking.push({ playerId: id, survived: true, placement: place++ });
    for (const e of [...this.elimOrder].reverse())
      ranking.push({ playerId: e.id, survived: false, placement: place++, note: e.note });
    return { survivorIds: survivors, ranking };
  }
}
