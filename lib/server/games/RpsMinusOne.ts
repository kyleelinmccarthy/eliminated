import type { Minigame, GameContext, MinigameResult } from "./Minigame";
import type { GameId, Snapshot, Effect } from "../../shared/types";
import type { GameInput } from "../../shared/protocol";
import { shuffle } from "../../shared/util";

type Throw = "R" | "P" | "S";
const THROWS: Throw[] = ["R", "P", "S"];

// returns 1 if a beats b, -1 if loses, 0 tie
function cmp(a: Throw, b: Throw): number {
  if (a === b) return 0;
  if ((a === "R" && b === "S") || (a === "S" && b === "P") || (a === "P" && b === "R")) return 1;
  return -1;
}

interface Duel {
  a: string;
  b: string | null; // null = bye
  aThrows: Throw[];
  bThrows: Throw[];
  aKeep: Throw | null;
  bKeep: Throw | null;
  status: "pick" | "drop" | "resolve" | "done";
  winner: string | null;
  ties: number;
}

// Brisker than before (it dragged): the pick/drop windows are caps, not waits —
// once everyone (humans + instant-filling bots) has locked in, the round snaps
// forward immediately (see phaseComplete / tick).
const PICK_T = 4.5;
const DROP_T = 3;
const RESOLVE_T = 2.0;

export class RpsMinusOne implements Minigame {
  id: GameId = "rpsminusone";
  private ctx: GameContext;
  private fx: Effect[] = [];
  private duels: Duel[] = [];
  private byes: string[] = [];
  private phase: "pick" | "drop" | "resolve" = "pick";
  private timer = PICK_T;
  private done = false;
  private elimOrder: { id: string; note?: string }[] = [];
  private meta = new Map<string, { name: string; characterId: string; isBot: boolean }>();
  private round = 0;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  start(): void {
    for (const p of this.ctx.players)
      this.meta.set(p.id, { name: p.name, characterId: p.characterId, isBot: p.isBot });
    const ids = shuffle(this.ctx.rng, this.ctx.players.map((p) => p.id));
    for (let i = 0; i + 1 < ids.length; i += 2) {
      this.duels.push({
        a: ids[i],
        b: ids[i + 1],
        aThrows: [],
        bThrows: [],
        aKeep: null,
        bKeep: null,
        status: "pick",
        winner: null,
        ties: 0,
      });
    }
    if (ids.length % 2 === 1) this.byes.push(ids[ids.length - 1]);
    this.phase = "pick";
    this.timer = PICK_T;
    this.round = 1;
    this.ctx.toast("Pick TWO throws. Your life is a hand gesture now.", "info");
  }

  private duelOf(id: string): Duel | undefined {
    return this.duels.find((d) => d.status !== "done" && (d.a === id || d.b === id));
  }

  onInput(playerId: string, input: GameInput): void {
    if (input.kind !== "choose") return;
    const d = this.duelOf(playerId);
    if (!d) return;
    const isA = d.a === playerId;
    const v = input.value;
    if (this.phase === "pick" && d.status === "pick") {
      // value is a 2-char pair like "RP"
      const chars = v.split("").filter((c) => THROWS.includes(c as Throw)) as Throw[];
      if (chars.length >= 2) {
        if (isA) d.aThrows = [chars[0], chars[1]];
        else d.bThrows = [chars[0], chars[1]];
      } else if (chars.length === 1) {
        // accumulate
        const arr = isA ? d.aThrows : d.bThrows;
        if (arr.length < 2) arr.push(chars[0]);
      }
    } else if (this.phase === "drop" && d.status === "drop") {
      const t = v as Throw;
      if (!THROWS.includes(t)) return;
      const owned = isA ? d.aThrows : d.bThrows;
      if (!owned.includes(t)) return;
      if (isA) d.aKeep = t;
      else d.bKeep = t;
    }
  }

  tick(dt: number, _now: number): void {
    if (this.done) return;
    this.timer -= dt;

    // bot behavior
    for (const d of this.duels) {
      if (d.status === "done") continue;
      this.botFor(d, d.a, dt);
      if (d.b) this.botFor(d, d.b, dt);
    }

    // Resolve runs on its display timer; pick/drop snap forward the instant
    // everyone has committed so nobody waits on a dead clock.
    if (this.phase === "resolve") {
      if (this.timer <= 0) this.advancePhase();
    } else if (this.timer <= 0 || this.phaseComplete()) {
      this.advancePhase();
    }
  }

