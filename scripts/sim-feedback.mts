// Headless termination/sanity check for the games reworked in this pass.
// Drives the real game classes at 20Hz with all-bot rosters (and, for glass, an
// idle "human" to exercise the turn-timeout path). Asserts each game: terminates
// within a step budget, leaves >= 1 survivor, and returns a ranking covering
// every player exactly once. Exits nonzero on any failure. No server needed.

import { GlassBridge } from "../lib/server/games/GlassBridge";
import { ChutesAndLadders } from "../lib/server/games/ChutesAndLadders";
import { RpsMinusOne } from "../lib/server/games/RpsMinusOne";
import { Tag } from "../lib/server/games/Tag";
import { KingOfTheHill } from "../lib/server/games/KingOfTheHill";
import { PresentSwap } from "../lib/server/games/PresentSwap";
import { MusicalChairs } from "../lib/server/games/MusicalChairs";
import { PropHunt } from "../lib/server/games/PropHunt";
import { TugOfWar } from "../lib/server/games/TugOfWar";
import type { GameContext, GamePlayer, Minigame } from "../lib/server/games/Minigame";
import { makeRng } from "../lib/shared/util";

const DT = 1 / 20;

function mkCtx(players: GamePlayer[], seed: number, intensity: number, force = false): GameContext {
  return {
    players,
    map: { id: "x", name: "x", theme: "x" } as any,
    rng: makeRng(seed),
    friendlyFire: true,
    emitFx: () => {},
    toast: () => {},
    roundIndex: 1,
    totalRounds: 3,
    isFinale: force,
    intensity,
    night: false,
    forceSingleSurvivor: force,
  };
}

function players(n: number, humansIdle = 0): GamePlayer[] {
  const ps: GamePlayer[] = [];
  for (let i = 0; i < humansIdle; i++) ps.push({ id: `h${i}`, name: `Human${i}`, characterId: "avo", isBot: false });
  for (let i = 0; i < n - humansIdle; i++) ps.push({ id: `b${i}`, name: `Bot${i}`, characterId: "avo", isBot: true });
  return ps;
}

let failures = 0;
function check(cond: boolean, msg: string) {
  if (!cond) {
    console.log(`  ✗ FAIL ${msg}`);
    failures++;
  }
}

function runOne(label: string, make: (seed: number) => Minigame, n: number, maxSec = 130): void {
  let okRuns = 0;
  let minSurv = Infinity;
  let maxSurv = 0;
  const seeds = 24;
  for (let s = 0; s < seeds; s++) {
    const g = make(1 + s * 97); // vary the seed per run for real coverage
    g.start();
    let steps = 0;
    const cap = maxSec * 20;
    while (!g.isDone() && steps < cap) {
      g.tick(DT, steps * DT);
      steps++;
    }
    const done = g.isDone();
    const res = g.result();
    const survivors = res.survivorIds.length;
    minSurv = Math.min(minSurv, survivors);
    maxSurv = Math.max(maxSurv, survivors);
    // ranking must cover every player exactly once with unique placements
    const ids = new Set(res.ranking.map((r) => r.playerId));
    const placements = new Set(res.ranking.map((r) => r.placement));
    const wellFormed =
      done &&
      survivors >= 1 &&
      survivors <= n &&
      res.ranking.length === n &&
      ids.size === n &&
      placements.size === n;
    if (wellFormed) okRuns++;
    else if (failures < 30) {
      console.log(
        `    seed ${s}: done=${done} surv=${survivors} rankLen=${res.ranking.length} ids=${ids.size} (n=${n})`,
      );
    }
  }
  check(okRuns === seeds, `${label}: all ${seeds} runs terminated with a valid single-or-more survivor ranking (got ${okRuns})`);
  console.log(`  ${okRuns === seeds ? "✓" : "·"} ${label} — survivors ${minSurv}..${maxSurv} across ${seeds} runs`);
}

console.log("Reworked-games sanity sim:");
runOne("Glass (turn-based, idle human)", (s) => new GlassBridge(mkCtx(players(6, 1), s, 0.6)), 6);
runOne("Glass (all bots, high intensity)", (s) => new GlassBridge(mkCtx(players(8), s, 0.9)), 8);
runOne("Glass (gentle, low intensity)", (s) => new GlassBridge(mkCtx(players(8), s, 0.2)), 8);
runOne("Chutes & Ladders (gentle)", (s) => new ChutesAndLadders(mkCtx(players(6), s, 0.2)), 6);
runOne("Chutes & Ladders (brutal)", (s) => new ChutesAndLadders(mkCtx(players(8), s, 0.9)), 8);
runOne("RPS Minus One (even)", (s) => new RpsMinusOne(mkCtx(players(6), s, 0.7)), 6);
runOne("RPS Minus One (finale bracket)", (s) => new RpsMinusOne(mkCtx(players(8), s, 0.9, true)), 8);
runOne("Freeze Tag (even, slow)", (s) => new Tag(mkCtx(players(6), s, 0.6)), 6);
runOne("King of Lava Island (finale)", (s) => new KingOfTheHill(mkCtx(players(6), s, 0.9, true)), 6);
runOne("Secret Santa Sabotage", (s) => new PresentSwap(mkCtx(players(6), s, 0.6)), 6);
runOne("Musical Chairs", (s) => new MusicalChairs(mkCtx(players(6), s, 0.6)), 6);
runOne("Prop Hunt", (s) => new PropHunt(mkCtx(players(6), s, 0.6)), 6);
runOne("Tug of War", (s) => new TugOfWar(mkCtx(players(6), s, 0.6)), 6);

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll reworked-game sims passed.");
