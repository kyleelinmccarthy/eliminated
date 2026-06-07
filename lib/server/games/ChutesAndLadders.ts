// Chutes & Ladders — the Squid Game version. Everyone races up an 8x8 board (64
// squares) by TAPPING to roll a die, under a countdown. Reach the top (square 64)
// and you're SAFE — finishers can never be culled.
//
// Two things change your fate beyond the dice:
//   • LADDERS launch you up the board — pure good fortune, applied automatically.
//   • CHUTES are FORKS. Land on one and you must pick a side: LEFT or RIGHT. One
//     side drops you back to the START; the other drops you into the ABYSS and
//     you're eliminated. Each chute's sides are FIXED and CONSISTENT — the same
//     side of the same chute always does the same thing to everyone — and once a
//     side is taken it's revealed to all, so blobs can learn from whoever tried it
//     first (exactly like the glass bridge).
//
// When the clock runs out, every blob still stuck on the board (not safe at the
// top) is in danger and the stragglers are culled worst-first. We always leave at
// least one survivor — the board never fully empties.

import type { Minigame, GameContext, MinigameResult, RankEntry } from "./Minigame";
import type { GameId, Snapshot, Effect } from "../../shared/types";
import type { GameInput } from "../../shared/protocol";

interface Climber {
  id: string;
  name: string;
  characterId: string;
  isBot: boolean;
  alive: boolean;
  square: number; // 0 (start pad) .. 64 (goal)
  finished: boolean;
  finishRank: number; // order they topped out (0 = not finished)
  rolls: number; // total dice rolled (tiebreak / flavor)
  rollCd: number; // seconds until the next roll is allowed
  dieShow: number; // seconds left to show the last die face on the client
  die: number; // last rolled value (1..6)
  choosing: number; // id of the chute they're deciding (-1 = not at a fork)
  botThink: number; // seconds a bot dithers before committing a fork choice
  botCadence: number; // a bot's base delay between rolls (skill)
}

interface Ladder {
  from: number; // foot (lower)
  to: number; // top (higher)
}

// A fork. `deathSide` (0=L, 1=R) is the lethal direction — fixed for the round.
// The other side sends you back to the start. `revealed` exposes a side's nature
// to everyone once any blob has taken it.
interface Chute {
  id: number;
  square: number; // the fork's square (where you land to trigger it)
  deathSide: 0 | 1;
  revealed: [boolean, boolean];
}

const GOAL = 64;
const COLS = 8;
const ROWS = 8;
const N_LADDERS = 4;
const N_CHUTES = 3;
const ROLL_CD = 0.7; // min seconds between rolls (humans tapping flat-out)
const DIE_SHOW = 0.45; // how long the rolled face lingers on the client
const MAX_LADDER_SPAN = 30; // a ladder may climb at most ~half the board

