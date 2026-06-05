import type { Minigame, GameContext, MinigameResult } from "./Minigame";
import type { GameId, Snapshot, Effect } from "../../shared/types";
import type { GameInput } from "../../shared/protocol";

interface Jumper {
  id: string;
  name: string;
  characterId: string;
  isBot: boolean;
  alive: boolean;
  airborneUntil: number; // ms
  lastJump: number;
  botLead: number; // seconds before ground to jump
  botSkill: number; // timing error stddev (sec)
  survivedSwings: number;
}

const JUMP_DUR = 460; // ms airborne
const START_PERIOD = 1.7;
const MIN_PERIOD = 0.62;
const SPEEDUP = 0.945;
const MAX_SWINGS = 30;

// A giant rope sweeps the floor. Jump as it passes. It only gets faster.
export class JumpRope implements Minigame {
  id: GameId = "jumprope";
  private ctx: GameContext;
  private fx: Effect[] = [];
  private jumpers = new Map<string, Jumper>();
  private phase = 0;
  private period = START_PERIOD;
  private swing = 0;
  private now = 0;
  private done = false;
  private graceSwings = 1; // first pass is a freebie
  private maxSwings = MAX_SWINGS;
  private target = 1; // stop once this many remain
  private elimOrder: { id: string; note?: string }[] = [];

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  start(): void {
    for (const p of this.ctx.players) {
      this.jumpers.set(p.id, {
        id: p.id,
        name: p.name,
        characterId: p.characterId,
        isBot: p.isBot,
        alive: true,
        airborneUntil: 0,
        lastJump: 0,
        botLead: 0.2 + this.ctx.rng() * 0.06,
        botSkill: 0.02 + this.ctx.rng() * 0.07,
        survivedSwings: 0,
      });
    }
    // gentler early in a series: fewer swings, an extra freebie, keep more alive
    const n = this.ctx.players.length;
    this.target = Math.max(1, Math.ceil(n * (1 - 0.55 * this.ctx.intensity)));
    this.maxSwings = Math.round(8 + this.ctx.intensity * 22);
    this.graceSwings = this.ctx.intensity < 0.4 ? 2 : 1;
    this.ctx.toast("Jump on the beat. The rope is not negotiating.", "info");
  }

  onInput(playerId: string, input: GameInput): void {
    if (input.kind !== "tap" && !(input.kind === "action" && input.name === "jump")) return;
    this.jump(playerId);
  }

  private jump(id: string) {
    const j = this.jumpers.get(id);
    if (!j || !j.alive) return;
    if (this.now < j.airborneUntil) return; // already airborne
    j.airborneUntil = this.now + JUMP_DUR;
    j.lastJump = this.now;
  }

  tick(dt: number, now: number): void {
    if (this.done) return;
    this.now = now || this.now + dt * 1000;

    // bots
    for (const j of this.jumpers.values()) {
      if (!j.alive || !j.isBot) continue;
      if (this.now < j.airborneUntil) continue;
      const timeToGround = (1 - this.phase) * this.period;
      const target = j.botLead + (this.ctx.rng() - 0.5) * 2 * j.botSkill * (START_PERIOD / this.period);
      if (timeToGround <= target) this.jump(j.id);
    }

    const prev = this.phase;
    this.phase += dt / this.period;
    if (this.phase >= 1) {
      this.phase -= 1;
      this.groundPass();
    }
    void prev;
  }

  private groundPass() {
    this.swing++;
    this.period = Math.max(MIN_PERIOD, this.period * SPEEDUP);
    const free = this.swing <= this.graceSwings;
    const alive = [...this.jumpers.values()].filter((j) => j.alive);
    for (const j of alive) {
      const airborne = this.now < j.airborneUntil;
      if (!airborne && !free) {
        j.alive = false;
        this.elimOrder.push({ id: j.id, note: `Tripped on swing ${this.swing}` });
        this.fx.push({ kind: "death", x: 0, y: 0, color: "#ff1744", text: j.id });
        this.fx.push({ kind: "splat", x: 0, y: 0, color: "#ff7043", text: j.id });
      } else {
        j.survivedSwings = this.swing;
      }
    }
    this.fx.push({ kind: "shockwave", x: 0, y: 0, color: "#ffd54f" });
    const remaining = [...this.jumpers.values()].filter((j) => j.alive);
    if (remaining.length <= this.target || remaining.length <= 1 || this.swing >= this.maxSwings) this.done = true;
  }

  snapshot(now: number): Snapshot {
    const fx = this.fx;
    this.fx = [];
    return {
      game: this.id,
      t: now,
      data: {
        phase: +this.phase.toFixed(3),
        period: +this.period.toFixed(3),
        swing: this.swing,
        jumpers: [...this.jumpers.values()].map((j) => ({
          id: j.id,
          name: j.name,
          characterId: j.characterId,
          alive: j.alive,
          airborne: this.now < j.airborneUntil,
        })),
      },
      fx,
    };
  }

  forfeit(playerId: string): void {
    const j = this.jumpers.get(playerId);
    if (!j || !j.alive) return;
    j.alive = false;
    this.elimOrder.push({ id: playerId, note: `Quit on swing ${this.swing + 1}` });
    this.fx.push({ kind: "death", x: 0, y: 0, color: "#ff1744", text: playerId });
    // ending early if a quit drops us to the survivor target
    const remaining = [...this.jumpers.values()].filter((x) => x.alive);
    if (remaining.length <= this.target || remaining.length <= 1) this.done = true;
  }

  isDone(): boolean {
    return this.done;
  }

  result(): MinigameResult {
    const survivors = [...this.jumpers.values()].filter((j) => j.alive).map((j) => j.id);
    const ranking: MinigameResult["ranking"] = [];
    let place = 1;
    for (const id of survivors) ranking.push({ playerId: id, survived: true, placement: place++ });
    const losers = [...this.jumpers.values()].filter((j) => !j.alive).sort((a, b) => b.survivedSwings - a.survivedSwings);
    for (const j of losers)
      ranking.push({ playerId: j.id, survived: false, placement: place++, note: `Tripped on swing ${j.survivedSwings + 1}` });
    return { survivorIds: survivors, ranking };
  }
}