  // Whether every still-live duel has all the input the current phase needs.
  private phaseComplete(): boolean {
    if (this.phase === "pick") {
      return this.duels.every(
        (d) => d.status !== "pick" || (d.aThrows.length >= 2 && (!d.b || d.bThrows.length >= 2)),
      );
    }
    if (this.phase === "drop") {
      return this.duels.every((d) => d.status !== "drop" || (!!d.aKeep && (!d.b || !!d.bKeep)));
    }
    return false;
  }

  private botFor(d: Duel, id: string, _dt: number) {
    const m = this.meta.get(id);
    if (!m?.isBot) return;
    const isA = d.a === id;
    if (this.phase === "pick" && d.status === "pick") {
      const arr = isA ? d.aThrows : d.bThrows;
      if (arr.length < 2) {
        arr.length = 0;
        arr.push(THROWS[Math.floor(this.ctx.rng() * 3)], THROWS[Math.floor(this.ctx.rng() * 3)]);
      }
    } else if (this.phase === "drop" && d.status === "drop") {
      const keepRef = isA ? "aKeep" : "bKeep";
      if (d[keepRef]) return;
      const own = isA ? d.aThrows : d.bThrows;
      const opp = isA ? d.bThrows : d.aThrows;
      // choose own throw maximizing expected outcome vs opponent's two (assume 50/50)
      let best: Throw = own[0] ?? "R";
      let bestScore = -Infinity;
      for (const c of own.length ? own : THROWS) {
        let s = 0;
        const oppOptions = opp.length ? opp : THROWS;
        for (const o of oppOptions) s += cmp(c, o);
        s = s / oppOptions.length + (this.ctx.rng() - 0.5) * 0.2;
        if (s > bestScore) {
          bestScore = s;
          best = c;
        }
      }
      d[keepRef] = best;
    }
  }

  private advancePhase() {
    if (this.phase === "pick") {
      // Clock's up: anyone who didn't lock in TWO throws forfeits the duel.
      for (const d of this.duels) {
        if (d.status !== "pick") continue;
        const aMissed = d.aThrows.length < 2;
        const bMissed = !!d.b && d.bThrows.length < 2;
        if (d.b && (aMissed || bMissed)) {
          this.resolveForfeit(d, aMissed, bMissed);
          continue;
        }
        d.status = "drop";
      }
      this.phase = "drop";
      this.timer = DROP_T;
      this.ctx.toast("Now DROP one — drop in time or forfeit. Commit. Regret later.", "info");
    } else if (this.phase === "drop") {
      // Clock's up: anyone who didn't drop one forfeits the duel.
      for (const d of this.duels) {
        if (d.status !== "drop") continue;
        const aMissed = !d.aKeep;
        const bMissed = !!d.b && !d.bKeep;
        if (d.b && (aMissed || bMissed)) {
          this.resolveForfeit(d, aMissed, bMissed);
          continue;
        }
        d.status = "resolve";
      }
      this.phase = "resolve";
      this.timer = RESOLVE_T;
      this.resolveAll();
    } else {
      // resolve -> replay tied duels, advance the bracket, or finish
      const replays = this.duels.filter((d) => d.status === "pick");
      if (replays.length > 0) {
        this.phase = "pick";
        this.timer = PICK_T;
        this.round++;
        this.ctx.toast("Tie! Nobody dies yet. Throw again.", "info");
      } else if (this.ctx.forceSingleSurvivor && this.standing().length > 1) {
        // As the decisive finale, RPS is a full single-elimination bracket:
        // re-pair the winners and keep going until exactly one blob is left.
        this.nextBracketRound();
      } else {
        this.done = true;
      }
    }
  }

  // everyone still in it: this round's duel winners plus anyone who drew a bye
  private standing(): string[] {
    const ids: string[] = [];
    for (const d of this.duels) if (d.winner) ids.push(d.winner);
    for (const b of this.byes) ids.push(b);
    return ids;
  }

  private nextBracketRound(): void {
    const survivors = shuffle(this.ctx.rng, this.standing());
    this.duels = [];
    this.byes = [];
    for (let i = 0; i + 1 < survivors.length; i += 2) {
      this.duels.push({
        a: survivors[i],
        b: survivors[i + 1],
        aThrows: [],
        bThrows: [],
        aKeep: null,
        bKeep: null,
        status: "pick",
        winner: null,
        ties: 0,
      });
    }
    if (survivors.length % 2 === 1) this.byes.push(survivors[survivors.length - 1]);
    this.phase = "pick";
    this.timer = PICK_T;
    this.round++;
    this.ctx.toast(`Winners advance — ${survivors.length} left. Throw again.`, "info");
  }

