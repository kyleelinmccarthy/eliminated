// Prop Hunt — the deadly hide & seek. Everyone disguises as a random prop and
// melts into a room full of identical decoys. One Seeker stalks the room with a
// sword, but the blade only lands so many swings before it dulls — so they
// physically can't skewer everyone. Hold still and you're indistinguishable
// from the furniture; creep around and you twitch, and twitching gets you
// noticed. Found hiders are boxed up. The Seeker has a quota: fall short of it
// and the organizers box the Seeker too. Bots play every role.

import { ArenaGame, type GameContext, type ArenaActor, type MinigameResult, buildRanking } from "./Minigame";
import type { GameId, Snapshot } from "../../shared/types";
import type { GameInput } from "../../shared/protocol";
import { ARENA_W, ARENA_H, PLAYER_RADIUS } from "../../shared/constants";
import { dist, shuffle, pick, clamp } from "../../shared/util";

// Object kinds a blob can disguise as. Decoys use the same palette so a hider
// always has lookalikes to blend in with ("match other objects in the room").
const PROP_KINDS = ["crate", "barrel", "jar", "bush", "stool", "rock"] as const;
type PropKind = (typeof PROP_KINDS)[number];

const HIDE_TIME = 7; // seconds for hiders to scurry into position
const SWORD_REACH = PLAYER_RADIUS * 2.7; // how far the blade reaches on a swing
const SWING_CD = 0.55; // seconds between swings
const SEEKER_SPEED = 1.06; // seeker patrols a touch faster than a blob
const CREEP_SPEED = 0.5; // disguised hiders only crawl
const EXPOSE_TIME = 1.3; // a hider that moved stays "twitchy" (a tell) this long
const MOVE_EPS = 8; // speed above which a hider is visibly fidgeting
const END_GRACE = 1.4; // denouement after the blade runs out / a wipe

interface Decoy {
  id: string;
  x: number;
  y: number;
  kind: PropKind;
  dead: boolean;
}

export class PropHunt extends ArenaGame {
  id: GameId = "prophunt";
  private phase: "hide" | "hunt" = "hide";
  private timer = HIDE_TIME;
  private seekerId = "";
  private swings = 0;
  private maxSwings = 0;
  private quota = 1;
  private found = 0;
  private hidersTotal = 0;
  private decoys: Decoy[] = [];
  private hiderKind = new Map<string, PropKind>();
  private elimOrder: { id: string; note?: string }[] = [];
  private ended = false;
  // the bot seeker's current intention (a real hider, or a wrong hunch toward a decoy)
  private goal = { x: ARENA_W / 2, y: ARENA_H / 2, hiderId: "" as string, repick: 0 };

  start(): void {
    const ps = shuffle(this.ctx.rng, this.ctx.players);
    const seeker = ps[0];
    const hiders = ps.slice(1);
    this.hidersTotal = hiders.length;
    this.seekerId = seeker.id;

    // --- decoys: a crowd of fake props strewn across the room ---
    const D = clamp(Math.round(this.hidersTotal * 1.3) + 5, 7, 40);
    const margin = 110;
    for (let i = 0; i < D; i++) {
      this.decoys.push({
        id: `decoy_${i}`,
        x: margin + this.ctx.rng() * (ARENA_W - margin * 2),
        y: margin + this.ctx.rng() * (ARENA_H - margin * 2),
        kind: pick(this.ctx.rng, PROP_KINDS as unknown as PropKind[]),
        dead: false,
      });
    }
    const kindsPresent = [...new Set(this.decoys.map((d) => d.kind))];

    // --- seeker spawns dead center, blade sheathed until the hunt ---
    const sa = this.addActor(seeker, ARENA_W / 2, ARENA_H / 2);
    sa.it = true;
    sa.facing = Math.PI / 2;
    sa.data!.swingCd = 0;

    // --- hiders scatter; each gets a prop kind that matches the decoys ---
    for (const h of hiders) {
      const a = this.addActor(
        h,
        margin + this.ctx.rng() * (ARENA_W - margin * 2),
        margin + this.ctx.rng() * (ARENA_H - margin * 2),
      );
      const kind = pick(this.ctx.rng, kindsPresent);
      this.hiderKind.set(h.id, kind);
      a.data!.exposed = 0;
      a.data!.nerve = this.ctx.rng(); // bot creep tendency
      // bots aim to nestle next to a decoy of their own kind (camouflage)
      const sameKind = this.decoys.filter((d) => d.kind === kind);
      const spot = sameKind.length ? pick(this.ctx.rng, sameKind) : pick(this.ctx.rng, this.decoys);
      a.data!.spotX = spot ? spot.x + (this.ctx.rng() - 0.5) * 70 : a.x;
      a.data!.spotY = spot ? spot.y + (this.ctx.rng() - 0.5) * 70 : a.y;
    }

    // The blade only lands a handful of times — never enough to clear the room.
    this.maxSwings = clamp(Math.round(this.hidersTotal * (0.4 + this.ctx.intensity * 0.4)), 2, Math.max(2, this.hidersTotal));
    this.swings = this.maxSwings;
    // Dash is a high-cost emergency only: a long cooldown so it's a one-shot bolt,
    // not a way to skitter around the room (and it blows a hider's cover, see tick).
    this.dashCd = 2.4;
    // The Seeker's body-count quota: ALWAYS at least 1 (find nobody and the
    // organizers box the Seeker too), scaling up a little late in a series. Never
    // more than they could possibly hit, and never the whole room.
    this.quota = Math.max(1, Math.min(1 + Math.floor(this.ctx.intensity * 2), this.maxSwings, this.hidersTotal));

    this.ctx.toast("Disguise yourself! Match the furniture. The Seeker is counting…", "info");
  }

