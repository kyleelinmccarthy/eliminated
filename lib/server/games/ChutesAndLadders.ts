// Chutes & Ladders — the deadliest pure-luck game in the catalog. Everyone races
// up a 100-square serpentine board by TAPPING to roll a die. Ladders launch you
// up; snakes (the "chutes") drag you back down. Reach square 100 and you've
// scrambled to safety. When the clock runs out, whoever's still lowest on the
// board gets swallowed — no skill, no appeals, just dice and the creeping doom.
// The only agency is effort: keep rolling, because a slow tapper is a dead one.

import type { Minigame, GameContext, MinigameResult, RankEntry } from "./Minigame";
import type { GameId, Snapshot, Effect } from "../../shared/types";
import type { GameInput } from "../../shared/protocol";
import { clamp } from "../../shared/util";

interface Climber {
  id: string;
  name: string;
  characterId: string;
  isBot: boolean;
  alive: boolean;
  square: number; // 0 (start pad) .. 100 (goal)
  finished: boolean;
  finishRank: number; // order they topped out (0 = not finished)
  rolls: number; // total dice rolled (tiebreak / flavor)
  rollCd: number; // seconds until the next roll is allowed
  dieShow: number; // seconds left to show the last die face on the client
  die: number; // last rolled value (1..6)
  botCadence: number; // a bot's base delay between rolls (skill)
}

interface Link {
  from: number;
  to: number;
}

const GOAL = 100;
const COLS = 10;
const ROWS = 10;
const ROLL_CD = 0.7; // min seconds between rolls (humans tapping flat-out)
const DIE_SHOW = 0.45; // how long the rolled face lingers on the client

export class ChutesAndLadders implements Minigame {
  id: GameId = "chutesladders";
  private ctx: GameContext;
  private fx: Effect[] = [];
  private climbers = new Map<string, Climber>();
  private ladders: Link[] = [];
  private chutes: Link[] = [];
  private timeLeft = 24;
  private duration = 24;
  private dangerCount = 1; // how many of the lowest get swallowed at the buzzer
  private finishCount = 0;
  private done = false;
  private elimOrder: { id: string; note?: string }[] = [];

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  start(): void {
    const n = this.ctx.players.length;
    for (const p of this.ctx.players) {
      this.climbers.set(p.id, {
        id: p.id,
        name: p.name,
        characterId: p.characterId,
        isBot: p.isBot,
        alive: true,
        square: 0,
        finished: false,
        finishRank: 0,
        rolls: 0,
        rollCd: this.ctx.rng() * 0.4, // tiny stagger so they don't all roll in lockstep
        dieShow: 0,
        die: 0,
        // sloppier bots roll less often (longer cadence), leaving room for a
        // diligent human to out-tap them — the only skill this game rewards.
        botCadence: p.isBot ? ROLL_CD + (0.15 + this.ctx.rng() * 0.65) : ROLL_CD,
      });
    }
    this.buildBoard();

    // Harsher late in a series: shorter clock + a wider mouth on the snake pit.
    this.duration = Math.round(26 - this.ctx.intensity * 8); // 18..26s
    this.timeLeft = this.duration;
    this.dangerCount = clamp(
      Math.ceil(n * 0.16 * (0.6 + this.ctx.intensity)),
      1,
      Math.max(1, Math.floor(n / 2)),
    );

    this.ctx.toast("🎲 Roll for your life. The ladders are merciful. The snakes are not.", "info");
  }

  // Scatter ladders (up) and snakes (down) across the board, no square shared by
  // two link endpoints, nothing touching the start (1) or the goal (100). Drawn
  // as straight runs client-side, so a pawn easing between endpoints rides them.
  private buildBoard(): void {
    const used = new Set<number>([1, GOAL]);
    const freeCell = (): number => {
      for (let guard = 0; guard < 200; guard++) {
        const s = 2 + Math.floor(this.ctx.rng() * (GOAL - 2)); // 2..99
        if (!used.has(s)) {
          used.add(s);
          return s;
        }
      }
      return -1;
    };
    const rowOf = (s: number) => Math.floor((s - 1) / COLS);

    const nLadders = 7 + Math.floor(this.ctx.rng() * 3); // 7..9
    const nChutes = 7 + Math.floor(this.ctx.rng() * 3);

    for (let i = 0; i < nLadders; i++) {
      const a = freeCell();
      const b = freeCell();
      if (a < 0 || b < 0) break;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      // want a meaningful climb (at least ~2 rows) but not an instant win
      if (rowOf(hi) - rowOf(lo) < 2 || hi - lo > 56) {
        used.delete(a);
        used.delete(b);
        i--;
        continue;
      }
      this.ladders.push({ from: lo, to: hi });
    }
    for (let i = 0; i < nChutes; i++) {
      const a = freeCell();
      const b = freeCell();
      if (a < 0 || b < 0) break;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      if (rowOf(hi) - rowOf(lo) < 2 || hi - lo > 56) {
        used.delete(a);
        used.delete(b);
        i--;
        continue;
      }
      this.chutes.push({ from: hi, to: lo }); // snake head high, tail low
    }
  }

  onInput(playerId: string, input: GameInput): void {
    if (input.kind !== "tap" && !(input.kind === "action" && input.name === "roll")) return;
    this.roll(playerId);
  }

