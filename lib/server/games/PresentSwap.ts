// Secret Santa Sabotage. The lights go out and the chosen "givers" each secretly
// slip a gift to a blob of THEIR choosing — that's the sabotage. Then the lights
// come up: every blob that RECEIVED a gift must guess who gave it. Guess right and
// the giver is caught & OUT; guess wrong and the receiver takes the fall. Givers
// and receivers are disjoint and each receiver gets exactly one gift, so the
// elimination count per round stays exactly bounded (= number of gifts), which
// fits pacing.

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
  // --- gift phase: the giver picks who to sabotage ---
  targetSlate: string[]; // candidate receivers this giver may pick from (private to the giver)
  targetId: string | null; // the giver's chosen receiver
  botGiftAt: number; // when a bot giver commits (s into the gift phase)
  // --- guess phase (filled in by finalizeGifts once gifts are locked) ---
  receiverId: string; // = targetId after finalizeGifts()
  candidateIds: string[]; // suspects the receiver guesses among, incl. the true giver (public)
  guessId: string | null;
  botGuessAt: number; // when a bot receiver commits
  result?: "caught" | "fooled";
  correct?: boolean;
}

const GIFT = 8; // giver target-selection window (the blackout)
const GUESS = 11;
const REVEAL = 4.2;
const RING_R = 250;
const SLATE = 4; // how many potential targets a giver chooses between

