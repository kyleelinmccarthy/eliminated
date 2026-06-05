import type { Minigame, GameContext, MinigameResult } from "./Minigame";
import { buildRanking } from "./Minigame";
import type { GameId, Snapshot, Effect } from "../../shared/types";
import type { GameInput } from "../../shared/protocol";
import { SIMON_COMMANDS, SIMON_FREEZE, SIMON_KEYS } from "../../shared/simon";

interface Contestant {
  id: string;
  name: string;
  characterId: string;
  isBot: boolean;
  alive: boolean;
  did: string | null; // what they pressed THIS beat (null = held still / nothing yet)
  result: "" | "safe" | "out"; // resolved verdict, shown during the judge phase
  survivedBeats: number;
  // bot brain
  skill: number; // 0..1, higher = faster + more accurate
  reaction: number; // base reaction delay (sec)
  recklessness: number; // 0..1, how twitchy on a FREEZE
  acted: boolean; // already committed an input this beat
  planDelay: number; // sec into the call window the bot will commit
  planKey: string | null; // the key the bot will press (null = stay still)
}

type Command = { key: string; label: string; emoji: string; freeze: boolean };

const READY_START = 0.95; // anticipation "Simon says…" beat (shrinks each round)
const READY_MIN = 0.5;
const WINDOW_START = 1.7; // reaction window while the order is shown
const WINDOW_MIN = 0.62;
const JUDGE_DUR = 1.15; // how long the verdict (✅ / 💥) lingers
const SPEEDUP = 0.92; // ready + window both shrink by this each beat

// A barking Game Master issues an order; do the matching move in time, or — on
// FREEZE — touch nothing at all. Wrong move, too slow, or a twitch on freeze =
// boxed up. It only gets faster.
export class SimonSays implements Minigame {
  id: GameId = "simonsays";
  private ctx: GameContext;
  private fx: Effect[] = [];
  private contestants = new Map<string, Contestant>();
  private phase: "ready" | "call" | "judge" = "ready";
  private phaseTime = 0;
  private readyCur = READY_START;
  private windowCur = WINDOW_START;
  private beat = 0;
  private command: Command = { ...SIMON_COMMANDS[0], freeze: false };
  private lastFreeze = false;
  private lastActionKey = "";
  private elapsed = 0;
  private done = false;
  private elimOrder: { id: string; note?: string }[] = [];
  private freezeChance = 0.24;
  private target = 1; // stop once this many remain
  private maxBeats = 16;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  start(): void {
    for (const p of this.ctx.players) {
      const skill = 0.25 + this.ctx.rng() * 0.7;
      this.contestants.set(p.id, {
        id: p.id,
        name: p.name,
        characterId: p.characterId,
        isBot: p.isBot,
        alive: true,
        did: null,
        result: "",
        survivedBeats: 0,
        skill,
        reaction: 0.55 - 0.3 * skill + this.ctx.rng() * 0.12,
        recklessness: this.ctx.rng(),
        acted: false,
        planDelay: 0,
        planKey: null,
      });
    }
    const n = this.ctx.players.length;
    this.target = Math.max(1, Math.ceil(n * (1 - 0.55 * this.ctx.intensity)));
    this.maxBeats = Math.round(10 + this.ctx.intensity * 18);
    this.freezeChance = 0.22 + 0.12 * this.ctx.intensity;
    this.ctx.toast("Simon says: obey instantly. Or else.", "info");
    this.beginBeat();
  }

  // ---- beat lifecycle ----
  private beginBeat(): void {
    this.beat++;
    this.readyCur = Math.max(READY_MIN, READY_START * Math.pow(SPEEDUP, this.beat - 1));
    this.windowCur = Math.max(WINDOW_MIN, WINDOW_START * Math.pow(SPEEDUP, this.beat - 1));
    this.command = this.chooseCommand();
    for (const c of this.contestants.values()) {
      c.did = null;
      c.result = "";
      c.acted = false;
      c.planDelay = 0;
      c.planKey = null;
    }
    this.phase = "ready";
    this.phaseTime = 0;
  }

  private chooseCommand(): Command {
    // never freeze on the very first order, and never twice in a row
    const canFreeze = this.beat > 1 && !this.lastFreeze;
    if (canFreeze && this.ctx.rng() < this.freezeChance) {
      this.lastFreeze = true;
      return { key: SIMON_FREEZE.key, label: SIMON_FREEZE.label, emoji: SIMON_FREEZE.emoji, freeze: true };
    }
    this.lastFreeze = false;
    let cmd = SIMON_COMMANDS[Math.floor(this.ctx.rng() * SIMON_COMMANDS.length)];
    // discourage repeating the same action back-to-back
    if (cmd.key === this.lastActionKey && this.ctx.rng() < 0.7) {
      cmd = SIMON_COMMANDS[Math.floor(this.ctx.rng() * SIMON_COMMANDS.length)];
    }
    this.lastActionKey = cmd.key;
    return { key: cmd.key, label: cmd.label, emoji: cmd.emoji, freeze: false };
  }

  private enterCall(): void {
    this.phase = "call";
    this.phaseTime = 0;
    this.planBots();
  }