  private roll(id: string): void {
    const c = this.climbers.get(id);
    if (!c || !c.alive || c.finished) return;
    if (c.rollCd > 0) return; // still on cooldown
    const die = 1 + Math.floor(this.ctx.rng() * 6);
    c.die = die;
    c.dieShow = DIE_SHOW;
    c.rolls++;
    c.rollCd = ROLL_CD;

    let next = c.square + die;
    if (next >= GOAL) {
      // reach (or overshoot) the top → scramble onto the safe ledge. No bounce —
      // this is a death game, we don't send you back down for being too lucky.
      c.square = GOAL;
      c.finished = true;
      c.finishRank = ++this.finishCount;
      this.fx.push({ kind: "confetti", x: 0, y: 0, color: "#69f0ae", text: id });
      return;
    }
    c.square = next;

    // ride a ladder up…
    const ladder = this.ladders.find((l) => l.from === c.square);
    if (ladder) {
      c.square = ladder.to;
      this.fx.push({ kind: "pickup", x: 0, y: 0, color: "#69f0ae", text: id });
      return;
    }
    // …or get swallowed by a snake and slide down
    const chute = this.chutes.find((s) => s.from === c.square);
    if (chute) {
      c.square = chute.to;
      this.fx.push({ kind: "shockwave", x: 0, y: 0, color: "#ff5252", text: id });
    }
  }

  tick(dt: number, _now: number): void {
    if (this.done) return;
    this.timeLeft = Math.max(0, this.timeLeft - dt);

    for (const c of this.climbers.values()) {
      if (c.rollCd > 0) c.rollCd = Math.max(0, c.rollCd - dt);
      if (c.dieShow > 0) c.dieShow = Math.max(0, c.dieShow - dt);
      if (!c.alive || c.finished || !c.isBot) continue;
      // bots just keep rolling on their personal cadence
      if (c.rollCd <= 0) {
        this.roll(c.id);
        c.rollCd = c.botCadence; // override the flat cooldown with the bot's pace
      }
    }

    const racers = [...this.climbers.values()].filter((c) => c.alive && !c.finished);
    if (this.timeLeft <= 0 || racers.length === 0) this.finish();
  }

  // The buzzer. Finishers are safe on the ledge and can NEVER be culled; of those
  // still on the board, the lowest `dangerCount` are swallowed by the pit. The
  // rest live. (Only non-finishers are ever eligible, so reaching the top is
  // always real safety.)
  private finish(): void {
    if (this.done) return;
    const racers = [...this.climbers.values()]
      .filter((c) => c.alive && !c.finished)
      .sort((a, b) => this.standing(a) - this.standing(b)); // worst first
    const cut = Math.min(this.dangerCount, racers.length);
    for (let i = 0; i < cut; i++) {
      const c = racers[i];
      c.alive = false;
      const note = c.square <= 0 ? "Never left the start!" : `Snaked at square ${c.square}`;
      this.elimOrder.push({ id: c.id, note }); // worst-out pushed first
      this.fx.push({ kind: "death", x: 0, y: 0, color: "#ff1744", text: c.id });
    }
    this.done = true;
  }

  // A sortable "how well are they doing" score: finishers rank above everyone
  // (earlier finishers highest), then by square, then by fewer rolls used.
  private standing(c: Climber): number {
    if (c.finished) return 1_000_000 - c.finishRank;
    return c.square * 1000 - c.rolls;
  }

  forfeit(playerId: string): void {
    const c = this.climbers.get(playerId);
    if (!c || !c.alive) return;
    c.alive = false;
    c.finished = false;
    this.elimOrder.push({ id: playerId, note: "Rage-quit the board" });
    this.fx.push({ kind: "death", x: 0, y: 0, color: "#ff1744", text: playerId });
    const racers = [...this.climbers.values()].filter((x) => x.alive && !x.finished);
    if (racers.length === 0) this.finish();
  }

  snapshot(now: number): Snapshot {
    const fx = this.fx;
    this.fx = [];
    return {
      game: this.id,
      t: now,
      data: {
        goal: GOAL,
        cols: COLS,
        rows: ROWS,
        ladders: this.ladders,
        chutes: this.chutes,
        timeLeft: +this.timeLeft.toFixed(2),
        duration: this.duration,
        dangerCount: this.dangerCount,
        climbers: [...this.climbers.values()].map((c) => ({
          id: c.id,
          name: c.name,
          characterId: c.characterId,
          alive: c.alive,
          square: c.square,
          finished: c.finished,
          die: c.dieShow > 0 ? c.die : 0,
        })),
      },
      fx,
    };
  }

  isDone(): boolean {
    return this.done;
  }

  result(): MinigameResult {
    const survivorsSorted = [...this.climbers.values()]
      .filter((c) => c.alive)
      .sort((a, b) => this.standing(b) - this.standing(a));
    const survivorIds = survivorsSorted.map((c) => c.id);

    const ranking: RankEntry[] = [];
    let place = 1;
    for (const c of survivorsSorted) {
      ranking.push({
        playerId: c.id,
        survived: true,
        placement: place++,
        note: c.finished ? "Reached the top!" : `Hung on at square ${c.square}`,
      });
    }
    // elimOrder is worst-out first → reverse so higher climbers place better
    for (const e of [...this.elimOrder].reverse()) {
      ranking.push({ playerId: e.id, survived: false, placement: place++, note: e.note });
    }
    return { survivorIds, ranking };
  }
}
