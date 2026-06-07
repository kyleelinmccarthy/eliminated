import { ArenaGame, type GameContext, type ArenaActor, type MinigameResult } from "./Minigame";
import type { GameId, Snapshot } from "../../shared/types";
import { ARENA_W, ARENA_H, PLAYER_RADIUS } from "../../shared/constants";
import { dist } from "../../shared/util";
import { mingleRooms, MINGLE_PLATFORM, type MingleRoom } from "../../shared/mingle";

// How long the platform spins and the music plays before a number is called —
// long enough to actually hear the music, watch the carousel turn, and regroup
// on the platform between rounds.
const WANDER_TIME = 4.5;

export class Mingle extends ArenaGame {
  id: GameId = "mingle";
  private rooms: MingleRoom[] = [];
  private phase: "wander" | "mingle" | "flash" = "wander";
  private timer = 2.5;
  private callN = 2;
  private round = 0;
  private startCount = 0;
  private spin = 0; // platform rotation (visual; advanced each tick)
  private elimOrder: { id: string; note?: string }[] = [];
  private lastEval: { roomCounts: number[] } = { roomCounts: [] };

  start(): void {
    const ps = this.ctx.players;
    this.startCount = ps.length;
    // A dash to scramble for a room once the number drops — but on a longer
    // cooldown so it's one committed lunge per round, not a way to dart between
    // rooms freely. While the music plays the platform clamp eats it anyway (you
    // still can't pre-camp a room).
    this.dashCd = 1.8;
    // circular rooms arranged evenly in a ring around the central platform
    this.rooms = mingleRooms();
    // everyone STARTS on the spinning platform (music's playing), packed into a
    // tidy ring inside it so nobody spills out over a room.
    ps.forEach((p, i) => this.addActor(p, MINGLE_PLATFORM.x, MINGLE_PLATFORM.y));
    this.gatherOnPlatform();
    this.phase = "wander";
    this.timer = WANDER_TIME;
  }

  // Pack every still-alive blob back onto the central platform in a tidy ring.
  // Called at the start of each music phase so every round resets to "everyone
  // mingling on the spinning platform" before the next number is called.
  private gatherOnPlatform(): void {
    const alive = this.aliveActors();
    alive.forEach((a, i) => {
      const ang = (i / Math.max(1, alive.length)) * Math.PI * 2;
      const rad = MINGLE_PLATFORM.r * 0.6;
      a.x = MINGLE_PLATFORM.x + Math.cos(ang) * rad;
      a.y = MINGLE_PLATFORM.y + Math.sin(ang) * rad;
      a.inDx = 0;
      a.inDy = 0;
      a.vx = 0;
      a.vy = 0;
    });
  }

  // Clamp a blob back inside the platform rim. Used every wander tick so the
  // crowd is genuinely trapped on the spinning platform until the number is
  // called — no edging toward the rooms while the music's still going.
  private confineToPlatform(a: ArenaActor): void {
    const maxR = MINGLE_PLATFORM.r - PLAYER_RADIUS * a.scale;
    const dx = a.x - MINGLE_PLATFORM.x;
    const dy = a.y - MINGLE_PLATFORM.y;
    const d = Math.hypot(dx, dy);
    if (d > maxR) {
      const m = d || 1;
      a.x = MINGLE_PLATFORM.x + (dx / m) * maxR;
      a.y = MINGLE_PLATFORM.y + (dy / m) * maxR;
      a.vx = 0;
      a.vy = 0;
    }
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
    this.spin += dt * 0.6; // the platform keeps turning while the music plays

    for (const a of this.actors.values()) {
      if (!a.alive) continue;
      this.tickDashCd(a, dt);
      if (a.data!.wantDash) {
        a.data!.wantDash = 0;
        this.tryDash(a);
      }
      if (a.isBot) this.botThink(a);
      if (!this.stepDash(a, dt)) this.moveActor(a, dt);
      // While the music's still playing nobody may leave the platform — you can
      // shuffle around on it, but you can't creep out and pre-camp a room before
      // the number actually drops (a dash just slams into the rim and clamps). The
      // instant it does (mingle), this lifts.
      if (this.phase === "wander") this.confineToPlatform(a);
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
    // No toast here on purpose: a top-of-screen toast lands right on top of the
    // big "GROUP OF N" banner and buries the number players need to read. The
    // banner + alarm sting + ring boom are announcement enough.
    this.boom("ring", ARENA_W / 2, ARENA_H / 2, { color: "#ffd54f", scale: 3 });
  }

  private evaluate() {
    const counts = this.roomCounts();
    const alive = this.aliveActors();
    // split the field into safe (exact group size) and doomed (wrong size / on
    // the platform). A player stranded on the platform has roomOf === -1.
    const doomed: ArenaActor[] = [];
    for (const a of alive) {
      const ri = this.roomOf(a);
      if (ri >= 0 && counts[ri] === this.callN) {
        this.boom("confetti", a.x, a.y, { color: "#69f0ae" });
      } else {
        doomed.push(a);
      }
    }
    // never wipe the whole field: if literally nobody formed a correct group,
    // spare one so the round still leaves a survivor.
    if (doomed.length === alive.length && doomed.length > 0) {
      const spared = doomed.shift()!;
      this.boom("confetti", spared.x, spared.y, { color: "#69f0ae" });
    }
    for (const a of doomed) {
      const ri = this.roomOf(a);
      a.alive = false;
      a.anim = "dead";
      const note = ri < 0 ? "Stuck on the platform!" : counts[ri] < this.callN ? "Too few!" : "Too many!";
      this.elimOrder.push({ id: a.id, note });
      this.boom("death", a.x, a.y, { color: "#ff1744" });
      this.boom("splat", a.x, a.y, { color: "#7e57c2" });
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
      // reset everyone back onto the platform — the music starts up again and the
      // whole "mingle on the spinning platform, then scatter" beat repeats.
      this.gatherOnPlatform();
      this.phase = "wander";
      this.timer = WANDER_TIME;
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
        platform: { x: MINGLE_PLATFORM.x, y: MINGLE_PLATFORM.y, r: MINGLE_PLATFORM.r, spin: +this.spin.toFixed(3) },
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
