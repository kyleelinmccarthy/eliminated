// Headless behavioral check for Chutes & Ladders (Squid-Game fork edition).
//
// The board is an 8x8 climb to square 64 (the top = SAFETY) under a countdown.
// Ladders auto-lift you. CHUTES are forks: land on one and you must pick LEFT or
// RIGHT — one side dumps you back to the START, the other drops you into the ABYSS
// (eliminated). Each chute's sides are FIXED and CONSISTENT: the same side of the
// same chute always does the same thing to everyone, and once a side is taken it's
// revealed to all (so blobs can learn from whoever tried it first).
//
// We run the real game class at 20Hz and assert: legal board, deterministic &
// consistent chute outcomes, reveal-on-use, the round always terminates well-formed
// within the clock, finishers are always safe, an engaged (rolling + learning) human
// out-survives the bots, and an idle one who never acts gets culled.

import { ChutesAndLadders } from "../lib/server/games/ChutesAndLadders";
import type { GameContext, GamePlayer } from "../lib/server/games/Minigame";
import { makeRng } from "../lib/shared/util";

const DT = 1 / 20;
const COLS = 8;
const ROWS = 8;
const GOAL = 64;

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
    forceSingleSurvivor: false,
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

function newGame(seed: number, intensity = 0.5, nH = 1, nB = 7) {
  const ps = players(nH, nB);
  const g: any = new ChutesAndLadders(mkCtx(ps, seed, intensity));
  g.start();
  return g;
}

// Smart human choice: avoid a known-deadly side, prefer a known-safe one, else guess.
// Outcome encoding in the snapshot: -1 unknown, 0 = back-to-start (survive), 1 = abyss (die).
function chooseSide(snap: any, chuteId: number): "L" | "R" {
  const ch = (snap.data.chutes || []).find((c: any) => c.id === chuteId);
  if (ch) {
    if (ch.left === 0 || ch.right === 1) return "L"; // L safe, or R deadly → go L
    if (ch.right === 0 || ch.left === 1) return "R"; // R safe, or L deadly → go R
  }
  return "L"; // truly unknown — commit to a guess
}

// Run one round. `human` decides what the lone human does each tick.
function runRound(seed: number, intensity: number, human: "smart" | "idle") {
  const g = newGame(seed, intensity);
  let steps = 0;
  const MAX = 60 * 20; // generous ceiling; the timer should end it well before
  let firstSnap: any = null;
  for (; steps < MAX; steps++) {
    if (human === "smart") {
      const snap = g.snapshot(steps * DT);
      const me = snap.data.climbers.find((c: any) => c.id === "h0");
      if (me && me.alive && !me.finished) {
        if (me.choosing >= 0) g.onInput("h0", { kind: "choose", value: chooseSide(snap, me.choosing) });
        else g.onInput("h0", { kind: "tap" });
      }
    }
    g.tick(DT, steps * DT);
    const snap = g.snapshot(steps * DT);
    if (!firstSnap) firstSnap = snap;
    if (g.isDone()) break;
  }
  return { g, steps, done: g.isDone() as boolean, result: g.result(), firstSnap, final: g.snapshot(steps * DT) };
}

