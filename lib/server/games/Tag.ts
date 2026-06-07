// Freeze Tag — asymmetric hunters vs runners (was team-vs-team; the old version
// left players unsure who froze whom and how to thaw). Now the roles are crisp:
//
//   🔵 BLUE = the freezers / "it". They chase and a touch FREEZES a pink runner
//      solid. Blue can't be frozen, and they glow (the `it` aura) so everyone can
//      see who the threat is. A freezer who catches NOBODY is eliminated at the
//      buzzer — so "it" can't just stand around.
//   🩷 PINK = the runners / prey. They can be frozen. An unfrozen runner THAWS a
//      frozen teammate by touching them — until the final DEEP FREEZE window,
//      when thawing stops and any runner still frozen at the buzzer is eliminated.

import { ArenaGame, type GameContext, type ArenaActor, type MinigameResult, buildRanking } from "./Minigame";
import type { GameId, Snapshot } from "../../shared/types";
import { ARENA_W, ARENA_H, PLAYER_RADIUS } from "../../shared/constants";
import { dist, shuffle } from "../../shared/util";
import { PowerupField } from "./Powerups";

const ROUND_TIME = 34;
const FREEZE_R = PLAYER_RADIUS * 2 - 4;
const THAW_R = PLAYER_RADIUS * 2 + 2;
const FREEZE_CD = 0.4; // a freezer can't chain-freeze instantly
const THAW_IMMUNE = 0.8; // a just-thawed runner gets a head start

const FREEZER = 0; // blue team — the hunters / "it"
const RUNNER = 1; // pink team — the prey

export class Tag extends ArenaGame {
  id: GameId = "tag";
  private timer = ROUND_TIME;
  private deepFreezeLen = 5;
  private deepFreeze = false;
  private powerups: PowerupField;
  private elimOrder: { id: string; note?: string }[] = [];

  constructor(ctx: GameContext) {
    super(ctx);
    this.powerups = new PowerupField(ctx.rng, { every: 2.5, max: 6, goodWeight: 0.55 });
  }

  start(): void {
    // Freeze Tag ran frantically fast — drop the chase speed below the shared
    // default so freezing and thawing read as deliberate moves, not a blur.
    this.speed = 175;
    const ps = shuffle(this.ctx.rng, this.ctx.players);
    ps.forEach((p, i) => {
      const team = i % 2; // 0 = blue freezer, 1 = pink runner
      // teams lean to opposite sides for clarity, but spread widely over each
      // half and the full height so the opening chase fans out across the whole
      // arena instead of two tight clumps that collapse into the middle.
      const side = team === FREEZER ? 0.3 : 0.7;
      const a = this.addActor(
        p,
        ARENA_W * side + (this.ctx.rng() - 0.5) * ARENA_W * 0.42,
        ARENA_H * (0.12 + this.ctx.rng() * 0.76),
      );
      a.team = team;
      a.it = team === FREEZER; // freezers glow as the threat — answers "who is it?"
      a.data!.freezeCd = 0;
      a.data!.immune = 0;
      a.data!.freezes = 0; // freezers must land at least one catch to be safe
      a.data!.roam = this.ctx.rng() * Math.PI * 2; // own juke/roam phase, so the pack fans out
    });
    this.deepFreezeLen = 3.5 + this.ctx.intensity * 4.5; // 3.5..8s
    this.ctx.toast("🔵 BLUE freezes the 🩷 PINK runners. Pink: touch a frozen friend to THAW them!", "info");
  }

  private aliveActors() {
    return [...this.actors.values()].filter((a) => a.alive);
  }

  // Runners still in play AND able to act (unfrozen). When this hits zero there's
  // nothing left to do — the round can resolve early.
  private freeRunners() {
    return this.aliveActors().filter((a) => a.team === RUNNER && !a.frozen);
  }

  tick(dt: number, _now: number): void {
    this.elapsed += dt;
    this.timer -= dt;
    this.deepFreeze = this.timer <= this.deepFreezeLen;
    this.powerups.tick(dt);

    for (const a of this.actors.values()) {
      if (!a.alive) continue;
      this.updateStatus(a, dt);
      if ((a.data!.freezeCd || 0) > 0) a.data!.freezeCd = Math.max(0, a.data!.freezeCd - dt);
      if ((a.data!.immune || 0) > 0) a.data!.immune = Math.max(0, a.data!.immune - dt);
      if (a.frozen) {
        a.inDx = 0;
        a.inDy = 0;
        a.anim = "fall";
        continue;
      }
      if (a.isBot) this.botThink(a);
      this.moveActor(a, dt);
      this.powerups.collect(a);
    }

    this.resolveContacts();

    if (this.timer <= 0) this.buzzer();
    // early end: no free runner remains (all frozen or already out) — let the
    // buzzer settle eliminations rather than spin the clock pointlessly.
    else if (this.freeRunners().length === 0) this.buzzer();
  }

