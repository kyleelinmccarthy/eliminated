import { type Minigame, type GameContext, type MinigameResult, buildRanking } from "./Minigame";
import type { GameId, Snapshot, Effect } from "../../shared/types";
import type { GameInput } from "../../shared/protocol";
import { clamp, shuffle } from "../../shared/util";

// Glass Stepping Stones — the Squid Game bridge, done right.
//
// ONE shared bridge with one hidden safe side per row. Blobs cross ONE AT A TIME,
// in line order. On your turn you guess LEFT or RIGHT for the next un-crossed row:
//   • Correct → you step on, that row is now revealed (safe) for everyone, and the
//     turn passes to the next blob, who guesses the row after.
//   • Wrong → the glass SHATTERS and you're eliminated — but the row's safe side
//     is now exposed, so the next blob simply follows the known pattern across it
//     for free, then guesses the next unknown row.
// It's a relay of 50/50 gambles. Once the whole pattern is known, the survivors
// stroll across. You either make it over… or run out of blobs trying.

interface Walker {
  id: string;
  name: string;
  characterId: string;
  isBot: boolean;
  alive: boolean;
  finished: boolean;
  botThink: number; // sec a bot dithers before committing its guess
}

const TURN_TIME = 6; // seconds a blob has to pick before it's auto-decided
const RESOLVE_TIME = 1.1; // beat to animate the step / shatter before the next turn
const STEP_TIME = 0.5; // quick beat for auto-walking an already-revealed row
const TIME_LIMIT = 110; // overall safety cap (rarely reached)

export class GlassBridge implements Minigame {
  id: GameId = "glassbridge";
  private ctx: GameContext;
  private fx: Effect[] = [];
  private walkers = new Map<string, Walker>();
  private order: string[] = []; // line order (fixed)
  private pattern: number[] = []; // safe side per row (0=L, 1=R) — hidden
  private revealed: boolean[] = []; // is this row's safe side public yet?
  private brokeSide: number[] = []; // per row: the side a blob shattered (-1 = none)
  private rows = 8;
  private frontier = 0; // next un-crossed row
  private phase: "choose" | "resolve" | "step" | "done" = "choose";
  private timer = TURN_TIME;
  private turnPtr = 0; // index into order for whose turn
  private activeId = "";
  private lastStep: { id: string; row: number; side: number; ok: boolean } | null = null;
  private elapsed = 0;
  private done = false;
  private elimOrder: { id: string; note?: string }[] = [];

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  start(): void {
    const n = this.ctx.players.length;
    // More rows = more 50/50 gambles = more deaths (≈ rows/2). Scale with the
    // series so it culls gently early, brutally late — but always leaves someone.
    this.rows = clamp(Math.round(n * (0.7 + this.ctx.intensity * 0.9)), 4, 12);
    for (let r = 0; r < this.rows; r++) {
      this.pattern.push(this.ctx.rng() < 0.5 ? 0 : 1);
      this.revealed.push(false);
      this.brokeSide.push(-1);
    }
    // randomize the line order so it isn't always the same blob going first
    this.order = shuffle(this.ctx.rng, this.ctx.players.map((p) => p.id));
    for (const p of this.ctx.players) {
      this.walkers.set(p.id, {
        id: p.id,
        name: p.name,
        characterId: p.characterId,
        isBot: p.isBot,
        alive: true,
        finished: false,
        botThink: 0,
      });
    }
    this.beginTurn(0);
    this.ctx.toast("One bridge, one safe path. Cross in line — guess LEFT or RIGHT when it's your turn.", "info");
  }

  private aliveCount(): number {
    return [...this.walkers.values()].filter((w) => w.alive && !w.finished).length;
  }

  // Find the next blob in line that's still alive and hasn't crossed, starting
  // search at `from` (inclusive). Returns null if nobody's left to cross.
  private nextActive(from: number): string | null {
    for (let i = 0; i < this.order.length; i++) {
      const idx = (from + i) % this.order.length;
      const w = this.walkers.get(this.order[idx]);
      if (w && w.alive && !w.finished) {
        this.turnPtr = idx;
        return w.id;
      }
    }
    return null;
  }

  private beginTurn(from: number): void {
    // bridge fully crossed → everyone still standing strolls across, game over
    if (this.frontier >= this.rows) return this.finishAllAlive();

    const id = this.nextActive(from);
    if (!id) {
      this.done = true;
      return;
    }
    this.activeId = id;

    // Auto-walk any already-revealed rows at the frontier (a prior blob exposed
    // them by dying) — the active blob follows the known pattern for free.
    if (this.revealed[this.frontier]) {
      this.phase = "step";
      this.timer = STEP_TIME;
      return;
    }

    this.phase = "choose";
    this.timer = TURN_TIME;
    const w = this.walkers.get(id)!;
    if (w.isBot) w.botThink = 0.6 + this.ctx.rng() * 1.5;
  }

  private finishAllAlive(): void {
    for (const w of this.walkers.values()) {
      if (w.alive && !w.finished) {
        w.finished = true;
        this.fx.push({ kind: "confetti", x: 0, y: 0, color: "#69f0ae", text: w.id });
      }
    }
    this.phase = "done";
    this.done = true;
  }