// ---------------------------------------------------------------------------
// 1) Legal board: right size, ladders up, chutes are valid forks, no overlaps.
// ---------------------------------------------------------------------------
function testBoard() {
  console.log("Chutes & Ladders — legal 8x8 board with ladders + fork chutes");
  let okSize = true;
  let laddersUp = true;
  let chutesValid = true;
  let noOverlap = true;
  let hasBoth = true;

  for (let seed = 1; seed <= 60; seed++) {
    const g = newGame(seed * 17 + 1);
    const d = g.snapshot(0).data;
    if (d.cols !== COLS || d.rows !== ROWS || d.goal !== GOAL) okSize = false;

    const rowOf = (s: number) => Math.floor((s - 1) / COLS);
    const endpoints: number[] = [];
    for (const l of d.ladders) {
      if (!(l.from < l.to) || l.from < 2 || l.to > GOAL - 1 || rowOf(l.to) - rowOf(l.from) < 2) laddersUp = false;
      endpoints.push(l.from, l.to);
    }
    for (const c of d.chutes) {
      // a fresh chute is an unrevealed fork at a legal square
      if (c.square < 2 || c.square > GOAL - 1) chutesValid = false;
      if (c.left !== -1 || c.right !== -1) chutesValid = false;
      endpoints.push(c.square);
    }
    if (new Set(endpoints).size !== endpoints.length) noOverlap = false;
    if (d.ladders.length < 1 || d.chutes.length < 1) hasBoth = false;
  }

  check(okSize, `board is ${COLS}x${ROWS} climbing to ${GOAL}`);
  check(laddersUp, "every ladder climbs up at least two rows, off the start/goal");
  check(chutesValid, "every chute is an unrevealed fork on a legal square");
  check(noOverlap, "no square is shared by two ladders/chutes");
  check(hasBoth, "every board has at least one ladder and one chute");
}

// ---------------------------------------------------------------------------
// 2) Chute forks are deterministic, consistent across players, and reveal on use.
// ---------------------------------------------------------------------------
function testForks() {
  console.log("Chutes & Ladders — fork outcomes are fixed, consistent & revealed on use");
  let deathSideKills = true;
  let safeSideResets = true;
  let consistent = true;
  let revealOnUse = true;
  let revealHidesOther = true;

  for (let seed = 1; seed <= 40; seed++) {
    const g = newGame(seed * 23 + 3);
    for (const chute of g.chutes) {
      const deathVal: "L" | "R" = chute.deathSide === 1 ? "R" : "L";
      const safeVal: "L" | "R" = chute.deathSide === 1 ? "L" : "R";

      // two different blobs land on this chute and both pick the DEATH side →
      // both must be eliminated (consistent, deterministic).
      const deaths: boolean[] = [];
      for (const id of ["h0", "b0"]) {
        const c = g.climbers.get(id);
        c.alive = true;
        c.finished = false;
        c.square = chute.square;
        c.choosing = chute.id;
        g.onInput(id, { kind: "choose", value: deathVal });
        deaths.push(!c.alive);
      }
      if (!deaths[0] || !deaths[1]) deathSideKills = false;
      if (deaths[0] !== deaths[1]) consistent = false;

      // the SAFE side instead sends you back to the start, still alive & not choosing.
      const c2 = g.climbers.get("b1");
      c2.alive = true;
      c2.finished = false;
      c2.square = chute.square;
      c2.choosing = chute.id;
      g.onInput("b1", { kind: "choose", value: safeVal });
      if (!c2.alive || c2.square !== 0 || c2.choosing !== -1) safeSideResets = false;
    }

    // reveal-on-use: a fresh chute is hidden on both sides; taking one side exposes
    // exactly that side's outcome and leaves the other still hidden.
    const g2 = newGame(seed * 31 + 9);
    const ch = g2.chutes[0];
    const before = g2.snapshot(0).data.chutes.find((c: any) => c.id === ch.id);
    if (before.left !== -1 || before.right !== -1) revealOnUse = false;
    const safe: "L" | "R" = ch.deathSide === 1 ? "L" : "R";
    const taker = g2.climbers.get("b2");
    taker.alive = true;
    taker.finished = false;
    taker.square = ch.square;
    taker.choosing = ch.id;
    g2.onInput("b2", { kind: "choose", value: safe });
    const after = g2.snapshot(0).data.chutes.find((c: any) => c.id === ch.id);
    const takenKey = safe === "L" ? "left" : "right";
    const otherKey = safe === "L" ? "right" : "left";
    if (after[takenKey] !== 0) revealOnUse = false; // safe side now shows "back to start" (0)
    if (after[otherKey] !== -1) revealHidesOther = false; // untried side still secret
  }

  check(deathSideKills, "picking a chute's death side eliminates you");
  check(safeSideResets, "picking the other side sends you back to the start, alive");
  check(consistent, "the same side of the same chute does the same thing to every blob");
  check(revealOnUse, "taking a side reveals that side's outcome to everyone");
  check(revealHidesOther, "the untried side of a chute stays secret");
}

