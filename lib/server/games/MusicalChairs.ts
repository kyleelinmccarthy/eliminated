// Musical Chairs — a children's-game mashup. Blobs MUST keep moving while the
// music plays (stand still and you're out, Red-Light-Green-Light style); the
// instant it really stops they scramble for a scatter of chairs (one blob each).
// The DJ throws in fake-outs — brief "STOP!"s that aren't — so freezing on a
// bait can cost you. Whoever's left standing is out, and chairs vanish each
// round. Still the gentle opener: only a few blobs go per round.

import { ArenaGame, type GameContext, type ArenaActor, type MinigameResult, buildRanking } from "./Minigame";
import type { GameId, Snapshot } from "../../shared/types";
import { ARENA_W, ARENA_H, PLAYER_RADIUS } from "../../shared/constants";
import { dist, clamp } from "../../shared/util";
import { PowerupField } from "./Powerups";

interface Chair {
  x: number;
  y: number;
  by: string | null;
}

const CHAIR_R = 46;
const CHAIR_GAP = 96; // min spacing between scattered chairs (no stacking)
const CHAIR_MARGIN = 150; // keep chairs this far from the walls
const STILL_GRACE = 1.0; // seconds you can stand still in the music before you're out
const STILL_SPEED = 40; // intended speed below this counts as "standing still"
const FAKE_SHOW = 0.45; // how long a fake-out "STOP!" is displayed

export class MusicalChairs extends ArenaGame {
  id: GameId = "musicalchairs";
  private chairs: Chair[] = [];
  private phase: "music" | "scramble" | "eval" = "music";
  private timer = 0;
  private round = 0;
  private startCount = 0;
  private maxRounds = 2;
  private powerups: PowerupField;
  private elimOrder: { id: string; note?: string }[] = [];
  private fakeT = 0; // remaining display time of a fake-out
  private fakeCd = 0; // cooldown until the next possible fake-out

  constructor(ctx: GameContext) {
    super(ctx);
    this.powerups = new PowerupField(ctx.rng, { every: 2.2, max: 5, goodWeight: 0.55, margin: 120 });
  }

  start(): void {
    this.startCount = this.ctx.players.length;
    this.ctx.players.forEach((p, i) => {
      const ang = (i / this.ctx.players.length) * Math.PI * 2;
      this.addActor(p, ARENA_W / 2 + Math.cos(ang) * 330, ARENA_H / 2 + Math.sin(ang) * 250);
    });
    this.maxRounds = this.ctx.intensity < 0.4 ? 1 : this.ctx.intensity < 0.7 ? 2 : 3;
    this.beginMusic();
  }

  private aliveActors() {
    return [...this.actors.values()].filter((a) => a.alive);
  }

  private beginMusic(): void {
    this.round++;
    // Chairs are NOT on the floor during the music — you can't camp on or hover
    // around one. They only drop in when the music stops (see beginScramble), so
    // your position during the dance is a real gamble.
    this.chairs = [];
    for (const a of this.aliveActors()) {
      a.data!.seated = 0;
      a.data!.orbit = Math.atan2(a.y - ARENA_H / 2, a.x - ARENA_W / 2);
      // small startup grace so nobody's punished for the beat between rounds
      a.data!.stillT = -0.9;
      if (a.isBot) {
        // Each bot drifts on its own radius/direction/speed so they meander like a
        // crowd instead of marching the ring in lockstep. `skill` decides how sharp
        // it'll be in the scramble (reaction time + how optimal a chair it picks).
        a.data!.wanderR = 130 + this.ctx.rng() * 120;
        a.data!.spin = (0.5 + this.ctx.rng() * 0.7) * (this.ctx.rng() < 0.5 ? 1 : -1);
        a.data!.skill = this.ctx.rng();
      }
    }
    this.phase = "music";
    this.timer = 3.5 + this.ctx.rng() * 2.5;
    this.fakeT = 0;
    this.fakeCd = 1.1 + this.ctx.rng() * 1.0; // first bait can't fire instantly
    this.ctx.toast("🎵 Music's on — keep dancing! Chairs drop the instant it STOPS.", "info");
  }

  // Scatter chairs across the floor (with min spacing) instead of a tidy ring, so
  // positioning during the music actually matters — and reshuffle every round.
  private scatterChairs(n: number): void {
    this.chairs = [];
    const X0 = CHAIR_MARGIN;
    const X1 = ARENA_W - CHAIR_MARGIN;
    const Y0 = CHAIR_MARGIN;
    const Y1 = ARENA_H - CHAIR_MARGIN;
    for (let i = 0; i < n; i++) {
      let best = { x: (X0 + X1) / 2, y: (Y0 + Y1) / 2 };
      let bestSep = -1;
      // sample a handful of candidates; keep the one furthest from existing chairs.
      // random sampling naturally yields uneven clumps and gaps (no perfect grid).
      for (let s = 0; s < 14; s++) {
        const x = X0 + this.ctx.rng() * (X1 - X0);
        const y = Y0 + this.ctx.rng() * (Y1 - Y0);
        let near = Infinity;
        for (const c of this.chairs) near = Math.min(near, dist(x, y, c.x, c.y));
        if (this.chairs.length === 0) { best = { x, y }; break; }
        if (near > bestSep) { bestSep = near; best = { x, y }; }
        if (near >= CHAIR_GAP) break; // good enough, stop early
      }
      this.chairs.push({ x: best.x, y: best.y, by: null });
    }
  }