export class PresentSwap implements Minigame {
  id: GameId = "present";
  private ctx: GameContext;
  private fx: Effect[] = [];
  private seats = new Map<string, Seat>();
  private order: string[] = [];
  private events: GiftEvent[] = [];
  private phase: "gift" | "guess" | "reveal" = "gift";
  private timer = GIFT;
  private elapsed = 0; // seconds into the current phase
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
    // Givers and receivers are disjoint: the first k are the (hidden) givers, the
    // rest are the pool they may gift. |pool| = alive - k >= k, so finalizeGifts()
    // can always hand every giver a DISTINCT receiver even after collisions.
    const givers = alive.slice(0, k);
    const pool = alive.slice(k);
    this.events = givers.map((giverId) => ({
      giverId,
      targetSlate: shuffle(this.ctx.rng, pool).slice(0, Math.min(SLATE, pool.length)),
      targetId: null,
      botGiftAt: 1.2 + this.ctx.rng() * (GIFT - 3),
      receiverId: "",
      candidateIds: [],
      guessId: null,
      botGuessAt: 1.5 + this.ctx.rng() * (GUESS - 4),
    }));
    this.phase = "gift";
    this.timer = GIFT;
    this.elapsed = 0;
    this.ctx.toast("🌑 Lights out — somewhere, gifts (and grudges) are being chosen…", "info");
  }

  // suspects the receiver picks between: the true giver + decoys, shuffled.
  private candidates(giverId: string, receiverId: string): string[] {
    const others = this.aliveIds().filter((id) => id !== receiverId);
    const decoyPool = others.filter((id) => id !== giverId);
    const count = Math.min(4, others.length);
    const decoys = shuffle(this.ctx.rng, decoyPool).slice(0, Math.max(0, count - 1));
    return shuffle(this.ctx.rng, [giverId, ...decoys]);
  }

  // Lock in receivers once the gift phase ends: honor each giver's pick, fill in
  // any no-shows, and break ties so every receiver gets exactly one gift. Then
  // build each receiver's suspect list and flip to the guessing phase. A gift with
  // no distinct receiver left (mass forfeits) simply fizzles and is dropped.
  private finalizeGifts(): void {
    const claimed = new Set<string>();
    const poolAll = shuffle(this.ctx.rng, [...new Set(this.events.flatMap((e) => e.targetSlate))]);
    const live: GiftEvent[] = [];
    for (const ev of this.events) {
      let target: string | null = ev.targetId;
      // a human who never picked, or whose pick collides with an earlier giver's,
      // is bumped to a random unclaimed blob from their slate (then anywhere).
      if (!target || claimed.has(target)) {
        target =
          ev.targetSlate.find((id) => !claimed.has(id)) ??
          poolAll.find((id) => !claimed.has(id)) ??
          null;
      }
      if (!target) continue;
      ev.targetId = target;
      ev.receiverId = target;
      claimed.add(target);
      ev.candidateIds = this.candidates(ev.giverId, ev.receiverId);
      live.push(ev);
    }
    this.events = live;
    this.phase = "guess";
    this.timer = GUESS;
    this.elapsed = 0;
    this.ctx.toast("💡 Lights on! Got a gift? Guess who gave it — or take the fall.", "info");
  }

  onInput(playerId: string, input: GameInput): void {
    if (input.kind !== "choose") return;
    if (this.phase === "gift") {
      // a giver slips their gift to a chosen target
      const ev = this.events.find((e) => e.giverId === playerId);
      if (!ev || ev.targetId) return;
      if (ev.targetSlate.includes(input.value)) ev.targetId = input.value;
    } else if (this.phase === "guess") {
      // a receiver accuses a suspect
      const ev = this.events.find((e) => e.receiverId === playerId);
      if (!ev || ev.guessId) return;
      if (ev.candidateIds.includes(input.value)) ev.guessId = input.value;
    }
  }

  tick(dt: number, _now: number): void {
    if (this.done) return;
    this.timer -= dt;
    this.elapsed += dt;

    if (this.phase === "gift") {
      // bots pick a (uniformly random) target at their chosen moment
      for (const ev of this.events) {
        if (ev.targetId) continue;
        const g = this.seats.get(ev.giverId)!;
        if (g.isBot && this.elapsed >= ev.botGiftAt && ev.targetSlate.length) {
          ev.targetId = ev.targetSlate[Math.floor(this.ctx.rng() * ev.targetSlate.length)];
        }
      }
      if (this.timer <= 0 || this.events.every((e) => e.targetId)) this.finalizeGifts();
      return;
    }

    if (this.phase === "guess") {
      // bots commit a (uniformly random) guess at their chosen moment
      for (const ev of this.events) {
        if (ev.guessId) continue;
        const r = this.seats.get(ev.receiverId)!;
        if (r.isBot && this.elapsed >= ev.botGuessAt) {
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
    this.elapsed = 0;
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
    let secrets: Record<string, any> | undefined;
    if (this.phase === "gift") {
      // Receivers aren't public yet (and givers NEVER are): expose only progress.
      // Each giver privately learns they're gifting + their slate via `secrets`.
      secrets = {};
      for (const e of this.events) {
        secrets[e.giverId] = { role: "giver", targetSlate: e.targetSlate, targetId: e.targetId };
      }
    } else if (this.phase === "guess") {
      // expose who's holding a gift + who's locked a guess (a settled 🎁 / a "🤔"
      // on the watch view), but NEVER the giver. The giver privately sees who they
      // hit so they can sweat over the guess.
      events = this.events.map((e) => ({
        receiverId: e.receiverId,
        candidateIds: e.candidateIds,
        guessed: !!e.guessId,
      }));
      secrets = {};
      for (const e of this.events) {
        secrets[e.giverId] = { role: "giver", gaveToId: e.receiverId };
      }
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
        // 0→1 progress through the blackout (ambient gift animation), plus how many
        // gifts have been committed so spectators watch the parlor fill up.
        darkProg: this.phase === "gift" ? clamp(this.elapsed / GIFT, 0, 1) : 0,
        gifts: this.events.length,
        placed: this.events.filter((e) => e.targetId).length,
        events,
      },
      fx,
      secrets,
    };
  }

  forfeit(playerId: string): void {
    const s = this.seats.get(playerId);
    if (!s || !s.alive) return;
    s.alive = false;
    // drop any gift this blob is tangled in (as giver OR as the chosen receiver) so
    // finalizeGifts()/resolve() never reference someone who left the party…
    this.events = this.events.filter((e) => e.giverId !== playerId && e.receiverId !== playerId);
    // …and scrub them from any still-open giver's options.
    if (this.phase === "gift") {
      for (const e of this.events) {
        e.targetSlate = e.targetSlate.filter((id) => id !== playerId);
        if (e.targetId === playerId) e.targetId = null;
      }
    }
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