  private aliveHiders(): ArenaActor[] {
    return [...this.actors.values()].filter((a) => a.alive && !a.it);
  }

  tick(dt: number, _now: number): void {
    this.elapsed += dt;
    this.timer -= dt;

    const seeker = this.actors.get(this.seekerId);

    if (this.phase === "hide") {
      // hiders scurry into position; the Seeker is frozen, "counting".
      for (const a of this.actors.values()) {
        if (!a.alive) continue;
        a.data!.wantDash = 0; // no dashing while everyone's still getting into place
        this.tickDashCd(a, dt);
        if (a.it) {
          a.inDx = 0;
          a.inDy = 0;
          a.anim = "idle";
          continue;
        }
        if (a.isBot) this.botHide(a);
        this.moveActor(a, dt, 1);
      }
      if (this.timer <= 0) this.startHunt();
      return;
    }

    // ---- hunt ----
    if (seeker && (seeker.data!.swingCd || 0) > 0) seeker.data!.swingCd = Math.max(0, seeker.data!.swingCd - dt);
    if (seeker && (seeker.progress || 0) > 0) seeker.progress = Math.max(0, (seeker.progress as number) - dt / 0.3);

    for (const a of this.actors.values()) {
      if (!a.alive) continue;
      this.tickDashCd(a, dt);
      if (a.data!.wantDash) {
        a.data!.wantDash = 0;
        this.tryDash(a);
      }
      if (a.it) {
        if (a.isBot) this.botSeek(a, dt);
        if (!this.stepDash(a, dt)) this.moveActor(a, dt, SEEKER_SPEED);
        continue;
      }
      // hider: crawl, and track whether they're visibly fidgeting (a tell). A dash
      // is a big burst of movement, so it always counts as a fidget — bolting blows
      // your cover.
      if (a.isBot) this.botHide(a);
      const dashing = this.stepDash(a, dt);
      if (!dashing) this.moveActor(a, dt, CREEP_SPEED);
      const moving = dashing || Math.hypot(a.vx, a.vy) > MOVE_EPS;
      a.data!.exposed = moving ? EXPOSE_TIME : Math.max(0, (a.data!.exposed || 0) - dt);
    }

    // end conditions
    if (this.aliveHiders().length === 0) return this.endHunt();
    if (this.timer <= 0) return this.endHunt();
  }

  // ---------- seeker actions ----------
  protected onAction(a: ArenaActor, input: GameInput): void {
    if (input.kind !== "action") return;
    if (input.name === "swing") this.trySwing(a);
    // SHIFT / 💨 dash: the seeker uses it to close for a swing; a hider can panic-
    // bolt with it — but a dash is movement, and movement makes a prop twitch
    // (exposed), so bailing this way paints a target on your back.
    else if (input.name === "dash") a.data!.wantDash = 1;
  }

  // The nearest still-intact prop (hider or decoy) within the blade's reach.
  private nearestProp(a: ArenaActor): { kind: "hider" | "decoy"; hider?: ArenaActor; decoy?: Decoy; d: number } | null {
    let best: { kind: "hider" | "decoy"; hider?: ArenaActor; decoy?: Decoy; d: number } | null = null;
    for (const h of this.aliveHiders()) {
      const d = dist(a.x, a.y, h.x, h.y);
      if (d <= SWORD_REACH && (!best || d < best.d)) best = { kind: "hider", hider: h, d };
    }
    for (const dc of this.decoys) {
      if (dc.dead) continue;
      const d = dist(a.x, a.y, dc.x, dc.y);
      if (d <= SWORD_REACH && (!best || d < best.d)) best = { kind: "decoy", decoy: dc, d };
    }
    return best;
  }