  onInput(playerId: string, input: GameInput): void {
    if (input.kind !== "choose") return;
    if (this.phase !== "choose" || playerId !== this.activeId) return; // only the active blob, only while choosing
    const side = input.value === "R" ? 1 : 0;
    this.resolveGuess(side);
  }

  // The active blob commits to a side for the frontier row.
  private resolveGuess(side: number): void {
    const w = this.walkers.get(this.activeId);
    if (!w || !w.alive || w.finished) return;
    const row = this.frontier;
    const safe = this.pattern[row];
    this.revealed[row] = true; // the side is now public either way

    if (side === safe) {
      // stepped onto the holding pane — advance the shared frontier
      this.frontier++;
      this.lastStep = { id: w.id, row, side, ok: true };
      this.fx.push({ kind: "spark", x: 0, y: row, color: "#69f0ae", text: w.id });
    } else {
      // shattered. Last blob standing gets a lucky catch so the round always
      // leaves a survivor; otherwise they're boxed and the row is exposed for the
      // next blob to follow.
      this.brokeSide[row] = side;
      if (this.aliveCount() <= 1) {
        // they stumble but catch themselves — step onto the safe side, survive
        this.frontier++;
        this.lastStep = { id: w.id, row, side: safe, ok: true };
        this.fx.push({ kind: "spark", x: 0, y: row, color: "#69f0ae", text: w.id });
      } else {
        w.alive = false;
        this.elimOrder.push({ id: w.id, note: `Shattered the glass at row ${row + 1}` });
        this.lastStep = { id: w.id, row, side, ok: false };
        this.fx.push({ kind: "shatter", x: 0, y: row, color: "#80d8ff", text: w.id });
        this.fx.push({ kind: "death", x: 0, y: row, color: "#ff1744", text: w.id });
      }
    }
    this.phase = "resolve";
    this.timer = RESOLVE_TIME;
  }

  tick(dt: number, _now: number): void {
    if (this.done) return;
    this.elapsed += dt;
    this.timer -= dt;

    if (this.phase === "choose") {
      const w = this.walkers.get(this.activeId);
      if (w && w.isBot) {
        w.botThink -= dt;
        if (w.botThink <= 0) {
          // pure luck — a bot can't see the pattern any better than you can
          this.resolveGuess(this.ctx.rng() < 0.5 ? 0 : 1);
          return;
        }
      }
      if (this.timer <= 0) {
        // ran out the clock → forced coin-flip guess (your hesitation may be fatal)
        this.resolveGuess(this.ctx.rng() < 0.5 ? 0 : 1);
      }
      return;
    }

    if (this.phase === "step") {
      // auto-walk a revealed row for free, then it's a normal turn at the next row
      if (this.timer <= 0) {
        this.frontier++;
        this.lastStep = { id: this.activeId, row: this.frontier - 1, side: this.pattern[this.frontier - 1], ok: true };
        this.fx.push({ kind: "spark", x: 0, y: this.frontier - 1, color: "#b9f6ca", text: this.activeId });
        // same blob keeps going from the (now unrevealed) frontier this turn
        this.beginTurn(this.turnPtr);
      }
      return;
    }

    if (this.phase === "resolve") {
      if (this.timer <= 0) this.beginTurn(this.turnPtr + 1); // next blob in line
      return;
    }

    // safety cap — if the relay somehow stalls, let the standing blobs survive
    if (this.elapsed >= TIME_LIMIT) this.finishAllAlive();
  }

  forfeit(playerId: string): void {
    const w = this.walkers.get(playerId);
    if (!w || !w.alive || w.finished) return;
    w.alive = false;
    this.elimOrder.push({ id: playerId, note: "Bailed off the bridge" });
    this.fx.push({ kind: "death", x: 0, y: Math.min(this.frontier, this.rows - 1), color: "#ff1744", text: playerId });
    // if the quitter was up, hand the turn along (and never strand the round)
    if (playerId === this.activeId && this.phase !== "done") {
      if (this.aliveCount() === 0) this.done = true;
      else this.beginTurn(this.turnPtr + 1);
    }
  }

  snapshot(now: number): Snapshot {
    const fx = this.fx;
    this.fx = [];
    return {
      game: this.id,
      t: now,
      data: {
        rows: this.rows,
        frontier: this.frontier,
        phase: this.phase,
        activeId: this.activeId,
        turnTimeLeft: this.phase === "choose" ? Math.max(0, this.timer) : 0,
        // per row: -1 unknown, else the SAFE side (0=L,1=R) once revealed
        revealedSides: this.pattern.map((s, r) => (this.revealed[r] ? s : -1)),
        brokeSide: this.brokeSide,
        lastStep: this.lastStep,
        walkers: this.order.map((id) => {
          const w = this.walkers.get(id)!;
          return {
            id: w.id,
            name: w.name,
            characterId: w.characterId,
            alive: w.alive,
            finished: w.finished,
            active: id === this.activeId && (this.phase === "choose" || this.phase === "step"),
          };
        }),
      },
      fx,
    };
  }

  isDone(): boolean {
    return this.done;
  }

  result(): MinigameResult {
    const survivors = [...this.walkers.values()].filter((w) => w.finished || w.alive).map((w) => w.id);
    return { survivorIds: survivors, ranking: buildRanking(survivors, this.elimOrder) };
  }
}
