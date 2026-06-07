import type { Minigame, GameContext, MinigameResult } from "./Minigame";
import { crownOne } from "./Minigame";
import type { GameId, Snapshot, Effect } from "../../shared/types";
import type { GameInput } from "../../shared/protocol";
import { shuffle } from "../../shared/util";

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
  pos: number; // planks crossed so far (0..bridgeLen)
  crossed: boolean; // reached the far platform — safe, off the rope
  crossedAt: number; // swing on which they made it across (for ranking)
}

const JUMP_DUR = 460; // ms airborne
const START_PERIOD = 1.7;
const MIN_PERIOD = 0.62;
const SPEEDUP = 0.945;
const MAX_SWINGS = 30;

// A giant rope sweeps the deck of a bridge over a pit. Every clean jump carries
// you one plank further across; mistime it and you're swept off into the dark.
// Reach the far side and you're safe. The rope only gets faster.
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
  private bridgeLen = 12; // clean jumps needed to cross to safety
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
        pos: 0,
        crossed: false,
        crossedAt: 0,
      });
    }
    // gentler early in a series: fewer swings, an extra freebie, keep more alive.
    // As the decisive finale, skip down to a single jumper (with the swings to
    // get there).
    const n = this.ctx.players.length;
    this.target = this.ctx.forceSingleSurvivor ? 1 : Math.max(1, Math.ceil(n * (1 - 0.55 * this.ctx.intensity)));
    this.maxSwings = this.ctx.forceSingleSurvivor ? Math.max(28, n * 5) : Math.round(8 + this.ctx.intensity * 22);
    this.graceSwings = this.ctx.intensity < 0.4 ? 2 : 1;
    // The bridge is short enough that the swift can reach safety before the rope
    // tops out — but long enough the speed-up still claims the slow. It scales
    // with the round's length so a gentle opener is a quick hop across and the
    // finale is a real gauntlet.
    this.bridgeLen = Math.max(8, Math.round(this.maxSwings * 0.75));
    // Stagger the pack so it crosses as a strung-out line instead of one clump
    // moving in lockstep. Each jumper gets a small, luck-of-the-draw head start —
    // a random starting plank, spread evenly across the near end of the bridge.
    // The whole line still advances together each swing, but the leaders reach
    // safety several swings ahead of the stragglers. Kept small (and capped) so
    // the starting lane is mostly flavour, not a decisive advantage.
    const spread = Math.max(2, Math.min(6, this.bridgeLen - 2, Math.round(this.bridgeLen * 0.3)));
    const lineup = shuffle(this.ctx.rng, [...this.jumpers.values()]);
    const denom = Math.max(1, lineup.length - 1);
    lineup.forEach((j, i) => {
      j.pos = Math.round((i / denom) * spread);
    });
    this.ctx.toast("Jump the rope to cross the bridge. Get to the far side.", "info");
  }

  onInput(playerId: string, input: GameInput): void {
    if (input.kind !== "tap" && !(input.kind === "action" && input.name === "jump")) return;
    this.jump(playerId);
  }

  private jump(id: string) {
    const j = this.jumpers.get(id);
    if (!j || !j.alive || j.crossed) return;
    if (this.now < j.airborneUntil) return; // already airborne
    j.airborneUntil = this.now + JUMP_DUR;
    j.lastJump = this.now;
  }

  tick(dt: number, now: number): void {
    if (this.done) return;
    this.now = now || this.now + dt * 1000;

    // bots
    for (const j of this.jumpers.values()) {
      if (!j.alive || j.crossed || !j.isBot) continue;
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
    // only those still on the bridge are at the mercy of the rope
    const onDeck = [...this.jumpers.values()].filter((j) => j.alive && !j.crossed);
    for (const j of onDeck) {
      const airborne = this.now < j.airborneUntil;
      if (airborne) {
        // cleared it — one plank closer to the far side
        j.pos += 1;
        if (j.pos >= this.bridgeLen) {
          j.crossed = true;
          j.crossedAt = this.swing;
          this.fx.push({ kind: "confetti", x: 0, y: 0, text: j.id });
          this.fx.push({ kind: "spark", x: 0, y: 0, color: "#69f0ae", text: j.id });
        }
      } else if (!free) {
        // caught flat-footed — swept off the bridge
        j.alive = false;
        this.elimOrder.push({ id: j.id, note: `Swept off the bridge on plank ${Math.floor(j.pos) + 1}` });
        this.fx.push({ kind: "death", x: 0, y: 0, color: "#ff1744", text: j.id });
        this.fx.push({ kind: "splat", x: 0, y: 0, color: "#ff7043", text: j.id });
      }
      // a flat-footed swing during the grace passes is a free stumble: no plank,
      // no death.
    }
    this.fx.push({ kind: "shockwave", x: 0, y: 0, color: "#ffd54f" });
    const aliveAll = [...this.jumpers.values()].filter((j) => j.alive);
    const stillCrossing = aliveAll.filter((j) => !j.crossed);
    // stop when the cull target is met, when everyone left has made it across, or
    // at the buzzer.
    if (aliveAll.length <= this.target || aliveAll.length <= 1 || stillCrossing.length === 0 || this.swing >= this.maxSwings) {
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
        phase: +this.phase.toFixed(3),
        period: +this.period.toFixed(3),
        swing: this.swing,
        bridgeLen: this.bridgeLen,
        grace: Math.max(0, this.graceSwings - this.swing),
        jumpers: [...this.jumpers.values()].map((j) => ({
          id: j.id,
          name: j.name,
          characterId: j.characterId,
          alive: j.alive,
          airborne: this.now < j.airborneUntil,
          pos: j.pos,
          crossed: j.crossed,
        })),
      },
      fx,
    };
  }

  forfeit(playerId: string): void {
    const j = this.jumpers.get(playerId);
    if (!j || !j.alive) return;
    j.alive = false;
    this.elimOrder.push({ id: playerId, note: `Bailed off the bridge on plank ${Math.floor(j.pos) + 1}` });
    this.fx.push({ kind: "death", x: 0, y: 0, color: "#ff1744", text: playerId });
    // ending early if a quit drops us to the survivor target
    const aliveAll = [...this.jumpers.values()].filter((x) => x.alive);
    const stillCrossing = aliveAll.filter((x) => !x.crossed);
    if (aliveAll.length <= this.target || aliveAll.length <= 1 || stillCrossing.length === 0) this.done = true;
  }

  isDone(): boolean {
    return this.done;
  }

  result(): MinigameResult {
    // those who reached the far side rank first (earliest crossing best); anyone
    // still on the bridge at the buzzer is ranked by how far they got.
    const survivors = [...this.jumpers.values()]
      .filter((j) => j.alive)
      .sort((a, b) => {
        if (a.crossed !== b.crossed) return a.crossed ? -1 : 1;
        if (a.crossed && b.crossed) return a.crossedAt - b.crossedAt;
        return b.pos - a.pos;
      })
      .map((j) => j.id);
    return crownOne(survivors, this.elimOrder, this.ctx.forceSingleSurvivor, "Still on the bridge at the buzzer");
  }
}
