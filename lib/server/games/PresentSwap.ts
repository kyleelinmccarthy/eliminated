// Secret Santa Sabotage. The lights go out and gifts are slipped between blobs.
// Each "live" gift is a hidden giver -> receiver pair; the receiver must guess
// who gave it. Both are at stake: guess right and the giver is caught & out,
// guess wrong and the receiver is out. Disjoint pairs each round keep the
// elimination count exactly bounded (= number of gifts), which fits pacing.

import { type GameContext, type MinigameResult, buildRanking, type Minigame } from "./Minigame";
import type { GameId, Snapshot, Effect } from "../../shared/types";
import type { GameInput } from "../../shared/protocol";
import { ARENA_W, ARENA_H } from "../../shared/constants";
import { shuffle, clamp } from "../../shared/util";

interface Seat {
  id: string;
  name: string;
  characterId: string;
  isBot: boolean;
  alive: boolean;
  x: number;
  y: number;
}

interface GiftEvent {
  giverId: string;
  receiverId: string;
  candidateIds: string[]; // includes the true giver, shuffled (public)
  guessId: string | null;
  botGuessAt: number; // when a bot receiver commits (s into guess phase)
  result?: "caught" | "fooled";
  correct?: boolean;
}

const DARK = 3.5;
const GUESS = 11;
const REVEAL = 4.2;
const RING_R = 250;

export class PresentSwap implements Minigame {
  id: GameId = "present";
  private ctx: GameContext;
  private fx: Effect[] = [];
  private seats = new Map<string, Seat>();
  private order: string[] = [];
  private events: GiftEvent[] = [];
  private phase: "dark" | "guess" | "reveal" = "dark";
  private timer = DARK;
  private guessElapsed = 0;
  private round = 0;
  private maxRounds = 1;
  private targetSurvivors = 2;
  private startCount = 0;
  private done = false;
  private elimOrder: { id: string; note?: string }[] = [];

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  start(): void {
    const ps = this.ctx.players;
    this.startCount = ps.length;
    this.order = ps.map((p) => p.id);
    ps.forEach((p, i) => {
      const ang = (i / ps.length) * Math.PI * 2 - Math.PI / 2;
      this.seats.set(p.id, {
        id: p.id,
        name: p.name,
        characterId: p.characterId,
        isBot: p.isBot,
        alive: true,
        x: ARENA_W / 2 + Math.cos(ang) * RING_R * 1.6,
        y: ARENA_H / 2 + Math.sin(ang) * RING_R,
      });
    });
    this.maxRounds = this.ctx.intensity < 0.5 ? 1 : 2;
    this.targetSurvivors = Math.max(2, Math.ceil(this.startCount * (1 - 0.45 * this.ctx.intensity)));
    this.beginRound();
  }

  private aliveIds(): string[] {
    return this.order.filter((id) => this.seats.get(id)!.alive);
  }

  private beginRound(): void {
    this.round++;
    const alive = shuffle(this.ctx.rng, this.aliveIds());
    const k = clamp(
      Math.ceil(alive.length * 0.25 * (0.6 + this.ctx.intensity)),
      1,
      Math.floor(alive.length / 2),
    );
    this.events = [];
    const givers = alive.slice(0, k);
    const receivers = alive.slice(k, 2 * k);
    for (let i = 0; i < k; i++) {
      const giverId = givers[i];
      const receiverId = receivers[i];
      this.events.push({
        giverId,
        receiverId,
        candidateIds: this.candidates(giverId, receiverId),
        guessId: null,
        botGuessAt: 1.5 + this.ctx.rng() * (GUESS - 4),
      });
    }
    this.phase = "dark";
    this.timer = DARK;
    this.guessElapsed = 0;
    this.ctx.toast("🌑 Lights out — gifts (and grudges) are being placed…", "info");
  }

  private candidates(giverId: string, receiverId: string): string[] {
    const others = this.aliveIds().filter((id) => id !== receiverId);
    const decoyPool = others.filter((id) => id !== giverId);
    const count = Math.min(4, others.length);
    const decoys = shuffle(this.ctx.rng, decoyPool).slice(0, Math.max(0, count - 1));
    return shuffle(this.ctx.rng, [giverId, ...decoys]);
  }

  onInput(playerId: string, input: GameInput): void {
    if (this.phase !== "guess" || input.kind !== "choose") return;
    const ev = this.events.find((e) => e.receiverId === playerId);
    if (!ev || ev.guessId) return;
    if (ev.candidateIds.includes(input.value)) ev.guessId = input.value;
  }