  private trySwing(a: ArenaActor): void {
    if (a.id !== this.seekerId || this.phase !== "hunt" || this.ended) return;
    if (this.swings <= 0 || (a.data!.swingCd || 0) > 0) return;
    a.data!.swingCd = SWING_CD;
    a.progress = 1; // drives the on-screen blade swoosh
    const target = this.nearestProp(a);
    if (!target) {
      // whiffed at empty air — costs no swing, just a beat of recovery
      this.boom("spark", a.x + Math.cos(a.facing) * SWORD_REACH, a.y + Math.sin(a.facing) * SWORD_REACH, { color: "#cfd8dc" });
      return;
    }
    this.swings--;
    if (target.kind === "hider" && target.hider) {
      this.findHider(target.hider);
    } else if (target.decoy) {
      target.decoy.dead = true;
      this.boom("shatter", target.decoy.x, target.decoy.y, { color: "#bcaaa4" });
    }
    if (this.swings <= 0 && !this.ended) this.timer = Math.min(this.timer, END_GRACE); // blade's dull — wind down
  }

  private findHider(h: ArenaActor): void {
    h.alive = false;
    h.anim = "dead";
    h.inDx = 0;
    h.inDy = 0;
    this.found++;
    this.elimOrder.push({ id: h.id, note: "Skewered mid-disguise!" });
    this.boom("shatter", h.x, h.y, { color: "#ff8a65" });
    this.boom("death", h.x, h.y, { color: "#ff1744" });
    this.ctx.toast(`Found one! ${this.found}/${this.quota} toward quota.`, "bad");
    if (this.aliveHiders().length === 0 && !this.ended) this.timer = Math.min(this.timer, END_GRACE);
  }

  private startHunt(): void {
    this.phase = "hunt";
    const hiderCount = this.aliveHiders().length;
    this.timer = clamp(20 + hiderCount * 1.2, 22, 42);
    for (const a of this.actors.values()) {
      if (a.it || !a.alive) continue;
      a.carrying = this.hiderKind.get(a.id); // disguise goes live
      a.anim = "idle";
      a.inDx = 0;
      a.inDy = 0;
      a.data!.exposed = 0;
    }
    this.goal.repick = 0;
    this.ctx.toast(
      `The Seeker draws the blade — they must skewer at least ${this.quota} or get boxed themselves. HOLD STILL.`,
      "bad",
    );
  }

  private endHunt(): void {
    if (this.ended) return;
    this.ended = true;
    const survivingHiders = this.aliveHiders();
    const seeker = this.actors.get(this.seekerId);
    // The Seeker survives if they hit quota, or actually cleared the whole room
    // (max performance), or there was nobody to find. Otherwise: boxed for
    // underperforming — but only when hiders remain, so the room is never empty.
    const seekerSurvives =
      this.found >= this.quota || survivingHiders.length === 0 || this.hidersTotal === 0;
    if (!seekerSurvives && seeker && seeker.alive) {
      seeker.alive = false;
      seeker.anim = "dead";
      seeker.it = false;
      this.elimOrder.unshift({ id: this.seekerId, note: `Found only ${this.found}/${this.quota}. Disappointing.` });
      this.boom("death", seeker.x, seeker.y, { color: "#ff1744" });
      this.boom("splat", seeker.x, seeker.y, { color: "#e53935" });
      this.ctx.toast("The Seeker missed quota. The organizers don't pay for effort.", "bad");
    } else {
      this.ctx.toast(
        survivingHiders.length
          ? `The blade dulls. ${survivingHiders.length} prop(s) live to be furniture another day.`
          : "The whole room, skewered. Impeccable.",
        "good",
      );
    }
    this.done = true;
  }

  // ---------- bot AI ----------
  private botHide(a: ArenaActor): void {
    if (this.phase === "hide") {
      // shuffle toward the chosen camouflage spot, then settle
      const tx = a.data!.spotX ?? a.x;
      const ty = a.data!.spotY ?? a.y;
      const d = dist(a.x, a.y, tx, ty);
      if (d < 14) {
        a.inDx = 0;
        a.inDy = 0;
      } else {
        a.inDx = (tx - a.x) / d;
        a.inDy = (ty - a.y) / d;
      }
      return;
    }
    // hunt: holding still IS the disguise. Only the jumpy ones creep — and
    // creeping away from a close blade is what gets them spotted.
    const seeker = this.actors.get(this.seekerId);
    if (seeker && seeker.alive) {
      const dd = dist(a.x, a.y, seeker.x, seeker.y);
      if (dd < 190 && (a.data!.nerve || 0) > 0.55 && this.ctx.rng() < 0.45) {
        const m = dd || 1;
        a.inDx = (a.x - seeker.x) / m;
        a.inDy = (a.y - seeker.y) / m;
        return;
      }
    }
    a.inDx = 0;
    a.inDy = 0;
  }