export class ChutesAndLadders implements Minigame {
  id: GameId = "chutesladders";
  private ctx: GameContext;
  private fx: Effect[] = [];
  private climbers = new Map<string, Climber>();
  private ladders: Ladder[] = [];
  private chutes: Chute[] = [];
  private timeLeft = 35;
  private duration = 35;
  private finishCount = 0;
  private done = false;
  private elimOrder: { id: string; note?: string }[] = [];

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  start(): void {
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
        choosing: -1,
        botThink: 0,
        // sloppier bots roll less often (longer cadence), leaving room for a
        // diligent human to out-tap them — part of the skill this game rewards.
        botCadence: p.isBot ? ROLL_CD + (0.15 + this.ctx.rng() * 0.65) : ROLL_CD,
      });
    }
    this.buildBoard();

    // Roomier clock early (so a blob bounced back to the start can re-climb),
    // tighter late. A reset costs a full climb, so we stay generous.
    this.duration = Math.round(40 - this.ctx.intensity * 10); // 30..40s
    this.timeLeft = this.duration;

    this.ctx.toast("🎲 RACE to the top — that's safety. Ladders lift you; a chute makes you GAMBLE: one fork resets you, the other ends you.", "info");
  }

  // Scatter ladders (up) and chute forks across the board. No square is shared by
  // two links, nothing sits on the start (1) or the goal (64). Each chute picks a
  // fixed lethal side up front so its outcome is consistent all round.
  private buildBoard(): void {
    const used = new Set<number>([1, GOAL]);
    const rowOf = (s: number) => Math.floor((s - 1) / COLS);
    const freeCell = (): number => {
      for (let guard = 0; guard < 200; guard++) {
        const s = 2 + Math.floor(this.ctx.rng() * (GOAL - 2)); // 2..GOAL-1
        if (!used.has(s)) {
          used.add(s);
          return s;
        }
      }
      return -1;
    };

    for (let i = 0; i < N_LADDERS; i++) {
      const a = freeCell();
      const b = freeCell();
      if (a < 0 || b < 0) break;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      // a meaningful climb (≥2 rows) but not an instant win
      if (rowOf(hi) - rowOf(lo) < 2 || hi - lo > MAX_LADDER_SPAN) {
        used.delete(a);
        used.delete(b);
        i--;
        continue;
      }
      this.ladders.push({ from: lo, to: hi });
    }

    for (let i = 0; i < N_CHUTES; i++) {
      const square = freeCell();
      if (square < 0) break;
      this.chutes.push({
        id: i,
        square,
        deathSide: this.ctx.rng() < 0.5 ? 0 : 1,
        revealed: [false, false],
      });
    }
  }

  onInput(playerId: string, input: GameInput): void {
    if (input.kind === "choose") {
      this.choose(playerId, input.value === "R" ? 1 : 0);
      return;
    }
    if (input.kind === "tap" || (input.kind === "action" && input.name === "roll")) {
      this.roll(playerId);
    }
  }

  private roll(id: string): void {
    const c = this.climbers.get(id);
    if (!c || !c.alive || c.finished) return;
    if (c.choosing >= 0) return; // frozen at a fork until they pick a side
    if (c.rollCd > 0) return; // still on cooldown
    const die = 1 + Math.floor(this.ctx.rng() * 6);
    c.die = die;
    c.dieShow = DIE_SHOW;
    c.rolls++;
    c.rollCd = ROLL_CD;

    const next = c.square + die;
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

    // ride a ladder up — automatic good luck.
    const ladder = this.ladders.find((l) => l.from === c.square);
    if (ladder) {
      c.square = ladder.to;
      this.fx.push({ kind: "pickup", x: 0, y: 0, color: "#69f0ae", text: id });
      return;
    }
    // land on a chute fork → freeze here until they choose a side.
    const chute = this.chutes.find((s) => s.square === c.square);
    if (chute) {
      c.choosing = chute.id;
      if (c.isBot) c.botThink = 0.4 + this.ctx.rng() * 1.1;
      this.fx.push({ kind: "shockwave", x: 0, y: 0, color: "#c77dff", text: id });
    }
  }

  // Commit to a side of the fork you're standing on. The death side eliminates;
  // the other side dumps you back at the start. Either way the side is now public.
  private choose(id: string, side: 0 | 1): void {
    const c = this.climbers.get(id);
    if (!c || !c.alive || c.finished || c.choosing < 0) return;
    const chute = this.chutes.find((s) => s.id === c.choosing);
    c.choosing = -1;
    if (!chute) return;
    chute.revealed[side] = true;

    if (side === chute.deathSide) {
      // Lucky catch: never let the very last blob fall — the board must leave a
      // survivor. If anyone else is still alive, the wrong fork is fatal.
      const othersAlive = [...this.climbers.values()].some((x) => x.id !== id && x.alive);
      if (!othersAlive) {
        c.square = 0; // stumble, catch yourself, scramble back to the start
        this.fx.push({ kind: "shockwave", x: 0, y: 0, color: "#80d8ff", text: id });
        return;
      }
      c.alive = false;
      this.elimOrder.push({ id, note: "Took the wrong fork — into the abyss!" });
      this.fx.push({ kind: "death", x: 0, y: 0, color: "#ff1744", text: id });
      this.fx.push({ kind: "splat", x: 0, y: 0, color: "#ff5252", text: id });
      this.maybeFinishEarly();
      return;
    }
    // the kinder fork — all the way back to the start.
    c.square = 0;
    this.fx.push({ kind: "shockwave", x: 0, y: 0, color: "#80d8ff", text: id });
  }

  // The smart side to pick once a chute has been "solved": revealing either side
  // tells you which one is safe. Unknown forks are a pure 50/50.
  private pickSide(chuteId: number): 0 | 1 {
    const ch = this.chutes.find((s) => s.id === chuteId);
    if (!ch) return 0;
    const safe: 0 | 1 = ch.deathSide === 0 ? 1 : 0;
    if (ch.revealed[0] || ch.revealed[1]) return safe;
    return this.ctx.rng() < 0.5 ? 0 : 1;
  }

  // If nobody's still racing (all finished or dead), end the round now.
  private maybeFinishEarly(): void {
    const racers = [...this.climbers.values()].filter((c) => c.alive && !c.finished);
    if (racers.length === 0) this.finish();
  }

  tick(dt: number, _now: number): void {
    if (this.done) return;
    this.timeLeft = Math.max(0, this.timeLeft - dt);

    for (const c of this.climbers.values()) {
      if (c.rollCd > 0) c.rollCd = Math.max(0, c.rollCd - dt);
      if (c.dieShow > 0) c.dieShow = Math.max(0, c.dieShow - dt);
      if (!c.alive || c.finished) continue;
      if (c.choosing >= 0) {
        // humans pick for themselves; a bot dithers, then commits a (smart) guess
        if (!c.isBot) continue;
        c.botThink -= dt;
        if (c.botThink <= 0) this.choose(c.id, this.pickSide(c.choosing));
        continue;
      }
      // bots just keep rolling on their personal cadence
      if (c.isBot && c.rollCd <= 0) {
        this.roll(c.id);
        c.rollCd = c.botCadence; // override the flat cooldown with the bot's pace
      }
    }

    const racers = [...this.climbers.values()].filter((c) => c.alive && !c.finished);
    if (this.timeLeft <= 0 || racers.length === 0) this.finish();
  }

  // The buzzer / everyone resolved. Finishers reached the top and are SAFE.
  // Everyone still on the board "didn't make it to safety in time" and is culled
  // worst-first, scaled by intensity (gentle early, near-total late), but we always
  // leave at least one blob standing (the top climber survives if nobody topped out).
  private finish(): void {
    if (this.done) return;
    const finishers = [...this.climbers.values()].filter((c) => c.alive && c.finished);
    const strag = [...this.climbers.values()]
      .filter((c) => c.alive && !c.finished)
      .sort((a, b) => this.standing(a) - this.standing(b)); // worst first

    let spare = Math.round(strag.length * (1 - this.ctx.intensity) * 0.5);
    if (finishers.length === 0) spare = Math.max(spare, 1);
    const cut = Math.max(0, strag.length - spare);
    for (let i = 0; i < cut; i++) {
      const c = strag[i];
      c.alive = false;
      c.choosing = -1;
      const note = c.square <= 0 ? "Never left the start!" : `Didn't reach safety — stuck at ${c.square}`;
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
    c.choosing = -1;
    this.elimOrder.push({ id: playerId, note: "Rage-quit the board" });
    this.fx.push({ kind: "death", x: 0, y: 0, color: "#ff1744", text: playerId });
    this.maybeFinishEarly();
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
        // per side: -1 unknown, 0 = sends you back to start, 1 = abyss (death).
        chutes: this.chutes.map((c) => ({
          id: c.id,
          square: c.square,
          left: c.revealed[0] ? (c.deathSide === 0 ? 1 : 0) : -1,
          right: c.revealed[1] ? (c.deathSide === 1 ? 1 : 0) : -1,
        })),
        timeLeft: +this.timeLeft.toFixed(2),
        duration: this.duration,
        climbers: [...this.climbers.values()].map((c) => ({
          id: c.id,
          name: c.name,
          characterId: c.characterId,
          alive: c.alive,
          square: c.square,
          finished: c.finished,
          die: c.dieShow > 0 ? c.die : 0,
          choosing: c.choosing,
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
