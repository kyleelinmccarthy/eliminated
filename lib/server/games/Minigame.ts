// Minigame framework: the contract every game implements, plus an `ArenaGame`
// base class that handles top-down movement, wall collision, and snapshotting
// for the field-based games (red light, tag, mingle, boomerang).

import type { GameId, Snapshot, Effect, Actor } from "../../shared/types";
import type { GameInput } from "../../shared/protocol";
import type { GameMap } from "../../shared/maps";
import {
  ARENA_W,
  ARENA_H,
  PLAYER_RADIUS,
  PLAYER_SPEED,
} from "../../shared/constants";
import { clamp, type Rng } from "../../shared/util";

// Night-mode flashlight sizing (arena units). The 🔦 Lantern powerup widens it.
export const NIGHT_BASE_VISION = 250;
export const NIGHT_LANTERN_BONUS = 320;

export interface GamePlayer {
  id: string;
  name: string;
  characterId: string;
  isBot: boolean;
}

export interface GameContext {
  players: GamePlayer[];
  map: GameMap;
  rng: Rng;
  friendlyFire: boolean;
  emitFx: (fx: Effect) => void;
  toast: (msg: string, kind?: "info" | "good" | "bad") => void;
  // ---- series awareness (lets a game scale its harshness to where it is) ----
  roundIndex: number; // 0-based completed rounds before this one
  totalRounds: number;
  isFinale: boolean; // climactic last game of the series
  intensity: number; // 0..1 cull strength (gentle opener -> harsh late)
  night: boolean; // dark round (flashlight + vision powerups)
}

export interface RankEntry {
  playerId: string;
  survived: boolean;
  placement: number; // 1 = best
  note?: string;
}

export interface MinigameResult {
  survivorIds: string[];
  ranking: RankEntry[];
}

export interface Minigame {
  id: GameId;
  start(): void;
  onInput(playerId: string, input: GameInput): void;
  tick(dt: number, now: number): void;
  snapshot(now: number): Snapshot;
  isDone(): boolean;
  result(): MinigameResult;
  // Remove a player mid-game (they rage-quit / left / got kicked): they die
  // where they stand, so a quitter can't win by idling and the survivors get to
  // watch them get boxed up. No-op if the player isn't (or is no longer) in play.
  forfeit(playerId: string): void;
}

// ---- Shared actor state for arena (movement) games ----
export interface ArenaActor {
  id: string;
  name: string;
  characterId: string;
  isBot: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  alive: boolean;
  // latest movement intent (normalized -1..1)
  inDx: number;
  inDy: number;
  scale: number;
  shield: boolean;
  ghost: boolean;
  frozen?: boolean; // freeze tag
  burning?: boolean; // floor-is-lava
  flash: number;
  anim: string;
  // per-game scratch
  it?: boolean;
  team?: number;
  carrying?: string;
  progress?: number;
  data?: Record<string, number>; // free numeric scratch for bot ai / status timers
}

export abstract class ArenaGame implements Minigame {
  abstract id: GameId;
  ctx: GameContext;
  actors = new Map<string, ArenaActor>();
  fx: Effect[] = [];
  elapsed = 0;
  done = false;
  protected speed = PLAYER_SPEED;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  protected addActor(p: GamePlayer, x: number, y: number): ArenaActor {
    const a: ArenaActor = {
      id: p.id,
      name: p.name,
      characterId: p.characterId,
      isBot: p.isBot,
      x,
      y,
      vx: 0,
      vy: 0,
      facing: -Math.PI / 2,
      alive: true,
      inDx: 0,
      inDy: 0,
      scale: 1,
      shield: false,
      ghost: false,
      flash: 0,
      anim: "idle",
      data: {},
    };
    this.actors.set(p.id, a);
    return a;
  }

  onInput(playerId: string, input: GameInput): void {
    const a = this.actors.get(playerId);
    if (!a || !a.alive) return;
    if (input.kind === "move") {
      a.inDx = clamp(input.dx, -1, 1);
      a.inDy = clamp(input.dy, -1, 1);
    } else {
      this.onAction(a, input);
    }
  }

  // games override to handle non-move inputs (throw, dash, etc.)
  protected onAction(_a: ArenaActor, _input: GameInput): void {}

  // Default mid-game removal for arena games: kill the actor in place with a
  // death poof, and clear role flags (it / frozen) so a quitter doesn't leave
  // the round in a weird state. Subclasses can override for extra bookkeeping.
  forfeit(playerId: string): void {
    const a = this.actors.get(playerId);
    if (!a || !a.alive) return;
    a.alive = false;
    a.it = false;
    a.frozen = false;
    a.inDx = 0;
    a.inDy = 0;
    a.anim = "dead";
    this.boom("death", a.x, a.y, { color: "#ff1744" });
  }