  private beginScramble(): void {
    this.phase = "scramble";
    this.timer = 4;
    // NOW the chairs appear — scattered fresh the moment the music dies, so where
    // you happened to be standing matters and nobody pre-camped a seat.
    const alive = this.aliveActors().length;
    const remove = clamp(Math.ceil(alive * 0.15 * (0.6 + this.ctx.intensity)), 1, Math.max(1, Math.floor(alive / 2)));
    const nChairs = Math.max(1, alive - remove);
    this.scatterChairs(nChairs);
    for (const a of this.aliveActors()) {
      if (!a.isBot) continue;
      const skill = a.data!.skill ?? this.ctx.rng();
      a.data!.skill = skill;
      // Bots don't pounce the instant the music dies — they freeze for a human
      // reaction beat first (sharper bots recover quicker), and can't claim a
      // chair until it passes. That hesitation is your chance to grab one.
      a.data!.reactT = 0.22 + (1 - skill) * 0.55 + this.ctx.rng() * 0.25;
      a.data!.targetChair = -1;
    }
    this.ctx.toast(`🪑 ${nChairs} chair${nChairs > 1 ? "s" : ""} — GRAB ONE! Elbows allowed.`, "bad");
    this.boom("ring", ARENA_W / 2, ARENA_H / 2, { color: "#ffd54f", scale: 3 });
  }

  private evaluate(): void {
    for (const a of this.aliveActors()) {
      if (!a.data!.seated) {
        a.alive = false;
        a.anim = "dead";
        this.elimOrder.push({ id: a.id, note: "No chair!" });
        this.boom("death", a.x, a.y, { color: "#ff1744" });
        this.boom("splat", a.x, a.y, { color: "#ab47bc" });
      } else {
        this.boom("confetti", a.x, a.y, { color: "#69f0ae" });
      }
    }
    this.phase = "eval";
    this.timer = 1.8;
  }

  private afterEval(): void {
    const alive = this.aliveActors().length;
    if (alive <= 2 || this.round >= this.maxRounds) this.done = true;
    else this.beginMusic();
  }

  tick(dt: number, _now: number): void {
    this.elapsed += dt;
    this.timer -= dt;
    if (this.phase === "music") {
      this.powerups.tick(dt);
      this.runFakeouts(dt);
    }

    for (const a of this.actors.values()) {
      if (!a.alive) continue;
      this.updateStatus(a, dt);
      if (a.isBot) this.botThink(a, dt);
      this.moveActor(a, dt, this.phase === "scramble" ? 1.12 : 1);
      if (this.phase === "music") {
        this.powerups.collect(a);
        this.keepMoving(a, dt);
      }
    }

    if (this.phase === "scramble") this.claimChairs();

    if (this.phase === "music" && this.timer <= 0) this.beginScramble();
    else if (this.phase === "scramble" && (this.timer <= 0 || this.allSeated())) this.evaluate();
    else if (this.phase === "eval" && this.timer <= 0) this.afterEval();
  }

  // "Keep moving" rule: stand still through the music and the floor claims you.
  // Bots wander, so this only ever bites a human who stops (or freezes on a bait).
  private keepMoving(a: ArenaActor, dt: number): void {
    const moving = Math.hypot(a.vx, a.vy) > STILL_SPEED;
    a.data!.stillT = moving ? 0 : (a.data!.stillT ?? 0) + dt;
    const t = a.data!.stillT;
    if (t >= STILL_GRACE) {
      a.alive = false;
      a.anim = "dead";
      a.flash = 0;
      this.elimOrder.push({ id: a.id, note: "Stopped dancing!" });
      this.boom("death", a.x, a.y, { color: "#ff1744" });
      this.boom("splat", a.x, a.y, { color: "#ab47bc" });
    } else if (t > STILL_GRACE * 0.4) {
      a.flash = 1; // pulse a warning before the floor takes them
    }
  }