  tick(dt: number, _now: number): void {
    if (this.done) return;
    this.timer -= dt;

    if (this.phase === "dark") {
      if (this.timer <= 0) {
        this.phase = "guess";
        this.timer = GUESS;
        this.guessElapsed = 0;
        this.ctx.toast("💡 Who gave you that gift? Guess right or take the fall.", "info");
      }
      return;
    }

    if (this.phase === "guess") {
      this.guessElapsed += dt;
      // bots commit a (uniformly random) guess at their chosen moment
      for (const ev of this.events) {
        if (ev.guessId) continue;
        const r = this.seats.get(ev.receiverId)!;
        if (r.isBot && this.guessElapsed >= ev.botGuessAt) {
          ev.guessId = ev.candidateIds[Math.floor(this.ctx.rng() * ev.candidateIds.length)];
        }
      }
      if (this.timer <= 0 || this.events.every((e) => e.guessId)) this.resolve();
      return;
    }

    if (this.phase === "reveal") {
      if (this.timer <= 0) this.afterReveal();
    }
  }

  private resolve(): void {
    for (const ev of this.events) {
      const correct = ev.guessId != null && ev.guessId === ev.giverId;
      ev.correct = correct;
      ev.result = correct ? "caught" : "fooled";
      const victimId = correct ? ev.giverId : ev.receiverId;
      const victim = this.seats.get(victimId)!;
      victim.alive = false;
      this.elimOrder.push({
        id: victimId,
        note: correct ? "Caught gifting!" : "Fooled by the gift!",
      });
      this.fx.push({ kind: "death", x: victim.x, y: victim.y, color: "#ff1744" });
      this.fx.push({ kind: "splat", x: victim.x, y: victim.y, color: "#e53935" });
    }
    this.phase = "reveal";
    this.timer = REVEAL;
  }

  private afterReveal(): void {
    const alive = this.aliveIds().length;
    if (alive <= this.targetSurvivors || alive <= 2 || this.round >= this.maxRounds) this.done = true;
    else this.beginRound();
  }

  snapshot(now: number): Snapshot {
    const fx = this.fx;
    this.fx = [];
    let events: any[] = [];
    if (this.phase === "dark") {
      events = this.events.map((e) => ({ receiverId: e.receiverId }));
    } else if (this.phase === "guess") {
      // expose who has already locked a guess so the watch view can show who's
      // still deciding (a pulsing "🤔") vs who's committed.
      events = this.events.map((e) => ({
        receiverId: e.receiverId,
        candidateIds: e.candidateIds,
        guessed: !!e.guessId,
      }));
    } else {
      events = this.events.map((e) => ({
        receiverId: e.receiverId,
        giverId: e.giverId,
        guessId: e.guessId,
        result: e.result,
        correct: e.correct,
      }));
    }
    return {
      game: this.id,
      t: now,
      actors: [...this.seats.values()].map((s) => ({
        id: s.id,
        x: s.x,
        y: s.y,
        characterId: s.characterId,
        name: s.name,
        alive: s.alive,
        anim: s.alive ? "idle" : "dead",
      })),
      data: {
        phase: this.phase,
        round: this.round,
        timeLeft: Math.max(0, this.timer),
        // 0→1 progress of the gifts being slipped in during the blackout, so the
        // client can animate them arriving (instead of popping in at full).
        darkProg: this.phase === "dark" ? clamp(1 - this.timer / DARK, 0, 1) : 0,
        events,
      },
      fx,
    };
  }

  forfeit(playerId: string): void {
    const s = this.seats.get(playerId);
    if (!s || !s.alive) return;
    s.alive = false;
    // void any pending gift they're tangled in so resolve() doesn't reference a
    // blob that's already left the party.
    this.events = this.events.filter((e) => e.giverId !== playerId && e.receiverId !== playerId);
    this.elimOrder.push({ id: playerId, note: "Left the party early" });
    this.fx.push({ kind: "death", x: s.x, y: s.y, color: "#ff1744" });
    this.fx.push({ kind: "splat", x: s.x, y: s.y, color: "#e53935" });
  }

  isDone(): boolean {
    return this.done;
  }

  result(): MinigameResult {
    const survivors = this.aliveIds();
    return { survivorIds: survivors, ranking: buildRanking(survivors, this.elimOrder) };
  }
}
