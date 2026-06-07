// Behavioral check for the reworked Freeze Tag (asymmetric roles):
//   * BLUE (team 0) are the freezers / "it" — marked `it`, they cannot be frozen.
//   * PINK (team 1) are the runners — they can be frozen, and an unfrozen runner
//     thaws a frozen teammate by touching them.
//   * At the buzzer: frozen runners are eliminated, AND a freezer who caught
//     nobody is eliminated too.
//   * The round always terminates with >= 1 survivor and a full ranking.
//
// Drives the real Tag class headless, manipulating actor positions for the
// deterministic role tests. Exits nonzero on any failure.

import { Tag } from "../lib/server/games/Tag";
import type { GameContext, GamePlayer } from "../lib/server/games/Minigame";
import { makeRng } from "../lib/shared/util";

const DT = 1 / 20;

function mkCtx(players: GamePlayer[], seed: number, intensity = 0.6): GameContext {
  return {
    players,
    map: { id: "x", name: "x", theme: "x" } as any,
    rng: makeRng(seed),
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

function players(n: number, humans = 0): GamePlayer[] {
  const ps: GamePlayer[] = [];
  for (let i = 0; i < humans; i++) ps.push({ id: `h${i}`, name: `H${i}`, characterId: "avo", isBot: false });
  for (let i = 0; i < n - humans; i++) ps.push({ id: `b${i}`, name: `B${i}`, characterId: "avo", isBot: true });
  return ps;
}

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${msg}`);
  if (!cond) failures++;
}

const actorsOf = (g: any): any[] => [...g.actors.values()];
const team = (g: any, t: number) => actorsOf(g).filter((a) => a.team === t);
const FREEZER = 0;
const RUNNER = 1;

// --- 1) roles: freezers (blue) are `it` and never get frozen; runners are not it
console.log("Freeze Tag — role assignment");
{
  let okRoles = true;
  for (let s = 0; s < 12; s++) {
    const g: any = new Tag(mkCtx(players(6), 1 + s * 31));
    g.start();
    const snap = g.snapshot(0);
    for (const a of snap.actors) {
      const isBlue = a.team === FREEZER;
      if (isBlue && !a.it) okRoles = false; // blue must be marked "it"
      if (!isBlue && a.it) okRoles = false; // pink must NOT be "it"
    }
  }
  check(okRoles, "blue freezers are marked `it`; pink runners are not");
}

// --- 2) a freezer touching a runner freezes the RUNNER (and the freezer never freezes)
console.log("Freeze Tag — a touch freezes the runner, not the freezer");
{
  const g: any = new Tag(mkCtx(players(2, 2), 7));
  g.start();
  const blue = team(g, FREEZER)[0];
  const pink = team(g, RUNNER)[0];
  // park them on top of each other early in the round (not deep freeze)
  g.timer = 30;
  blue.x = 300; blue.y = 300; blue.inDx = 0; blue.inDy = 0;
  pink.x = 300; pink.y = 300; pink.inDx = 0; pink.inDy = 0;
  g.tick(DT, 0);
  check(pink.frozen === true, "pink runner is frozen after contact");
  check(!blue.frozen, "blue freezer is never frozen");
  check((blue.data.freezes || 0) >= 1, "the freezer is credited with a catch");
}

// --- 3) an unfrozen runner thaws a frozen teammate by touching them
console.log("Freeze Tag — runners thaw frozen teammates");
{
  // 6 players → 3 runners; isolate two of them, keep freezers far away
  const g: any = new Tag(mkCtx(players(6, 6), 9));
  g.start();
  g.timer = 30; // well before deep freeze, so thawing is enabled
  const runners = team(g, RUNNER);
  const freezers = team(g, FREEZER);
  freezers.forEach((f: any, i: number) => { f.x = 50 + i; f.y = 50; });
  const frozen = runners[0];
  const rescuer = runners[1];
  runners.slice(2).forEach((r: any, i: number) => { r.x = 1200; r.y = 700 - i * 5; });
  frozen.frozen = true; frozen.x = 700; frozen.y = 360;
  rescuer.frozen = false; rescuer.x = 700; rescuer.y = 360; rescuer.data.immune = 0;
  g.tick(DT, 0);
  check(frozen.frozen === false, "a touching teammate thawed the frozen runner");
}

// --- 4) at the buzzer, a freezer who caught NOBODY is eliminated; the runner lives
console.log("Freeze Tag — idle freezer is eliminated at the buzzer");
{
  const g: any = new Tag(mkCtx(players(2, 2), 11));
  g.start();
  const blue = team(g, FREEZER)[0];
  const pink = team(g, RUNNER)[0];
  // keep them far apart so the freezer never catches anyone, then ring the buzzer
  blue.x = 100; blue.y = 100; blue.inDx = 0; blue.inDy = 0;
  pink.x = 1200; pink.y = 650; pink.inDx = 0; pink.inDy = 0; pink.frozen = false;
  g.timer = 0.01;
  g.tick(DT, 0);
  const res = g.result();
  check(g.isDone(), "round ended at the buzzer");
  check(blue.alive === false, "the idle freezer was eliminated (caught nobody)");
  check(pink.alive === true, "the un-caught runner survived");
  check(res.survivorIds.length === 1 && res.survivorIds[0] === pink.id, "lone survivor is the runner");
}

// --- 5) at the buzzer, a frozen runner is eliminated; the freezer who caught them lives
console.log("Freeze Tag — frozen runner is eliminated, the catcher survives");
{
  const g: any = new Tag(mkCtx(players(2, 2), 13));
  g.start();
  const blue = team(g, FREEZER)[0];
  const pink = team(g, RUNNER)[0];
  blue.x = 300; blue.y = 300; blue.inDx = 0; blue.inDy = 0;
  pink.x = 300; pink.y = 300; pink.inDx = 0; pink.inDy = 0;
  g.timer = 30;
  g.tick(DT, 0); // freeze happens
  g.timer = 0.01;
  g.tick(DT, DT); // buzzer
  const res = g.result();
  check(pink.alive === false, "the frozen runner was eliminated");
  check(blue.alive === true, "the freezer who caught them survived");
  check(res.survivorIds.includes(blue.id), "ranking lists the freezer as a survivor");
}

// --- 6) termination + well-formed ranking across many all-bot runs
console.log("Freeze Tag — terminates with a valid survivor ranking");
{
  let ok = 0;
  const runs = 24;
  let minSurv = Infinity, maxSurv = 0;
  for (let s = 0; s < runs; s++) {
    const n = 6;
    const g: any = new Tag(mkCtx(players(n), 1 + s * 97));
    g.start();
    let steps = 0;
    while (!g.isDone() && steps < 130 * 20) { g.tick(DT, steps * DT); steps++; }
    const res = g.result();
    const survivors = res.survivorIds.length;
    minSurv = Math.min(minSurv, survivors);
    maxSurv = Math.max(maxSurv, survivors);
    const ids = new Set(res.ranking.map((r: any) => r.playerId));
    const places = new Set(res.ranking.map((r: any) => r.placement));
    if (g.isDone() && survivors >= 1 && survivors <= n && res.ranking.length === n && ids.size === n && places.size === n) ok++;
  }
  check(ok === runs, `all ${runs} runs terminated well-formed (got ${ok})`);
  console.log(`    survivors ranged ${minSurv}..${maxSurv}`);
}

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll Freeze Tag checks passed.");
