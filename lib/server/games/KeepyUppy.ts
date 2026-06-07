// Keepy Uppy — every blob is handed one balloon in their own colors and a single
// instruction: don't let it touch the floor and don't let it get popped. Walk
// under your balloon and your body auto-bats it skyward; the catch is the air
// keeps thickening (gravity + a wandering wind both ramp up), so a balloon left
// alone drifts off and sinks. The twist on "keep it up *as a group*" is the SPIKE
// — a brief jab that bursts a RIVAL's balloon on contact (your own pin can't pop
// your own balloon), so the real game is juggling yours while popping the
// neighbors'. Balloon hits the floor or gets popped → its owner is eliminated. A
// 🛡️ shield is a one-time save; the last balloon flying can't be popped. Survive
// to the buzzer.

import { ArenaGame, crownOne, type GameContext, type ArenaActor, type MinigameResult } from "./Minigame";
import type { GameId, Snapshot } from "../../shared/types";
import type { GameInput } from "../../shared/protocol";
import { ARENA_W, ARENA_H, PLAYER_RADIUS } from "../../shared/constants";
import { dist, clamp } from "../../shared/util";
import { getCharacter } from "../../shared/characters";
import { PowerupField } from "./Powerups";

const TIME_CAP = 38; // seconds; survivors at the buzzer all live
const BALLOON_R = 30;

// vertical: a bat lifts the balloon up to -BAT_VY; gravity (ramping) + drag pull
// it back down toward a slow terminal velocity, so it floats in a catchable band
// rather than slamming the ceiling.
const BAT_VY = 215; // upward speed imparted by a bat
const BAT_PUSH = 80; // sideways shove along the contact normal
const G0 = 175; // gravity accel at the start of the round
const G1 = 540; // ...and by the buzzer (a fast fall punishes a mis-positioned juggler)
const DRAG_Y = 1.7; // vertical air drag (per second) → terminal vy ≈ g / DRAG_Y
const DRAG_X = 0.9; // horizontal air drag

// a wandering wind that grows over the round and shoves balloons toward the walls
const WIND0 = 24;
const WIND1 = 150;

const SPIKE_DUR = 0.32; // seconds the pin is "out" (contact pops instead of bats)
const SPIKE_CD = 1.3; // cooldown between spikes
const SPIKE_LUNGE = 1.5; // brief forward speed boost while jabbing
const MAX_BSPEED = 620; // clamp balloon velocity so collisions never explode

interface Balloon {
  owner: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  popped: boolean;
}

export class KeepyUppy extends ArenaGame {
  id: GameId = "keepyuppy";
  private balloons = new Map<string, Balloon>();
  private powerups: PowerupField;
  private elimOrder: { id: string; note?: string }[] = [];
  private windPhase = 0;
  private gravity = G0;
  private windX = 0;
  private windY = 0;
  private turb = 40; // gust turbulence amplitude (ramps up — punishes laggy tracking)

  constructor(ctx: GameContext) {
    super(ctx);
    // mostly-helpful field: a 🛡️ shield is a balloon save, speed/tiny help you
    // chase a drifting balloon, giant turns you into a bigger paddle (but slower).
    this.powerups = new PowerupField(ctx.rng, { every: 2.8, max: 5, goodWeight: 0.7, margin: 140 });
  }

  start(): void {
    const ps = this.ctx.players;
    const n = ps.length;
    ps.forEach((p, i) => {
      // even columns across the lower band, each blob standing under its own
      // balloon (which hovers at a comfortable mid-height with room above it)
      const x = ARENA_W * ((i + 0.5) / n);
      const a = this.addActor(p, x, ARENA_H * 0.66);
      a.data!.spikeT = 0;
      a.data!.spikeCd = 0;
      if (a.isBot) {
        a.data!.skill = 0.2 + this.ctx.rng() * 0.75; // how sharp its juggling / aim is
        a.data!.react = 0; // reaction lag accumulator
        a.data!.aggro = this.ctx.rng() < 0.4 ? this.ctx.rng() : 0; // most bots never hunt
        a.data!.homeY = ARENA_H * (0.58 + this.ctx.rng() * 0.08); // patrol row (don't chase to the ceiling)
      }
      this.balloons.set(p.id, {
        owner: p.id,
        x,
        y: ARENA_H * 0.32,
        vx: (this.ctx.rng() - 0.5) * 30,
        vy: 0,
        color: getCharacter(p.characterId).body,
        popped: false,
      });
    });
    this.ctx.toast("🎈 Keep YOUR balloon up — bump it to bat it, SPIKE to pop theirs!", "info");
  }

