// Checks for Musical Chairs' "keep moving" rule (the heads-up the user asked for):
//   * A player who stops moving during the music is WARNED first — they appear in
//     snapshot.data.warn with a countdown that ticks down — and only THEN, after a
//     significant grace, are they eliminated ("Stopped dancing!").
//   * A player who keeps moving is never warned and survives the music.
//   * Full all-bot runs still terminate with a well-formed survivor ranking.
//
// Exits nonzero on any failure.

import { MusicalChairs } from "../lib/server/games/MusicalChairs";
import type { GameContext, GamePlayer } from "../lib/server/games/Minigame";
import { makeRng } from "../lib/shared/util";

const DT = 1 / 20;

function mkCtx(players: GamePlayer[], seed: number, intensity = 0.5): GameContext {
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

// --- 1) stop moving → warned with a countdown → eliminated (with clear heads-up)
console.log("Musical Chairs — standing still warns you, then eliminates you");
{
  const g: any = new MusicalChairs(mkCtx(players(8, 2), 7));
  g.start();
  check(g.phase === "music", "the round opens in the music phase (no chairs yet)");
  check((g.chairs as any[]).length === 0, "chairs are NOT on the floor during the music");

  const as = [...g.actors.values()];
  const still = as.find((a: any) => a.id === "h0");
  const mover = as.find((a: any) => a.id === "h1");

  let firstWarnAt = -1;
  let diedAt = -1;
  let prevLeft = Infinity;
  let countdownMonotone = true;
  let moverEverWarned = false;
  let elapsed = 0;

  for (let i = 0; i < 200 && g.phase === "music"; i++) {
    // still player feeds NO movement; mover jitters back and forth every frame
    still.inDx = 0; still.inDy = 0;
    mover.inDx = i % 2 ? 1 : -1; mover.inDy = 0;
    g.tick(DT, elapsed * 1000);
    elapsed += DT;

    const warn = g.snapshot(elapsed * 1000).data.warn as { id: string; left: number }[];
    const w = warn.find((x) => x.id === "h0");
    if (w) {
      if (firstWarnAt < 0) firstWarnAt = elapsed;
      if (w.left > prevLeft + 1e-6) countdownMonotone = false;
      prevLeft = w.left;
    }
    if (warn.find((x) => x.id === "h1")) moverEverWarned = true;
    if (!still.alive && diedAt < 0) diedAt = elapsed;
  }

  check(firstWarnAt > 0, "the still player gets a MOVE! warning before any elimination");
  check(diedAt > 0, "the still player is eventually eliminated");
  check(
    diedAt - firstWarnAt >= 0.8,
    `warned ~${(diedAt - firstWarnAt).toFixed(2)}s before the floor takes them (>=0.8s heads-up)`,
  );
  check(countdownMonotone, "the on-screen countdown only ticks DOWN toward 0");
  check(!moverEverWarned, "a player who keeps moving is never warned");
  check(mover.alive, "the player who kept dancing survives the music");
  const note = (g.elimOrder as any[]).find((e) => e.id === "h0")?.note;
  check(note === "Stopped dancing!", `eliminated for the right reason (got "${note}")`);
}

// --- 2) a brief pause (shorter than the grace) is forgiven
console.log("Musical Chairs — a momentary pause does NOT eliminate you");
{
  const g: any = new MusicalChairs(mkCtx(players(8, 1), 11));
  g.start();
  const me = [...g.actors.values()].find((a: any) => a.id === "h0");
  let elapsed = 0;
  // stand still for ~0.9s (under the full grace once startup leeway is spent), then move
  for (let i = 0; i < 18 && g.phase === "music"; i++) {
    me.inDx = 0; me.inDy = 0;
    g.tick(DT, elapsed * 1000); elapsed += DT;
  }
  check(me.alive, "still alive after a brief pause");
  for (let i = 0; i < 20 && g.phase === "music"; i++) {
    me.inDx = i % 2 ? 1 : -1; me.inDy = 0;
    g.tick(DT, elapsed * 1000); elapsed += DT;
  }
  check(me.alive, "moving again clears the danger — no elimination");
}

// --- 3) chairs only appear when the music stops (the scramble), not before
console.log("Musical Chairs — chairs drop only once the music STOPS");
{
  const g: any = new MusicalChairs(mkCtx(players(8), 3));
  g.start();
  let elapsed = 0, sawChairsInMusic = false;
  while (!g.isDone() && elapsed < 60) {
    g.tick(DT, elapsed * 1000); elapsed += DT;
    if (g.phase === "music" && (g.chairs as any[]).length > 0) sawChairsInMusic = true;
    if (g.phase === "scramble") break;
  }
  check(!sawChairsInMusic, "no chairs are ever on the floor during the music phase");
  check(g.phase === "scramble" && (g.chairs as any[]).length > 0, "chairs appear the moment the scramble begins");
}

// --- 4) termination + well-formed ranking across many all-bot runs
console.log("Musical Chairs — terminates with a valid survivor ranking");
{
  let ok = 0;
  const runs = 24;
  let minSurv = Infinity, maxSurv = 0;
  for (let s = 0; s < runs; s++) {
    const n = 8;
    const g: any = new MusicalChairs(mkCtx(players(n), 1 + s * 91));
    g.start();
    let steps = 0;
    while (!g.isDone() && steps < 120 * 20) { g.tick(DT, steps * DT * 1000); steps++; }
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
console.log("\nAll Musical Chairs checks passed.");