  private resolveAll() {
    for (const d of this.duels) {
      if (d.status !== "resolve" || !d.b) {
        if (!d.b) {
          d.status = "done";
          d.winner = d.a;
        }
        continue;
      }
      const r = cmp(d.aKeep!, d.bKeep!);
      if (r === 0) {
        // A draw is a draw — nobody dies on a coin flip. Go to sudden death and
        // keep throwing until someone is actually out-thrown.
        d.ties++;
        d.aThrows = [];
        d.bThrows = [];
        d.aKeep = null;
        d.bKeep = null;
        d.status = "pick";
        this.fx.push({ kind: "ring", x: 0, y: 0, color: "#ffd54f", text: d.a });
      } else {
        const winner = r > 0 ? d.a : d.b;
        this.settle(d, winner);
      }
    }
  }

  private settle(d: Duel, winner: string, note = "Out-thrown!") {
    const loser = winner === d.a ? d.b! : d.a;
    d.winner = winner;
    d.status = "done";
    this.elimOrder.push({ id: loser, note });
    this.fx.push({ kind: "death", x: 0, y: 0, color: "#ff1744", text: loser });
    this.fx.push({ kind: "confetti", x: 0, y: 0, color: "#ffd54f", text: winner });
  }

  // Timeout = forfeit. Whoever didn't lock in their move when the clock hit zero
  // loses by default. If BOTH froze, the bracket still needs a body to advance:
  // coin-flip in a single-survivor finale, otherwise both are out. Only called
  // for duels with a real opponent (d.b set).
  private resolveForfeit(d: Duel, aMissed: boolean, bMissed: boolean): void {
    if (aMissed && bMissed) {
      if (this.ctx.forceSingleSurvivor) {
        this.settle(d, this.ctx.rng() < 0.5 ? d.a : d.b!, "Forfeit — both froze, coin flip!");
      } else {
        d.status = "done";
        d.winner = null;
        for (const id of [d.a, d.b!]) {
          this.elimOrder.push({ id, note: "Forfeit — froze up!" });
          this.fx.push({ kind: "death", x: 0, y: 0, color: "#ff1744", text: id });
        }
      }
      return;
    }
    // exactly one whiffed → their opponent advances for free
    this.settle(d, aMissed ? d.b! : d.a, "Forfeit — too slow!");
  }

  snapshot(now: number): Snapshot {
    const fx = this.fx;
    this.fx = [];
    return {
      game: this.id,
      t: now,
      data: {
        phase: this.phase,
        timeLeft: Math.max(0, this.timer),
        round: this.round,
        byes: this.byes,
        duels: this.duels.map((d) => ({
          a: d.a,
          b: d.b,
          aName: this.meta.get(d.a)?.name,
          aChar: this.meta.get(d.a)?.characterId,
          bName: d.b ? this.meta.get(d.b)?.name : null,
          bChar: d.b ? this.meta.get(d.b)?.characterId : null,
          // reveal opponents' two throws during drop/resolve
          aThrows: this.phase === "pick" ? [] : d.aThrows,
          bThrows: this.phase === "pick" ? [] : d.bThrows,
          aKeep: this.phase === "resolve" ? d.aKeep : null,
          bKeep: this.phase === "resolve" ? d.bKeep : null,
          status: d.status,
          winner: d.winner,
          ties: d.ties,
        })),
      },
      fx,
    };
  }

  forfeit(playerId: string): void {
    // if they're mid-duel, hand the win to their opponent (so the bracket still
    // resolves); if they were sitting on a bye, they just forfeit it.
    const d = this.duelOf(playerId);
    if (d && d.b) {
      const opponent = d.a === playerId ? d.b : d.a;
      this.settle(d, opponent);
    } else if (this.byes.includes(playerId)) {
      this.byes = this.byes.filter((b) => b !== playerId);
      this.fx.push({ kind: "death", x: 0, y: 0, color: "#ff1744", text: playerId });
    }
  }

  isDone(): boolean {
    return this.done;
  }

  result(): MinigameResult {
    const winners = new Set<string>();
    for (const d of this.duels) if (d.winner) winners.add(d.winner);
    for (const b of this.byes) winners.add(b);
    const ranking: MinigameResult["ranking"] = [];
    let place = 1;
    for (const id of winners) ranking.push({ playerId: id, survived: true, placement: place++ });
    for (const e of [...this.elimOrder].reverse())
      ranking.push({ playerId: e.id, survived: false, placement: place++, note: e.note });
    return { survivorIds: [...winners], ranking };
  }
}