  private resolveContacts(): void {
    const alive = this.aliveActors();
    // FREEZE: a blue freezer touching an unfrozen pink runner freezes them.
    for (const f of alive) {
      if (f.team !== FREEZER || (f.data!.freezeCd || 0) > 0) continue;
      for (const t of alive) {
        if (t.team !== RUNNER || t.frozen) continue;
        if ((t.data!.immune || 0) > 0) continue;
        if (dist(f.x, f.y, t.x, t.y) < FREEZE_R * Math.max(f.scale, t.scale)) {
          if (t.shield) {
            t.shield = false;
            this.boom("shockwave", t.x, t.y, { color: "#80d8ff" });
          } else {
            t.frozen = true;
            t.anim = "fall";
            t.inDx = 0;
            t.inDy = 0;
            this.boom("spark", t.x, t.y, { color: "#80d8ff" });
            this.boom("pickup", t.x, t.y - 30, { text: "FROZEN!", color: "#bbe9ff" });
          }
          // credit the catch (a popped shield still counts as making contact, so a
          // freezer isn't punished for chasing a shielded runner).
          f.data!.freezes = (f.data!.freezes || 0) + 1;
          f.data!.freezeCd = FREEZE_CD;
          break;
        }
      }
    }
    // THAW: outside deep freeze, an unfrozen runner frees a frozen teammate.
    if (!this.deepFreeze) {
      for (const r of alive) {
        if (r.team !== RUNNER || r.frozen) continue;
        for (const t of alive) {
          if (t === r || t.team !== RUNNER || !t.frozen) continue;
          if (dist(r.x, r.y, t.x, t.y) < THAW_R) {
            t.frozen = false;
            t.anim = "idle";
            t.data!.immune = THAW_IMMUNE;
            this.boom("poof", t.x, t.y, { color: "#69f0ae" });
            this.boom("pickup", t.x, t.y - 30, { text: "THAW!", color: "#b9f6ca" });
          }
        }
      }
    }
  }

  private buzzer(): void {
    if (this.done) return;
    const alive = this.aliveActors();
    const frozenRunners = alive.filter((a) => a.team === RUNNER && a.frozen);
    const idleFreezers = alive.filter((a) => a.team === FREEZER && (a.data!.freezes || 0) === 0);
    let doomed = [...frozenRunners, ...idleFreezers];
    // never wipe everyone: if every survivor is doomed, spare the first (thawing
    // them if they were a frozen runner) so the round always leaves a winner.
    if (doomed.length >= alive.length && alive.length > 0) {
      const spared = doomed[0];
      spared.frozen = false;
      doomed = doomed.slice(1);
    }
    for (const l of doomed) {
      l.alive = false;
      l.anim = "dead";
      const note = l.team === RUNNER ? "Frozen at the buzzer!" : "Caught nobody — frozen out!";
      this.elimOrder.push({ id: l.id, note });
      this.boom("death", l.x, l.y, { color: "#4fc3f7" });
      this.boom("splat", l.x, l.y, { color: "#81d4fa" });
    }
    const froze = frozenRunners.length;
    this.ctx.toast(
      doomed.length
        ? froze
          ? "BUZZ! ❄️ The frozen shatter — and the freezers who dozed off join them. Tragic. Anyway."
          : "BUZZ! The lazy freezers get boxed for catching nobody. Should've hustled."
        : "BUZZ! Everyone thawed and everyone hunted. Boring, but alive.",
      doomed.length ? "bad" : "good",
    );
    this.done = true;
  }

