import type { Minigame, GameContext, MinigameResult } from "./Minigame";
import type { GameId, Snapshot, Effect } from "../../shared/types";
import type { GameInput } from "../../shared/protocol";

interface Walker {
  id: string;
  name: string;
  characterId: string;
  isBot: boolean;
  row: number; // 0..ROWS, ROWS = finished
  alive: boolean;
  finished: boolean;
  stun: number; // seconds remaining
  botTimer: number;
  botSkill: number; // 0.5..0.85 chance to guess right
}

const ROWS = 8;
const TIME_LIMIT = 24;
const STUN = 1.2;

// Cross the glass bridge by picking the tempered tile each row. A wrong pick
// cracks the glass and stuns you (costing precious time). Finish before the
// whole bridge shatters at the timer.
export class GlassBridge implements Minigame {
  id: GameId = "glassbridge";
  private ctx: GameContext;
  private fx: Effect[] = [];
  private walkers = new Map<string, Walker>();
  private safe: Map<string, number[]> = new Map(); // per-player safe side per row (0=L,1=R)
  private elapsed = 0;
  private done = false;
  private rows = ROWS;
  private timeLimit = TIME_LIMIT;
  private elimOrder: { id: string; note?: string }[] = [];
  private finishOrder: string[] = [];

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  start(): void {
    // shorter & more forgiving early in a series, longer & tighter later
    this.rows = Math.max(5, Math.min(10, Math.round(5 + this.ctx.intensity * 5)));
    this.timeLimit = Math.round(this.rows * (3.2 - this.ctx.intensity * 0.9)) + 4;
    for (const p of this.ctx.players) {
      this.walkers.set(p.id, {
        id: p.id,
        name: p.name,
        characterId: p.characterId,
        isBot: p.isBot,
        row: 0,
        alive: true,
        finished: false,
        stun: 0,
        botTimer: 0.3 + this.ctx.rng() * 0.6,
        botSkill: 0.5 + this.ctx.rng() * 0.32,
      });
      const sides: number[] = [];
      for (let r = 0; r < this.rows; r++) sides.push(this.ctx.rng() < 0.5 ? 0 : 1);
      this.safe.set(p.id, sides);
    }
  }

  onInput(playerId: string, input: GameInput): void {
    if (input.kind !== "choose") return;
    const side = input.value === "R" ? 1 : 0;
    this.resolve(playerId, side);
  }

  private resolve(id: string, side: number) {
    const w = this.walkers.get(id);
    if (!w || !w.alive || w.finished || w.stun > 0) return;
    const safeSide = this.safe.get(id)![w.row];
    if (side === safeSide) {
      w.row++;
      this.fx.push({ kind: "spark", x: 0, y: w.row, color: "#69f0ae", text: id });
      if (w.row >= this.rows) {
        w.finished = true;
        this.finishOrder.push(id);
        this.fx.push({ kind: "confetti", x: 0, y: 0, color: "#ffd54f", text: id });
      }
    } else {
      w.stun = STUN;
      // reroll this row so the retry is a fresh gamble
      this.safe.get(id)![w.row] = this.ctx.rng() < 0.5 ? 0 : 1;
      this.fx.push({ kind: "shatter", x: 0, y: w.row, color: "#80d8ff", text: id });
    }
  }

  tick(dt: number, _now: number): void {
    this.elapsed += dt;
    for (const w of this.walkers.values()) {
      if (!w.alive || w.finished) continue;
      if (w.stun > 0) w.stun = Math.max(0, w.stun - dt);
      if (w.isBot && w.stun === 0) {
        w.botTimer -= dt;
        if (w.botTimer <= 0) {
          w.botTimer = 0.35 + this.ctx.rng() * 0.6;
          const safeSide = this.safe.get(w.id)![w.row];
          const guess = this.ctx.rng() < w.botSkill ? safeSide : 1 - safeSide;
          this.resolve(w.id, guess);
        }
      }
    }

    const activeAlive = [...this.walkers.values()].filter((w) => w.alive && !w.finished);
    if (activeAlive.length === 0) {
      this.done = true;
      return;
    }
    if (this.elapsed >= this.timeLimit) {
      for (const w of activeAlive) {
        w.alive = false;
        this.elimOrder.push({ id: w.id, note: `Fell at row ${w.row + 1}` });
        this.fx.push({ kind: "death", x: 0, y: w.row, color: "#ff1744", text: w.id });
      }
      this.done = true;
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
        timeLeft: Math.max(0, this.timeLimit - this.elapsed),
        walkers: [...this.walkers.values()].map((w) => ({
          id: w.id,
          name: w.name,
          characterId: w.characterId,
          row: w.row,
          alive: w.alive,
          finished: w.finished,
          stun: w.stun > 0,
        })),
        fxRows: fx, // includes encoded id in text + row in y
      },
      fx: [],
    };
  }

  forfeit(playerId: string): void {
    const w = this.walkers.get(playerId);
    if (!w || !w.alive || w.finished) return;
    w.alive = false;
    this.elimOrder.push({ id: playerId, note: `Bailed at row ${w.row + 1}` });
    this.fx.push({ kind: "death", x: 0, y: w.row, color: "#ff1744", text: playerId });
  }

  isDone(): boolean {
    return this.done;
  }

  result(): MinigameResult {
    const survivors = [...this.walkers.values()].filter((w) => w.finished).map((w) => w.id);
    const ranking: MinigameResult["ranking"] = [];
    let place = 1;
    for (const id of this.finishOrder) ranking.push({ playerId: id, survived: true, placement: place++ });
    // non-finishers ranked by row reached
    const losers = [...this.walkers.values()]
      .filter((w) => !w.finished)
      .sort((a, b) => b.row - a.row);
    for (const w of losers)
      ranking.push({ playerId: w.id, survived: false, placement: place++, note: `Fell at row ${w.row + 1}` });
    return { survivorIds: survivors, ranking };
  }
}