  // Decide, the instant the order is revealed, what each bot will do and when.
  private planBots(): void {
    // panic 0 (roomy window) → 1 (window at its tightest)
    const panic = clamp01((WINDOW_START - this.windowCur) / (WINDOW_START - WINDOW_MIN));
    for (const c of this.contestants.values()) {
      if (!c.alive || !c.isBot) continue;
      const delay = c.reaction * (0.8 + this.ctx.rng() * 0.5);
      c.planDelay = delay;
      c.acted = false;
      if (this.command.freeze) {
        // mostly hold still; nerves (and reckless bots) cause a fatal twitch
        const twitchProb = clamp01((0.08 + 0.45 * panic) * (0.55 + 0.85 * c.recklessness));
        c.planKey = this.ctx.rng() < twitchProb ? this.randomKey() : null;
      } else if (delay >= this.windowCur) {
        c.planKey = null; // too slow — they'll miss the window entirely
      } else {
        const acc = clamp(0.78 + 0.2 * c.skill - 0.42 * panic, 0.12, 0.98);
        c.planKey = this.ctx.rng() < acc ? this.command.key : this.wrongKey(this.command.key);
      }
    }
  }

  private randomKey(): string {
    return SIMON_KEYS[Math.floor(this.ctx.rng() * SIMON_KEYS.length)];
  }

  private wrongKey(correct: string): string {
    const wrong = SIMON_KEYS.filter((k) => k !== correct);
    return wrong[Math.floor(this.ctx.rng() * wrong.length)];
  }

  onInput(playerId: string, input: GameInput): void {
    if (input.kind !== "choose") return;
    if (this.phase !== "call") return; // only the open reaction window counts
    if (!SIMON_KEYS.includes(input.value)) return;
    const c = this.contestants.get(playerId);
    if (!c || !c.alive || c.did !== null) return; // first press locks in
    c.did = input.value;
  }

  tick(dt: number, _now: number): void {
    if (this.done) return;
    this.elapsed += dt;
    this.phaseTime += dt;

    if (this.phase === "ready") {
      if (this.phaseTime >= this.readyCur) this.enterCall();
      return;
    }

    if (this.phase === "call") {
      // bots commit their planned input once their reaction delay elapses
      for (const c of this.contestants.values()) {
        if (!c.alive || !c.isBot || c.acted) continue;
        if (this.phaseTime >= c.planDelay) {
          c.acted = true;
          if (c.planKey !== null && c.did === null) c.did = c.planKey;
        }
      }
      if (this.phaseTime >= this.windowCur) this.resolve();
      return;
    }

    // judge
    if (this.phaseTime >= JUDGE_DUR) {
      if (this.shouldEnd()) this.done = true;
      else this.beginBeat();
    }
  }

  // Tally the order: who obeyed, who fumbled, who twitched on freeze.
  private resolve(): void {
    for (const c of this.contestants.values()) {
      if (!c.alive) continue;
      let survived: boolean;
      let note = "";
      if (this.command.freeze) {
        survived = c.did === null;
        if (!survived) note = "Twitched on FREEZE!";
      } else if (c.did === this.command.key) {
        survived = true;
      } else if (c.did === null) {
        survived = false;
        note = "Too slow!";
      } else {
        survived = false;
        note = "Wrong move!";
      }
      if (survived) {
        c.result = "safe";
        c.survivedBeats = this.beat;
      } else {
        c.result = "out";
        c.alive = false;
        this.elimOrder.push({ id: c.id, note });
        this.fx.push({ kind: "death", x: 0, y: 0, color: "#ff1744", text: c.id });
      }
    }
    this.phase = "judge";
    this.phaseTime = 0;
  }

  private shouldEnd(): boolean {
    const remaining = [...this.contestants.values()].filter((c) => c.alive).length;
    return remaining <= this.target || remaining <= 1 || this.beat >= this.maxBeats;
  }

  snapshot(now: number): Snapshot {
    const fx = this.fx;
    this.fx = [];
    // The order is kept secret during the "Simon says…" anticipation beat.
    const showCmd = this.phase !== "ready";
    return {
      game: this.id,
      t: now,
      data: {
        phase: this.phase,
        beat: this.beat,
        maxBeats: this.maxBeats,
        command: showCmd ? this.command : null,
        freeze: showCmd ? this.command.freeze : false,
        react: this.phase === "call" ? clamp01(this.phaseTime / this.windowCur) : 0,
        contestants: [...this.contestants.values()].map((c) => ({
          id: c.id,
          name: c.name,
          characterId: c.characterId,
          alive: c.alive,
          did: c.did,
          result: c.result,
        })),
      },
      fx,
    };
  }

  forfeit(playerId: string): void {
    const c = this.contestants.get(playerId);
    if (!c || !c.alive) return;
    c.alive = false;
    c.result = "out";
    this.elimOrder.push({ id: playerId, note: "Walked off mid-order" });
    this.fx.push({ kind: "death", x: 0, y: 0, color: "#ff1744", text: playerId });
    if (this.shouldEnd()) this.done = true;
  }

  isDone(): boolean {
    return this.done;
  }

  result(): MinigameResult {
    const survivors = [...this.contestants.values()].filter((c) => c.alive).map((c) => c.id);
    return { survivorIds: survivors, ranking: buildRanking(survivors, this.elimOrder) };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
