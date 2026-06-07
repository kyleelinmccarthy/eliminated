import type { Minigame, GameContext, MinigameResult } from "./Minigame";
import type { GameId, Snapshot, Effect } from "../../shared/types";
import type { GameInput } from "../../shared/protocol";
import { shuffle } from "../../shared/util";

interface Puller {
  id: string;
  name: string;
  characterId: string;
  isBot: boolean;
  team: number;
  taps: number;
  botAccum: number;
  botRate: number; // taps/sec
  recentTapAt: number;
  tapWindow: number; // taps in current second (rate cap)
}

const WIN = 1.0;
const TIME_LIMIT = 30;
const TAP_IMPULSE = 1.0; // force per bot tap
const HUMAN_IMPULSE = 1.25; // a real player heaves harder than a bot, so your mashing carries a team — enough to overcome a one-player deficit, not enough to make headcount irrelevant
const DECAY = 0.8;
const SPEED = 0.05;
const MAX_TAPS_PER_SEC = 14;

// Two teams, one rope, one pit on each side. Mash to pull. The team dragged
// over the edge plummets.
export class TugOfWar implements Minigame {
  id: GameId = "tugofwar";
  private ctx: GameContext;
  private fx: Effect[] = [];
  private pullers = new Map<string, Puller>();
  private force = [0, 0];
  private ropePos = 0; // -1 (team1 wins) .. +1 (team0 wins)
  private elapsed = 0;
  private done = false;
  private loserTeam = -1;
  private secondTimer = 0;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  start(): void {
    const shuffled = shuffle(this.ctx.rng, this.ctx.players);
    shuffled.forEach((p, i) => {
      this.pullers.set(p.id, {
        id: p.id,
        name: p.name,
        characterId: p.characterId,
        isBot: p.isBot,
        team: i % 2,
        taps: 0,
        botAccum: 0,
        botRate: 5 + this.ctx.rng() * 2, // 5–7 taps/sec: tight enough that a match isn't decided by the bot-rate roll alone
        recentTapAt: 0,
        tapWindow: 0,
      });
    });
    this.ctx.toast("Heave! Mash to pull! Sacrifice your thumbs!", "info");
  }

  onInput(playerId: string, input: GameInput): void {
    if (input.kind !== "tap" && !(input.kind === "action" && input.name === "pull")) return;
    const p = this.pullers.get(playerId);
    if (!p) return;
    if (p.tapWindow >= MAX_TAPS_PER_SEC) return; // anti-macro cap
    p.tapWindow++;
    p.taps++;
    // real players pull harder than bots — only humans reach onInput (bots tap in tick)
    this.force[p.team] += p.isBot ? TAP_IMPULSE : HUMAN_IMPULSE;
  }

  tick(dt: number, _now: number): void {
    if (this.done) return;
    this.elapsed += dt;
    this.secondTimer += dt;
    if (this.secondTimer >= 1) {
      this.secondTimer = 0;
      for (const p of this.pullers.values()) p.tapWindow = 0;
    }

    // bots tap
    for (const p of this.pullers.values()) {
      if (!p.isBot) continue;
      p.botAccum += p.botRate * dt;
      while (p.botAccum >= 1) {
        p.botAccum -= 1;
        if (p.tapWindow < MAX_TAPS_PER_SEC) {
          p.tapWindow++;
          p.taps++;
          this.force[p.team] += TAP_IMPULSE;
        }
      }
    }

    // sqrt headcount scaling (Lanchester-style): more bodies still wins, but a
    // 4v3 is a modest edge (√4 vs √3 ≈ 15%) rather than the steamroll full
    // headcount would give — yet it's no longer worth *nothing* like 1/count was.
    const counts = [0, 0];
    for (const p of this.pullers.values()) counts[p.team]++;
    const norm0 = counts[0] ? 1 / Math.sqrt(counts[0]) : 0;
    const norm1 = counts[1] ? 1 / Math.sqrt(counts[1]) : 0;
    const net = this.force[0] * norm0 - this.force[1] * norm1;
    this.ropePos += net * SPEED * dt * 20;
    this.ropePos = Math.max(-1.4, Math.min(1.4, this.ropePos));
    this.force[0] *= DECAY;
    this.force[1] *= DECAY;

    if (this.ropePos >= WIN) this.finish(1);
    else if (this.ropePos <= -WIN) this.finish(0);
    else if (this.elapsed >= TIME_LIMIT) this.finish(this.ropePos >= 0 ? 1 : 0);
  }

  private finish(loserTeam: number) {
    this.loserTeam = loserTeam;
    this.done = true;
    this.fx.push({ kind: "death", x: loserTeam === 0 ? -1 : 1, y: 0, color: "#ff1744" });
    this.ctx.toast(`Team ${loserTeam + 1} takes the long way down. Bye!`, "bad");
  }

  snapshot(now: number): Snapshot {
    const fx = this.fx;
    this.fx = [];
    return {
      game: this.id,
      t: now,
      data: {
        ropePos: +this.ropePos.toFixed(3),
        timeLeft: Math.max(0, TIME_LIMIT - this.elapsed),
        loserTeam: this.loserTeam,
        pullers: [...this.pullers.values()].map((p) => ({
          id: p.id,
          name: p.name,
          characterId: p.characterId,
          team: p.team,
          taps: p.taps,
        })),
      },
      fx,
    };
  }

  forfeit(playerId: string): void {
    const p = this.pullers.get(playerId);
    if (!p) return;
    // drop them from the rope: they stop pulling and can't be a survivor. If
    // this empties their team, the per-capita force goes to zero and that side
    // loses on its own — no special-casing needed.
    this.pullers.delete(playerId);
    this.fx.push({ kind: "death", x: p.team === 0 ? -1 : 1, y: 0, color: "#ff1744" });
  }

  isDone(): boolean {
    return this.done;
  }

  result(): MinigameResult {
    const all = [...this.pullers.values()];
    const winners = all.filter((p) => p.team !== this.loserTeam);
    const losers = all.filter((p) => p.team === this.loserTeam).sort((a, b) => b.taps - a.taps);
    const ranking: MinigameResult["ranking"] = [];
    let place = 1;
    // winners ranked by taps (MVP first)
    for (const p of [...winners].sort((a, b) => b.taps - a.taps))
      ranking.push({ playerId: p.id, survived: true, placement: place++ });
    for (const p of losers)
      ranking.push({ playerId: p.id, survived: false, placement: place++, note: "Pulled into the pit" });
    return { survivorIds: winners.map((p) => p.id), ranking };
  }
}