  // status speed multiplier from shared powerup timers (⚡ Zoomies / 🐌 Molasses).
  // Keys are `pu`-prefixed so they never collide with a game's own scratch (e.g.
  // Boomerang has its own speedT/tinyT).
  protected statusSpeedMul(a: ArenaActor): number {
    const d = a.data;
    let m = 1;
    if (d && (d.puSpeedT || 0) > 0) m *= 1.6;
    if (d && (d.puSlowT || 0) > 0) m *= 0.5;
    return m;
  }

  // tick down powerup status timers and revert size effects on expiry. Call once
  // per alive actor per tick (before moveActor) in games that use powerups.
  protected updateStatus(a: ArenaActor, dt: number): void {
    const d = a.data;
    if (!d) return;
    for (const k of ["puSpeedT", "puSlowT", "puReverseT", "puDizzyT", "puVisionT"] as const) {
      if ((d[k] || 0) > 0) d[k] = Math.max(0, (d[k] as number) - dt);
    }
    if ((d.puTinyT || 0) > 0) {
      d.puTinyT -= dt;
      if (d.puTinyT <= 0) a.scale = 1;
    }
    if ((d.puGiantT || 0) > 0) {
      d.puGiantT -= dt;
      if (d.puGiantT <= 0) a.scale = 1;
    }
  }

  // integrate movement for one actor (call from tick); honors per-actor speed
  // and powerup status (speed/slow, 🌀 reversed controls, 💫 dizzy drift)
  protected moveActor(a: ArenaActor, dt: number, speedMul = 1): void {
    // tiny blobs get a nimbleness bonus; giant (🎈) blobs lumber (a downside)
    const sizeMul = a.scale < 1 ? 1.15 : a.scale > 1.2 ? 0.62 : 1;
    const sp = this.speed * speedMul * this.statusSpeedMul(a) * a.scale * sizeMul;
    let dx = a.inDx;
    let dy = a.inDy;
    const d = a.data;
    if (d && (d.puReverseT || 0) > 0) {
      dx = -dx;
      dy = -dy;
    }
    if (d && (d.puDizzyT || 0) > 0) {
      const wob = Math.sin(this.elapsed * 6 + (a.x + a.y) * 0.01) * 0.9;
      const c = Math.cos(wob);
      const s = Math.sin(wob);
      const ndx = dx * c - dy * s;
      const ndy = dx * s + dy * c;
      dx = ndx;
      dy = ndy;
    }
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    a.vx = dx * sp;
    a.vy = dy * sp;
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    const r = PLAYER_RADIUS * a.scale;
    a.x = clamp(a.x, r, ARENA_W - r);
    a.y = clamp(a.y, r, ARENA_H - r);
    if (m > 0.05) {
      a.facing = Math.atan2(dy, dx);
      a.anim = "run";
    } else {
      a.anim = "idle";
    }
    if (a.flash > 0) a.flash = Math.max(0, a.flash - dt * 3);
  }

  protected toActor(a: ArenaActor): Actor {
    return {
      id: a.id,
      x: Math.round(a.x),
      y: Math.round(a.y),
      vx: Math.round(a.vx),
      vy: Math.round(a.vy),
      facing: +a.facing.toFixed(2),
      characterId: a.characterId,
      name: a.name,
      alive: a.alive,
      it: a.it,
      team: a.team,
      carrying: a.carrying,
      scale: a.scale === 1 ? undefined : +a.scale.toFixed(2),
      ghost: a.ghost || undefined,
      shield: a.shield || undefined,
      frozen: a.frozen || undefined,
      burning: a.burning || undefined,
      vision: this.ctx.night
        ? Math.round(NIGHT_BASE_VISION + ((a.data?.puVisionT || 0) > 0 ? NIGHT_LANTERN_BONUS : 0))
        : undefined,
      flash: a.flash > 0.01 ? +a.flash.toFixed(2) : undefined,
      anim: a.anim,
      progress: a.progress,
    };
  }

  protected drainFx(): Effect[] {
    if (this.fx.length === 0) return [];
    const out = this.fx;
    this.fx = [];
    return out;
  }

  protected boom(kind: Effect["kind"], x: number, y: number, extra: Partial<Effect> = {}) {
    this.fx.push({ kind, x: Math.round(x), y: Math.round(y), ...extra });
  }

  abstract start(): void;
  abstract tick(dt: number, now: number): void;
  abstract snapshot(now: number): Snapshot;
  abstract result(): MinigameResult;

  isDone(): boolean {
    return this.done;
  }
}

// helper for building a default ranking: survivors first (placement by order),
// then the eliminated (in elimination order, latest-out ranked higher).
export function buildRanking(
  survivorIds: string[],
  eliminatedInOrder: { id: string; note?: string }[],
): RankEntry[] {
  const ranking: RankEntry[] = [];
  let place = 1;
  for (const id of survivorIds) {
    ranking.push({ playerId: id, survived: true, placement: place++ });
  }
  // eliminatedInOrder is earliest-out first; later-out deserve better placement
  const elimBest = [...eliminatedInOrder].reverse();
  for (const e of elimBest) {
    ranking.push({ playerId: e.id, survived: false, placement: place++, note: e.note });
  }
  return ranking;
}