  private nearest(a: ArenaActor, list: ArenaActor[]): { best: ArenaActor | null; bd: number } {
    let best: ArenaActor | null = null;
    let bd = Infinity;
    for (const o of list) {
      const d = dist(a.x, a.y, o.x, o.y);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return { best, bd };
  }

  // A slow roaming drift for the rare idle beat (e.g. a freezer momentarily with
  // no prey in reach). Deliberately NOT a sin/cos spin — that's what read as
  // "spinning in place" in the lobby preview. Each blob carries its own phase
  // (data.roam) so idle blobs fan out across the floor instead of orbiting.
  private wander(a: ArenaActor): void {
    const t = this.elapsed * 0.6 + (a.data!.roam || 0);
    const tx = ARENA_W * (0.5 + 0.42 * Math.cos(t));
    const ty = ARENA_H * (0.5 + 0.42 * Math.sin(t * 1.3));
    a.inDx = (tx - a.x) / ARENA_W;
    a.inDy = (ty - a.y) / ARENA_H;
  }

  // Steer away from same-team neighbours inside `radius` — keeps a team from
  // collapsing into one blob. Returns an un-normalized steer vector.
  private spread(a: ArenaActor, mates: ArenaActor[], radius: number): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const o of mates) {
      if (o === a) continue;
      const dx = a.x - o.x;
      const dy = a.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.01 && d < radius) {
        const w = 1 - d / radius;
        x += (dx / d) * w;
        y += (dy / d) * w;
      }
    }
    return { x, y };
  }

  // Push back toward open floor when hugging a wall. Replaces the old hard pull to
  // center, which trapped fleeing runners in a stable merry-go-round around the
  // middle (the actual cause of the "just spins in place" preview).
  private offWalls(a: ArenaActor): { x: number; y: number } {
    const margin = 150;
    let x = 0;
    let y = 0;
    if (a.x < margin) x = 1 - a.x / margin;
    else if (a.x > ARENA_W - margin) x = -(1 - (ARENA_W - a.x) / margin);
    if (a.y < margin) y = 1 - a.y / margin;
    else if (a.y > ARENA_H - margin) y = -(1 - (ARENA_H - a.y) / margin);
    return { x, y };
  }

  private botThink(a: ArenaActor): void {
    const alive = this.aliveActors();
    if (a.team === FREEZER) {
      // hunt the nearest unfrozen runner, but fan off the other freezers so the
      // pack corners prey from several angles (and actually lands catches)
      // instead of stacking into one chasing dot.
      const prey = this.nearest(a, alive.filter((o) => o.team === RUNNER && !o.frozen));
      if (!prey.best) return this.wander(a);
      const dx = prey.best.x - a.x;
      const dy = prey.best.y - a.y;
      const m = Math.hypot(dx, dy) || 1;
      const sep = this.spread(a, alive.filter((o) => o.team === FREEZER), 220);
      a.inDx = dx / m + sep.x * 0.7;
      a.inDy = dy / m + sep.y * 0.7;
      return;
    }
    // runner: dart in to thaw a frozen teammate when it's clearly safe, else flee.
    const threat = this.nearest(a, alive.filter((o) => o.team === FREEZER));
    const rescue = this.nearest(a, alive.filter((o) => o.team === RUNNER && o.frozen && o !== a));
    if (!this.deepFreeze && rescue.best && rescue.bd < threat.bd) {
      const dx = rescue.best.x - a.x;
      const dy = rescue.best.y - a.y;
      const m = Math.hypot(dx, dy) || 1;
      a.inDx = dx / m;
      a.inDy = dy / m;
      return;
    }
    if (threat.best) {
      // flee straight away from the nearest freezer, plus: a perpendicular weave
      // so the dodge isn't a dead-straight line, separation from other runners so
      // prey don't pile into one spot, and a soft wall bounce. No pull to centre —
      // that's what trapped everyone in one orbiting clump (the "spin in place").
      const dx = a.x - threat.best.x;
      const dy = a.y - threat.best.y;
      const m = Math.hypot(dx, dy) || 1;
      const weave = Math.sin(this.elapsed * 1.8 + (a.data!.roam || 0)) * 0.5;
      const wall = this.offWalls(a);
      const sep = this.spread(a, alive.filter((o) => o.team === RUNNER && !o.frozen), 170);
      a.inDx = dx / m - (dy / m) * weave + wall.x * 0.9 + sep.x * 0.5;
      a.inDy = dy / m + (dx / m) * weave + wall.y * 0.9 + sep.y * 0.5;
      return;
    }
    this.wander(a);
  }

  snapshot(now: number): Snapshot {
    const alive = this.aliveActors();
    const teamCounts = [0, 0];
    for (const a of alive) if (a.team != null) teamCounts[a.team]++;
    return {
      game: this.id,
      t: now,
      actors: [...this.actors.values()].map((a) => this.toActor(a)),
      data: {
        timeLeft: Math.max(0, this.timer),
        deepFreeze: this.deepFreeze,
        frozen: alive.filter((a) => a.team === RUNNER && a.frozen).length,
        teamCounts, // [blue freezers alive, pink runners alive]
        freezerTeam: FREEZER,
        runnerTeam: RUNNER,
        night: this.ctx.night,
        pickups: this.powerups.snapshot(),
      },
      fx: this.drainFx(),
    };
  }

  result(): MinigameResult {
    const survivors = this.aliveActors().map((a) => a.id);
    return { survivorIds: survivors, ranking: buildRanking(survivors, this.elimOrder) };
  }
}