// ---------------------------------------------------------------------------
// 3) Termination + well-formed result + finishers safe + never a total wipe.
// ---------------------------------------------------------------------------
function testStructure() {
  console.log("Chutes & Ladders — termination, result shape & survivor guarantees");
  let alwaysDone = true;
  let goodResult = true;
  let finishersSafe = true;
  let alwaysSurvivor = true;
  let maxSteps = 0;

  for (let seed = 1; seed <= 60; seed++) {
    const { steps, done, result, firstSnap, final } = runRound(seed * 17 + 1, 0.5, "smart");
    maxSteps = Math.max(maxSteps, steps);
    if (!done) alwaysDone = false;

    const ids = new Set([...firstSnap.data.climbers.map((c: any) => c.id)]);
    const n = ids.size;
    const placements = result.ranking.map((r: any) => r.placement).sort((a: number, b: number) => a - b);
    const expected = Array.from({ length: n }, (_, i) => i + 1);
    const coversAll = result.ranking.length === n && result.ranking.every((r: any) => ids.has(r.playerId));
    const uniquePlacements = JSON.stringify(placements) === JSON.stringify(expected);
    const survivorsConsistent =
      result.survivorIds.length >= 1 &&
      result.survivorIds.every((id: string) => result.ranking.find((r: any) => r.playerId === id)?.survived === true);
    if (!coversAll || !uniquePlacements || !survivorsConsistent) goodResult = false;
    if (result.survivorIds.length < 1) alwaysSurvivor = false;

    for (const c of final.data.climbers) {
      if (c.finished && !result.survivorIds.includes(c.id)) finishersSafe = false;
    }
  }

  check(alwaysDone, "every round terminated (timer / all-resolved)");
  check(maxSteps <= 45 * 20, `rounds end within the clock (worst ${(maxSteps / 20).toFixed(1)}s)`);
  check(goodResult, "result ranking covers all players with unique placements 1..n");
  check(alwaysSurvivor, "every round leaves at least one survivor (never a total wipe)");
  check(finishersSafe, "anyone who reached the top is always a survivor");
}

// ---------------------------------------------------------------------------
// 4) An engaged human (rolls fast, learns the chutes) out-survives lazy bots.
// ---------------------------------------------------------------------------
function testEngagedHuman() {
  console.log("Chutes & Ladders — a diligent, learning roller out-survives the bots");
  let survived = 0;
  const N = 100;
  for (let seed = 1; seed <= N; seed++) {
    const { result } = runRound(seed * 31 + 7, 0.5, "smart");
    if (result.survivorIds.includes("h0")) survived++;
  }
  const rate = survived / N;
  console.log(`  engaged human survived ${survived}/${N} (${(rate * 100).toFixed(0)}%)`);
  check(rate >= 0.5, `playing well beats the lazy bots a clear majority of the time (got ${(rate * 100).toFixed(0)}%)`);
}

// ---------------------------------------------------------------------------
// 5) An idle human who never acts is essentially always culled.
// ---------------------------------------------------------------------------
function testIdleHuman() {
  console.log("Chutes & Ladders — never rolling gets you culled");
  let eliminated = 0;
  const N = 40;
  for (let seed = 1; seed <= N; seed++) {
    const { result, final } = runRound(seed * 13 + 2, 0.6, "idle");
    const me = final.data.climbers.find((c: any) => c.id === "h0");
    if (!result.survivorIds.includes("h0")) eliminated++;
    if (me.square !== 0) eliminated -= 0; // (no-op guard; documents intent: idlers never leave the start)
  }
  const rate = eliminated / N;
  console.log(`  idle human eliminated ${eliminated}/${N} (${(rate * 100).toFixed(0)}%)`);
  check(rate >= 0.95, `a non-roller is reliably culled (got ${(rate * 100).toFixed(0)}%)`);
}

testBoard();
testForks();
testStructure();
testEngagedHuman();
testIdleHuman();

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll checks passed.");