  private nearestHider(a: ArenaActor, list: ArenaActor[]): ArenaActor | null {
    let best: ArenaActor | null = null;
    let bd = Infinity;
    for (const h of list) {
      const d = dist(a.x, a.y, h.x, h.y);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  }

  private botSeek(a: ArenaActor, dt: number): void {
    const hiders = this.aliveHiders();
    this.goal.repick -= dt;
    if (!hiders.length) {
      a.inDx = Math.sin(this.elapsed + a.y) * 0.4;
      a.inDy = Math.cos(this.elapsed + a.x) * 0.4;
      return;
    }

    const tracked = this.goal.hiderId ? this.actors.get(this.goal.hiderId) : null;
    const needNewGoal = this.goal.repick <= 0 || (this.goal.hiderId && (!tracked || !tracked.alive));
    if (needNewGoal) {
      this.goal.repick = 0.6 + this.ctx.rng() * 0.5;
      const acc = 0.5 + this.ctx.intensity * 0.3;
      const exposed = hiders.filter((h) => (h.data!.exposed || 0) > 0);
      let chosen: ArenaActor | null = null;
      if (exposed.length && this.ctx.rng() < 0.85) chosen = this.nearestHider(a, exposed);
      else if (this.ctx.rng() < acc) chosen = this.nearestHider(a, hiders);

      if (chosen) {
        this.goal.hiderId = chosen.id;
        this.goal.x = chosen.x;
        this.goal.y = chosen.y;
      } else {
        // a wrong hunch: stalk a random decoy and (probably) waste a swing on it
        const live = this.decoys.filter((d) => !d.dead);
        const d = live.length ? pick(this.ctx.rng, live) : null;
        this.goal.hiderId = "";
        this.goal.x = d ? d.x : a.x;
        this.goal.y = d ? d.y : a.y;
      }
    }
    if (this.goal.hiderId) {
      const h = this.actors.get(this.goal.hiderId);
      if (h && h.alive) {
        this.goal.x = h.x;
        this.goal.y = h.y;
      }
    }

    // steer toward the goal
    const gd = dist(a.x, a.y, this.goal.x, this.goal.y);
    if (gd > 6) {
      a.inDx = (this.goal.x - a.x) / gd;
      a.inDy = (this.goal.y - a.y) / gd;
    } else {
      a.inDx = 0;
      a.inDy = 0;
    }

    // swing when committed and a prop is in reach
    if ((a.data!.swingCd || 0) <= 0 && this.swings > 0 && this.nearestProp(a)) {
      const committed = this.goal.hiderId
        ? !!tracked && dist(a.x, a.y, this.goal.x, this.goal.y) <= SWORD_REACH
        : dist(a.x, a.y, this.goal.x, this.goal.y) <= SWORD_REACH * 1.2;
      if (committed) this.trySwing(a);
    }
  }

  // Mid-game removal (quit / kick): the Seeker bailing ends the hunt and spares
  // the room; a hider bailing just gets boxed like everyone else.
  override forfeit(playerId: string): void {
    const wasAlive = this.actors.get(playerId)?.alive;
    super.forfeit(playerId);
    if (!wasAlive) return;
    if (playerId === this.seekerId) {
      if (!this.ended) {
        this.ended = true;
        this.done = true;
      }
    } else {
      this.elimOrder.push({ id: playerId, note: "Bailed mid-disguise." });
    }
  }

  snapshot(now: number): Snapshot {
    return {
      game: this.id,
      t: now,
      actors: [...this.actors.values()].map((a) => this.toActor(a)),
      data: {
        phase: this.phase,
        timeLeft: Math.max(0, this.timer),
        seekerId: this.seekerId,
        swings: this.swings,
        maxSwings: this.maxSwings,
        quota: this.quota,
        found: this.found,
        hidersLeft: this.aliveHiders().length,
        night: this.ctx.night,
        decoys: this.decoys
          .filter((d) => !d.dead)
          .map((d) => ({ id: d.id, x: d.x, y: d.y, kind: d.kind })),
      },
      fx: this.drainFx(),
    };
  }

  result(): MinigameResult {
    const seeker = this.actors.get(this.seekerId);
    const survivors: string[] = this.aliveHiders().map((a) => a.id);
    if (seeker && seeker.alive) survivors.push(this.seekerId);
    return { survivorIds: survivors, ranking: buildRanking(survivors, this.elimOrder) };
  }
}