  // The DJ teases the room with brief fake "STOP!"s. They don't open the chairs,
  // but a blob that panics and freezes during one feeds its keep-moving timer.
  private runFakeouts(dt: number): void {
    if (this.fakeT > 0) this.fakeT = Math.max(0, this.fakeT - dt);
    this.fakeCd -= dt;
    // never bait in the last beat before the real stop (that'd be unfair)
    if (this.fakeCd <= 0 && this.fakeT <= 0 && this.timer > 1.3) {
      this.fakeT = FAKE_SHOW;
      this.fakeCd = 1.4 + this.ctx.rng() * 1.6;
      this.boom("ring", ARENA_W / 2, ARENA_H / 2, { color: "#ff5252", scale: 2 });
      this.ctx.toast("🛑 …and STOP— PSYCH. Keep dancing.", "info");
    }
  }

  private claimChairs(): void {
    // Resolve humans before bots so a chair two of them reach on the same tick
    // goes to the player. And a bot can't actually sit until its reaction beat is
    // up (see botThink) — that's the window for you to dive in and steal it.
    const order = [...this.aliveActors()].sort((a, b) => Number(a.isBot) - Number(b.isBot));
    for (const a of order) {
      if (a.data!.seated) continue;
      if (a.isBot && (a.data!.reactT || 0) > 0) continue;
      for (const c of this.chairs) {
        if (c.by) continue;
        if (dist(a.x, a.y, c.x, c.y) < CHAIR_R) {
          c.by = a.id;
          a.data!.seated = 1;
          this.boom("pickup", c.x, c.y - 30, { text: "SAFE!", color: "#b9f6ca" });
          break;
        }
      }
    }
  }

  private allSeated(): boolean {
    return this.chairs.every((c) => c.by);
  }

  private botThink(a: ArenaActor, dt: number): void {
    if (this.phase === "music") {
      // wander on a personal radius/heading — not camped on the chair ring
      a.data!.orbit = (a.data!.orbit || 0) + (a.data!.spin ?? 0.6) * dt;
      const R = a.data!.wanderR ?? 190;
      const tx = ARENA_W / 2 + Math.cos(a.data!.orbit) * R;
      const ty = ARENA_H / 2 + Math.sin(a.data!.orbit) * R;
      const dx = tx - a.x;
      const dy = ty - a.y;
      const m = Math.hypot(dx, dy) || 1;
      a.inDx = dx / m;
      a.inDy = dy / m;
      return;
    }
    if (a.data!.seated) {
      a.inDx = 0;
      a.inDy = 0;
      return;
    }
    // scramble: hesitate for a reaction beat (caught flat-footed), then commit
    if ((a.data!.reactT || 0) > 0) {
      a.data!.reactT -= dt;
      a.inDx = 0;
      a.inDy = 0;
      return;
    }
    const target = this.chairForBot(a);
    if (target) {
      const dx = target.x - a.x;
      const dy = target.y - a.y;
      const m = Math.hypot(dx, dy) || 1;
      a.inDx = dx / m;
      a.inDy = dy / m;
    } else {
      a.inDx = 0;
      a.inDy = 0;
    }
  }

  // Pick the chair a bot scrambles for. It sticks with its committed target while
  // that chair stays open; otherwise it chooses among the nearest few — sharper
  // bots take the closest, sloppier ones often lock onto a worse one (and lose the
  // race), which is what leaves chairs open for the humans.
  private chairForBot(a: ArenaActor): Chair | null {
    const ti = a.data!.targetChair;
    if (typeof ti === "number" && ti >= 0 && this.chairs[ti] && !this.chairs[ti].by) {
      return this.chairs[ti];
    }
    const open = this.chairs
      .map((c, i) => ({ c, i, d: dist(a.x, a.y, c.x, c.y) }))
      .filter((o) => !o.c.by)
      .sort((p, q) => p.d - q.d);
    if (!open.length) {
      a.data!.targetChair = -1;
      return null;
    }
    const skill = a.data!.skill ?? 0.7;
    const span = skill > 0.66 ? 1 : skill > 0.33 ? 2 : 3;
    const pick = open[Math.floor(this.ctx.rng() * Math.min(span, open.length))];
    a.data!.targetChair = pick.i;
    return pick.c;
  }

  snapshot(now: number): Snapshot {
    return {
      game: this.id,
      t: now,
      actors: [...this.actors.values()].map((a) => this.toActor(a)),
      data: {
        phase: this.phase,
        round: this.round,
        timeLeft: Math.max(0, this.timer),
        chairs: this.chairs.map((c) => ({ x: Math.round(c.x), y: Math.round(c.y), claimed: !!c.by })),
        night: this.ctx.night,
        fake: this.phase === "music" && this.fakeT > 0,
        pickups: this.phase === "music" ? this.powerups.snapshot() : [],
      },
      fx: this.drainFx(),
    };
  }

  result(): MinigameResult {
    const survivors = this.aliveActors().map((a) => a.id);
    return { survivorIds: survivors, ranking: buildRanking(survivors, this.elimOrder) };
  }
}