  private aliveActors() {
    return [...this.actors.values()].filter((a) => a.alive);
  }

  protected onAction(a: ArenaActor, input: GameInput): void {
    // SPIKE — accept a few action names + a generic tap so any control surface works
    if (input.kind === "tap") {
      this.trySpike(a);
    } else if (input.kind === "action" && ["spike", "throw", "dash"].includes(input.name)) {
      this.trySpike(a);
    }
  }

  private trySpike(a: ArenaActor): void {
    if (!a.alive) return;
    const d = a.data!;
    if ((d.spikeCd || 0) > 0 || (d.spikeT || 0) > 0) return;
    d.spikeT = SPIKE_DUR;
    d.spikeCd = SPIKE_CD;
    this.boom("spark", a.x + Math.cos(a.facing) * 30, a.y + Math.sin(a.facing) * 30, { color: "#ffd54f" });
  }

  // mid-game removal: pop the quitter's balloon too so it doesn't hang there
  forfeit(playerId: string): void {
    super.forfeit(playerId);
    const b = this.balloons.get(playerId);
    if (b) b.popped = true;
    this.balloons.delete(playerId);
  }

  tick(dt: number, _now: number): void {
    this.elapsed += dt;
    const p = Math.min(1, this.elapsed / TIME_CAP);
    // the air thickens as the round wears on, scaled by where we are in the series
    this.gravity = (G0 + (G1 - G0) * p) * (0.85 + 0.3 * this.ctx.intensity);
    const windAmp = (WIND0 + (WIND1 - WIND0) * p) * (0.7 + 0.6 * this.ctx.intensity);
    // gusts speed up and bite harder as the round wears on; a frame-perfect juggler
    // corrects within a tick, but anyone tracking a stale target gets left behind
    this.windPhase += dt * (0.5 + 1.4 * p);
    this.windX = Math.cos(this.windPhase) * windAmp;
    this.windY = Math.sin(this.windPhase * 1.7) * windAmp * 0.25;
    this.turb = (40 + 230 * p) * (0.7 + 0.6 * this.ctx.intensity);

    this.powerups.tick(dt);

    for (const a of this.actors.values()) {
      if (!a.alive) continue;
      this.updateStatus(a, dt);
      const d = a.data!;
      if ((d.spikeT || 0) > 0) d.spikeT = Math.max(0, d.spikeT - dt);
      if ((d.spikeCd || 0) > 0) d.spikeCd = Math.max(0, d.spikeCd - dt);
      if (a.isBot) this.botThink(a, dt);
      // a jab lunges the blob forward a touch for game feel
      this.moveActor(a, dt, (d.spikeT || 0) > 0 ? SPIKE_LUNGE : 1);
      a.progress = (d.spikeT || 0) > 0 ? clamp(d.spikeT / SPIKE_DUR, 0, 1) : undefined;
      const pk = this.powerups.collect(a);
      if (pk) this.boom("pickup", a.x, a.y - 30, { color: "#b9f6ca" });
    }

    this.updateBalloons(dt);
    this.resolveContacts();
    this.collideBalloons();
    this.checkFloors();

    if (this.aliveActors().length <= 1 || this.elapsed >= TIME_CAP) this.done = true;
  }

  private updateBalloons(dt: number): void {
    for (const b of this.balloons.values()) {
      if (b.popped) continue;
      // gravity + wind + per-balloon turbulence that ramps up over the round, so a
      // settled balloon won't just hover forever — late on it skitters unpredictably
      b.vy += this.gravity * dt + this.windY * dt + (this.ctx.rng() - 0.5) * this.turb * 0.25 * dt;
      b.vx += this.windX * dt + (this.ctx.rng() - 0.5) * this.turb * dt;
      // air drag → floaty terminal velocity
      b.vy *= Math.max(0, 1 - DRAG_Y * dt);
      b.vx *= Math.max(0, 1 - DRAG_X * dt);
      b.vx = clamp(b.vx, -MAX_BSPEED, MAX_BSPEED);
      b.vy = clamp(b.vy, -MAX_BSPEED, MAX_BSPEED);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      // bounce off the side walls and ceiling; the floor is handled in checkFloors
      if (b.x < BALLOON_R) {
        b.x = BALLOON_R;
        b.vx = Math.abs(b.vx) * 0.6;
      } else if (b.x > ARENA_W - BALLOON_R) {
        b.x = ARENA_W - BALLOON_R;
        b.vx = -Math.abs(b.vx) * 0.6;
      }
      if (b.y < BALLOON_R) {
        b.y = BALLOON_R;
        b.vy = Math.abs(b.vy) * 0.5;
      }
    }
  }

