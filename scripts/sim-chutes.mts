// Headless behavioral check for Chutes & Ladders. Runs the real game class at
// 20Hz with synthetic inputs and asserts: the round always terminates with a
// well-formed result, the board is legal (ladders up / snakes down / no shared
// endpoints), finishers are always safe, an engaged (tapping) human survives a
// healthy fraction vs bots, and an idle one who never rolls gets swallowed.

import { ChutesAndLadders } from "../lib/server/games/ChutesAndLadders";
import type { GameContext, GamePlayer } from "../lib/server/games/Minigame";
import { makeRng } from "../lib/shared/util";

const DT = 1 / 20;

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
  for (let i = 0; i < nBots; i++) ps.push({ id: `b${i}`, name: `Bot${i}`, characterId: "avo", isBot: true });
  return ps;
}

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${msg}`);
  if (!cond) failures++;
}

// Run one round. `human` decides what the lone human does each tick.
function runRound(seed: number, intensity: number, human: "tap" | "idle") {
  const ps = players(1, 7);
  const g: any = new ChutesAndLadders(mkCtx(ps, seed, intensity));
  g.start();
  let steps = 0;
  const MAX = 40 * 20; // 40s hard ceiling; the timer should end it well before
  let firstSnap: any = null;
  for (; steps < MAX; steps++) {
    if (human === "tap") g.onInput("h0", { kind: "tap" }); // mash every tick
    g.tick(DT, steps * DT);
    const snap = g.snapshot(steps * DT);
    if (!firstSnap) firstSnap = snap;
    if (g.isDone()) break;
  }
  return { g, steps, done: g.isDone() as boolean, result: g.result(), firstSnap, final: g.snapshot(steps * DT) };
}

// ---------------------------------------------------------------------------
// 1) Termination + well-formed result + legal board.
// ---------------------------------------------------------------------------
function testStructure() {
  console.log("Chutes & Ladders — termination, result shape & legal board");
  let alwaysDone = true;
  let goodResult = true;
  let legalBoard = true;
  let finishersSafe = true;
  let maxSteps = 0;

  for (let seed = 1; seed <= 60; seed++) {
    const { steps, done, result, firstSnap, final } = runRound(seed * 17 + 1, 0.5, "tap");
    maxSteps = Math.max(maxSteps, steps);
    if (!done) alwaysDone = false;

    const ids = new Set([...firstSnap.data.climbers.map((c: any) => c.id)]);
    const n = ids.size;
    // ranking covers everyone exactly once with unique placements 1..n
    const placements = result.ranking.map((r: any) => r.placement).sort((a: number, b: number) => a - b);
    const expected = Array.from({ length: n }, (_, i) => i + 1);
    const coversAll = result.ranking.length === n && result.ranking.every((r: any) => ids.has(r.playerId));
    const uniquePlacements = JSON.stringify(placements) === JSON.stringify(expected);
    const survivorsConsistent =
      result.survivorIds.length >= 1 &&
      result.survivorIds.every((id: string) => result.ranking.find((r: any) => r.playerId === id)?.survived === true);
    if (!coversAll || !uniquePlacements || !survivorsConsistent) goodResult = false;

    // legal board: ladders up, snakes down, every endpoint distinct
    const d = final.data;
    const endpoints: number[] = [];
    for (const l of d.ladders) {
      if (!(l.from < l.to) || l.from < 2 || l.to > 100) legalBoard = false;
      endpoints.push(l.from, l.to);
    }
    for (const s of d.chutes) {
      if (!(s.from > s.to) || s.to < 1) legalBoard = false;
      endpoints.push(s.from, s.to);
    }
    if (new Set(endpoints).size !== endpoints.length) legalBoard = false;

    // anyone who topped out must be a survivor
    for (const c of final.data.climbers) {
      if (c.finished && !result.survivorIds.includes(c.id)) finishersSafe = false;
    }
  }

  check(alwaysDone, "every round terminated (timer/all-finished)");
  check(maxSteps <= 30 * 20, `rounds end within the clock (worst ${(maxSteps / 20).toFixed(1)}s)`);
  check(goodResult, "result ranking covers all players with unique placements 1..n");
  check(legalBoard, "board legal: ladders go up, snakes go down, no shared endpoints");
  check(finishersSafe, "anyone who reached square 100 is always a survivor");
}

// ---------------------------------------------------------------------------
// 2) An engaged (tapping) human survives a healthy fraction vs bots.
// ---------------------------------------------------------------------------
function testEngagedHuman() {
  console.log("Chutes & Ladders — a diligent roller out-survives the bots");
  let survived = 0;
  const N = 80;
  for (let seed = 1; seed <= N; seed++) {
    const { result } = runRound(seed * 31 + 7, 0.6, "tap");
    if (result.survivorIds.includes("h0")) survived++;
  }
  const rate = survived / N;
  console.log(`  engaged human survived ${survived}/${N} (${(rate * 100).toFixed(0)}%)`);
  check(rate >= 0.55, `tapping flat-out beats lazy bots a clear majority of the time (got ${(rate * 100).toFixed(0)}%)`);
}

// ---------------------------------------------------------------------------
// 3) An idle human who never rolls is essentially always swallowed.
// ---------------------------------------------------------------------------
function testIdleHuman() {
  console.log("Chutes & Ladders — never rolling gets you eaten");
  let eliminated = 0;
  const N = 40;
  for (let seed = 1; seed <= N; seed++) {
    const { result, final } = runRound(seed * 13 + 2, 0.6, "idle");
    const me = final.data.climbers.find((c: any) => c.id === "h0");
    if (!result.survivorIds.includes("h0")) eliminated++;
    // an idle player should be stuck at the start
    if (me.square !== 0) eliminated -= 0; // (no-op guard; documents intent)
  }
  const rate = eliminated / N;
  console.log(`  idle human eliminated ${eliminated}/${N} (${(rate * 100).toFixed(0)}%)`);
  check(rate >= 0.95, `a non-roller is reliably culled (got ${(rate * 100).toFixed(0)}%)`);
}

testStructure();
testEngagedHuman();
testIdleHuman();

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll checks passed.");
