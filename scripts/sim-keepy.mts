// Headless behavioral check for Keepy Uppy. Runs the real game class at 20Hz with
// synthetic inputs and asserts: every round terminates with a well-formed result,
// no balloon is ever left sitting below the floor (elimination fires correctly),
// a spike actually pops the balloon it touches, an attentive juggler out-survives
// the bots, and a player who never moves reliably loses their balloon.

import { KeepyUppy } from "../lib/server/games/KeepyUppy";
import type { GameContext, GamePlayer } from "../lib/server/games/Minigame";
import { ARENA_H, PLAYER_RADIUS } from "../lib/shared/constants";
import { makeRng } from "../lib/shared/util";

const DT = 1 / 20;
const BALLOON_R = 30;

function mkCtx(players: GamePlayer[], rngSeed: number, intensity: number): GameContext {
  return {
    players,
    map: { id: "x", name: "x", theme: "x" } as any,
    rng: makeRng(rngSeed),
    friendlyFire: true,
    emitFx: () => {},
    toast: () => {},
    roundIndex: 1,
    totalRounds: 3,
    isFinale: false,
    intensity,
    night: false,
  };
}

function players(nHumans: number, nBots: number): GamePlayer[] {
  const ps: GamePlayer[] = [];
  for (let i = 0; i < nHumans; i++) ps.push({ id: `h${i}`, name: `Human${i}`, characterId: "avo", isBot: false });
  for (let i = 0; i < nBots; i++) ps.push({ id: `b${i}`, name: `Bot${i}`, characterId: "egg", isBot: true });
  return ps;
}

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${msg}`);
  if (!cond) failures++;
}

// Run one round. `human` = how the lone human "h0" plays each tick.
function runRound(seed: number, intensity: number, human: "track" | "idle") {
  const ps = players(1, 7);
  const g: any = new KeepyUppy(mkCtx(ps, seed, intensity));
  g.start();
  let steps = 0;
  const MAX = 45 * 20; // 45s ceiling; the 38s timer should end it first
  let belowFloor = false; // a live balloon ever seen sunk under the floor?
  for (; steps < MAX; steps++) {
    if (human === "track") {
      // play it like a person: park just UNDER the balloon (matched in x, a bit
      // below) so it falls onto us and gets batted gently back up
      const snap = g.snapshot(steps * DT);
      const me = snap.actors.find((a: any) => a.id === "h0");
      const mine = snap.data.balloons.find((b: any) => b.owner === "h0");
      if (me && mine && me.alive) {
        const tx = mine.x + (mine.vx ?? 0) * 0.25;
        const ty = mine.y + 55; // stay below the balloon
        const dx = tx - me.x;
        const dy = ty - me.y;
        const m = Math.hypot(dx, dy) || 1;
        g.onInput("h0", { kind: "move", dx: dx / m, dy: dy / m });
      }
    } // idle: send nothing, the blob just stands there
    g.tick(DT, steps * DT);
    const snap = g.snapshot(steps * DT);
    for (const b of snap.data.balloons) {
      if (b.y + BALLOON_R > ARENA_H + 2) belowFloor = true;
    }
    if (g.isDone()) break;
  }
  return { g, steps, done: g.isDone() as boolean, result: g.result(), belowFloor, final: g.snapshot(steps * DT) };
}

// ---------------------------------------------------------------------------
// 1) Termination + well-formed result + no balloon ever stuck below the floor.
// ---------------------------------------------------------------------------
function testStructure() {
  console.log("Keepy Uppy — termination, result shape & floor handling");
  let alwaysDone = true;
  let goodResult = true;
  let noSunkBalloons = true;
  let maxSteps = 0;

  for (let seed = 1; seed <= 60; seed++) {
    const { steps, done, result, belowFloor } = runRound(seed * 17 + 1, 0.5, "track");
    maxSteps = Math.max(maxSteps, steps);
    if (!done) alwaysDone = false;
    if (belowFloor) noSunkBalloons = false;

    const n = 8; // 1 human + 7 bots
    const placements = result.ranking.map((r: any) => r.placement).sort((a: number, b: number) => a - b);
    const expected = Array.from({ length: n }, (_, i) => i + 1);
    const coversAll = result.ranking.length === n;
    const uniquePlacements = JSON.stringify(placements) === JSON.stringify(expected);
    const survivorsConsistent =
      result.survivorIds.length >= 1 &&
      result.survivorIds.every((id: string) => result.ranking.find((r: any) => r.playerId === id)?.survived === true);
    if (!coversAll || !uniquePlacements || !survivorsConsistent) goodResult = false;
  }

  check(alwaysDone, "every round terminated (timer / down to one)");
  check(maxSteps <= 39 * 20, `rounds end within the clock (worst ${(maxSteps / 20).toFixed(1)}s)`);
  check(goodResult, "result ranking covers all players with unique placements 1..n");
  check(noSunkBalloons, "no live balloon is ever left sitting below the floor");
}

// ---------------------------------------------------------------------------
// 2) A spike actually bursts the balloon it touches (and eliminates the owner).
// ---------------------------------------------------------------------------
function testSpikePops() {
  console.log("Keepy Uppy — a spike pops the balloon it touches");
  const ps = players(2, 0); // h0 attacks h1
  const g: any = new KeepyUppy(mkCtx(ps, 999, 0.5));
  g.start();
  const attacker = g.actors.get("h0");
  const victimBalloon = g.balloons.get("h1");
  // place the attacker right on top of the victim's balloon, facing it
  attacker.x = victimBalloon.x;
  attacker.y = victimBalloon.y + 4;
  g.onInput("h0", { kind: "action", name: "spike" });
  g.tick(DT, DT);
  const victim = g.actors.get("h1");
  check(victim.alive === false, "the jabbed rival is eliminated");
  check(g.balloons.get("h1")?.popped === true || !g.snapshot(0).data.balloons.some((b: any) => b.owner === "h1"),
    "the victim's balloon is gone from the field");
  const note = g.result().ranking.find((r: any) => r.playerId === "h1")?.note;
  check(note === "Popped!", `elimination note reads 'Popped!' (got '${note}')`);
}

// ---------------------------------------------------------------------------
// 3) An attentive juggler out-survives the lazy bots a clear majority of rounds.
// ---------------------------------------------------------------------------
function testEngagedHuman() {
  console.log("Keepy Uppy — an attentive juggler beats the bots");
  let survived = 0;
  const N = 80;
  for (let seed = 1; seed <= N; seed++) {
    const { result } = runRound(seed * 31 + 7, 0.6, "track");
    if (result.survivorIds.includes("h0")) survived++;
  }
  const rate = survived / N;
  console.log(`  attentive human survived ${survived}/${N} (${(rate * 100).toFixed(0)}%)`);
  check(rate >= 0.6, `a diligent juggler survives a clear majority (got ${(rate * 100).toFixed(0)}%)`);
}

// ---------------------------------------------------------------------------
// 4) A player who never moves reliably loses their balloon.
// ---------------------------------------------------------------------------
function testIdleHuman() {
  console.log("Keepy Uppy — standing still loses your balloon");
  let eliminated = 0;
  const N = 40;
  for (let seed = 1; seed <= N; seed++) {
    const { result } = runRound(seed * 13 + 2, 0.6, "idle");
    if (!result.survivorIds.includes("h0")) eliminated++;
  }
  const rate = eliminated / N;
  console.log(`  idle human eliminated ${eliminated}/${N} (${(rate * 100).toFixed(0)}%)`);
  check(rate >= 0.8, `a motionless player is reliably culled (got ${(rate * 100).toFixed(0)}%)`);
}

// ---------------------------------------------------------------------------
// 5) Rounds actually thin the herd (it's a 'mid' cull, not a no-op).
// ---------------------------------------------------------------------------
function testCulls() {
  console.log("Keepy Uppy — the round meaningfully thins the field");
  let totalStart = 0;
  let totalSurvive = 0;
  const N = 40;
  for (let seed = 1; seed <= N; seed++) {
    const { result } = runRound(seed * 7 + 3, 0.6, "track");
    totalStart += 8;
    totalSurvive += result.survivorIds.length;
  }
  const culled = (totalStart - totalSurvive) / totalStart;
  console.log(`  average ${(culled * 100).toFixed(0)}% of the field eliminated per round`);
  check(culled > 0.1 && culled < 0.95, `cull rate is meaningful but not a wipe (got ${(culled * 100).toFixed(0)}%)`);
}

testStructure();
testSpikePops();
testEngagedHuman();
testIdleHuman();
testCulls();

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll checks passed.");