  // blob ⇄ balloon contact: a spiking blob POPS a RIVAL's balloon on touch; every
  // other touch (including a spiker brushing their OWN balloon) BATS it up and away
  // (and out of contact, so it doesn't stick to the paddle). Your own pin never
  // bursts your own balloon — only "another player" can pop you.
  private resolveContacts(): void {
    for (const a of this.aliveActors()) {
      const spiking = (a.data!.spikeT || 0) > 0;
      const reach = PLAYER_RADIUS * a.scale + BALLOON_R;
      for (const b of this.balloons.values()) {
        if (b.popped) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > reach) continue;
        if (spiking && b.owner !== a.id) {
          this.pop(b, "Popped!");
          continue;
        }
        const nx = d > 0.01 ? dx / d : 0;
        const ny = d > 0.01 ? dy / d : -1;
        // shove the balloon clear of the body so it can't re-bat every tick — but
        // keep it on-screen (a blob hugging a wall/ceiling mustn't bat it off-edge)
        b.x = clamp(a.x + nx * (reach + 1), BALLOON_R, ARENA_W - BALLOON_R);
        b.y = clamp(a.y + ny * (reach + 1), BALLOON_R, ARENA_H - BALLOON_R - 1);
        // always send it UP, push it along the contact normal, and lend it a bit
        // of the blob's own momentum (so you can steer it as you run)
        b.vy = -BAT_VY;
        b.vx += nx * BAT_PUSH + a.vx * 0.25;
        this.boom("poof", b.x, b.y + BALLOON_R, { color: b.color, scale: 0.6 });
      }
    }
  }

  // soft, bouncy balloon-on-balloon collisions so a crowded sky stays chaotic
  private collideBalloons(): void {
    const list = [...this.balloons.values()].filter((b) => !b.popped);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const rr = BALLOON_R * 2;
        if (d >= rr) continue;
        const nx = dx / d;
        const ny = dy / d;
        const overlap = (rr - d) / 2;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;
        // exchange the normal component of velocity (soft & damped, so a crowded
        // sky jostles rather than pinballs into the corners)
        const va = a.vx * nx + a.vy * ny;
        const vb = b.vx * nx + b.vy * ny;
        const diff = (vb - va) * 0.45;
        a.vx += nx * diff;
        a.vy += ny * diff;
        b.vx -= nx * diff;
        b.vy -= ny * diff;
      }
    }
  }

  private checkFloors(): void {
    for (const b of this.balloons.values()) {
      if (b.popped) continue;
      if (b.y + BALLOON_R >= ARENA_H) {
        b.y = ARENA_H - BALLOON_R;
        this.pop(b, "Hit the floor!");
      }
    }
  }

  // lift a balloon back to a safe height instead of bursting it (shield / last-blob)
  private rescue(b: Balloon): void {
    b.y = Math.min(b.y, ARENA_H * 0.5);
    b.vy = -BAT_VY;
    b.vx *= 0.3;
    this.boom("shockwave", b.x, b.y, { color: "#80d8ff" });
  }

  // Burst a balloon → eliminate its owner. A 🛡️ shield is spent instead as a
  // one-time save; and the very last balloon in play can't be popped (its owner
  // is the winner, not a casualty), so a round always leaves a survivor.
  private pop(b: Balloon, note: string): void {
    if (b.popped) return;
    const owner = this.actors.get(b.owner);
    if (owner && owner.alive && owner.shield) {
      owner.shield = false;
      this.rescue(b);
      this.ctx.toast("🛡️ Shield popped instead — saved!", "good");
      return;
    }
    if (owner && owner.alive && this.aliveActors().length <= 1) {
      // last one flying — the floor/pin won't take the champion
      this.rescue(b);
      return;
    }
    b.popped = true;
    this.boom("spark", b.x, b.y, { color: b.color, scale: 1.4 });
    this.boom("shatter", b.x, b.y, { color: b.color });
    if (owner && owner.alive) {
      owner.alive = false;
      owner.anim = "dead";
      owner.inDx = 0;
      owner.inDy = 0;
      this.elimOrder.push({ id: owner.id, note });
      this.boom("death", owner.x, owner.y, { color: "#ff1744" });
      this.boom("splat", owner.x, owner.y, { color: "#ab47bc" });
    }
  }

  private botThink(a: ArenaActor, dt: number): void {
    const me = this.balloons.get(a.id);
    if (!me) {
      a.inDx = 0;
      a.inDy = 0;
      return;
    }
    const d = a.data!;
    const skill = d.skill ?? 0.6;
    // reaction lag: sharper bots re-plan more often; sloppier ones drift on stale
    // targets and let fast-drifting balloons get away (which is what culls them)
    d.react = (d.react || 0) - dt;
    d.huntCd = (d.huntCd || 0) - dt;
    if ((d.react || 0) <= 0) {
      // skill spread is intentionally wide and non-linear: aces (high skill) react
      // almost instantly and aim true, but the bottom of the pack lags badly and
      // wanders — so as the air thickens it's the sloppy jugglers who lose their
      // balloons (a fair, floor-death cull that never touches a tidy player).
      const slop = (1 - skill) * (1 - skill);
      d.react = 0.1 + slop * 1.4;
      const lead = 0.22 + (1 - skill) * 0.3;
      // default plan: track the balloon's near-future x and wait on a low patrol
      // row, only dipping lower if the balloon sinks below it — so the balloon
      // oscillates in a catchable mid band instead of getting ratcheted to the ceiling.
      const homeY = d.homeY ?? ARENA_H * 0.6;
      d.tx = clamp(me.x + me.vx * lead + (this.ctx.rng() - 0.5) * slop * 330, 40, ARENA_W - 40);
      d.ty = clamp(Math.max(homeY, me.y + BALLOON_R + PLAYER_RADIUS * 0.6) + (this.ctx.rng() - 0.5) * slop * 90, 40, ARENA_H - 40);
      d.hunt = 0;

      // Offense is a rare garnish, not a strategy: only an "aggressive" bot, only
      // when its own balloon is safely high and settled, and never twice in quick
      // succession (a long huntCd). Most rounds the bots just juggle and the cull
      // comes from the thickening air — popping is mostly a tool for human players.
      const safe = me.y < ARENA_H * 0.38 && Math.abs(me.vy) < 40;
      if (safe && (d.aggro || 0) > 0 && (d.huntCd || 0) <= 0 && this.ctx.rng() < (d.aggro || 0) * 0.04) {
        let foe: Balloon | null = null;
        let fd = 190;
        for (const b of this.balloons.values()) {
          if (b.popped || b.owner === a.id) continue;
          const bd = dist(a.x, a.y, b.x, b.y);
          if (bd < fd) {
            fd = bd;
            foe = b;
          }
        }
        if (foe) {
          d.tx = foe.x;
          d.ty = foe.y;
          d.hunt = 1;
          d.huntCd = 6 + this.ctx.rng() * 5;
        }
      }
    }

    const tx = d.tx ?? me.x;
    const ty = d.ty ?? me.y;
    const dx = tx - a.x;
    const dy = ty - a.y;
    const m = Math.hypot(dx, dy) || 1;
    a.inDx = dx / m;
    a.inDy = dy / m;
    a.facing = Math.atan2(dy, dx);

    // jab when hunting and right on top of the target rival balloon
    if (d.hunt && Math.hypot(a.x - tx, a.y - ty) < PLAYER_RADIUS + BALLOON_R + 10) {
      this.trySpike(a);
    } else if (!d.hunt) {
      // grab a powerup if one's basically on the way (never while hunting)
      for (const pk of this.powerups.pickups) {
        if (dist(a.x, a.y, pk.x, pk.y) < 70) {
          const gx = pk.x - a.x;
          const gy = pk.y - a.y;
          const gm = Math.hypot(gx, gy) || 1;
          a.inDx = gx / gm;
          a.inDy = gy / gm;
          break;
        }
      }
    }
  }

  snapshot(now: number): Snapshot {
    return {
      game: this.id,
      t: now,
      actors: [...this.actors.values()].map((a) => this.toActor(a)),
      data: {
        timeLeft: Math.max(0, TIME_CAP - this.elapsed),
        alive: this.aliveActors().length,
        balloons: [...this.balloons.values()]
          .filter((b) => !b.popped)
          .map((b) => ({
            owner: b.owner,
            x: Math.round(b.x),
            y: Math.round(b.y),
            vx: Math.round(b.vx),
            color: b.color,
          })),
        pickups: this.powerups.snapshot(),
        night: this.ctx.night,
      },
      fx: this.drainFx(),
    };
  }

  result(): MinigameResult {
    // survivors ranked best-first by how high they're still flying their balloon
    const survivors = this.aliveActors().sort((a, b) => {
      const ay = this.balloons.get(a.id)?.y ?? ARENA_H;
      const by = this.balloons.get(b.id)?.y ?? ARENA_H;
      return ay - by;
    });
    return crownOne(
      survivors.map((a) => a.id),
      this.elimOrder,
      this.ctx.forceSingleSurvivor,
      "Lowest balloon at the buzzer",
    );
  }
}
