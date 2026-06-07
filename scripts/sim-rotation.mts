// Simulate the game-rotation scheduler over many series to measure (a) how even
// the per-game distribution is and (b) how often the SAME game lands back-to-back
// (including across series boundaries — the case the cross-series tail fixes).
//
// "new" calls the REAL GameRoom.chooseGame. "old" is a faithful replica of the
// pre-change logic (lastGame reset to null each series, no recent tail) driven by
// the same RNG + alive-count sequence, so the comparison is apples-to-apples.
//
// Run: npx tsx scripts/sim-rotation.mts

import { GameRoom } from "../lib/server/GameRoom";
import { GAMES, ALL_GAME_IDS } from "../lib/shared/games";
import { minPlayersFor } from "../lib/server/games/registry";
import { makeRng, pick, type Rng } from "../lib/shared/util";
import type { GameId } from "../lib/shared/types";

const SERIES = 4000;
const RECENT_GAMES_WINDOW = 3; // must match GameRoom

// Plausible hardcore decay: start with a full-ish lobby, funnel toward 1 by the
// finale. Same sequence is fed to both schedulers.
function aliveFor(round: number, totalRounds: number, start: number): number {
  if (round >= totalRounds - 1) return Math.max(1, Math.min(start, 2)); // finale: ~1-2 left
  const t = totalRounds <= 1 ? 1 : round / (totalRounds - 1);
  return Math.max(2, Math.round(start - t * (start - 2)));
}

// ---- OLD scheduler: faithful replica of pre-change chooseGame + lifecycle ----
function makeOld(rng: Rng) {
  let lastGame: GameId | null = null;
  let playedGames: GameId[] = [];
  let roundIndex = 0;
  let totalRounds = 0;
  const isFinal = () => totalRounds > 0 && roundIndex >= totalRounds - 1;
  const playable = (g: GameId, alive: number) =>
    minPlayersFor(g) <= alive && (!GAMES[g].requiresEven || alive % 2 === 0);
  return {
    startSeries(tr: number) {
      roundIndex = 0;
      lastGame = null; // <- the old reset that drops cross-series memory
      playedGames = [];
      totalRounds = tr;
    },
    setRound(r: number) {
      roundIndex = r;
    },
    choose(alive: number): GameId {
      let chosen: GameId;
      if (isFinal()) {
        const canFinale = (g: GameId) => (GAMES[g].finale || GAMES[g].finaleCapable) && playable(g, alive);
        const finales = ALL_GAME_IDS.filter(canFinale);
        const noRepeat = finales.filter((g) => g !== lastGame);
        const pool = noRepeat.length ? noRepeat : finales;
        chosen = pick(rng, pool.length ? pool : ["koth"]);
      } else {
        let pool = ALL_GAME_IDS.filter((g) => !GAMES[g].finale && playable(g, alive));
        if (pool.length === 0) pool = ["redlight"];
        if (roundIndex === 0) {
          const gentle = pool.filter((g) => GAMES[g].cull !== "high");
          if (gentle.length) pool = gentle;
        }
        const fresh = pool.filter((g) => !playedGames.includes(g));
        let finalPool = fresh.length ? fresh : pool.filter((g) => g !== lastGame);
        if (!finalPool.length) finalPool = pool;
        chosen = pick(rng, finalPool);
      }
      if (!playedGames.includes(chosen)) playedGames.push(chosen);
      return chosen;
    },
    endRound(g: GameId) {
      lastGame = g;
    },
  };
}

// ---- NEW scheduler: drive the REAL GameRoom.chooseGame via a thin harness ----
function makeNew(seed: number) {
  const room = new GameRoom("SIMR", seed) as any;
  room.config = { ...room.config, mode: "hardcore", allowedGames: [] };
  return {
    startSeries(tr: number) {
      // mirror GameRoom.startSeries: playedGames resets, lastGame/recentGames persist
      room.roundIndex = 0;
      room.totalRounds = tr;
      room.totalRoundsKnown = true;
      room.playedGames = [];
    },
    setRound(r: number) {
      room.roundIndex = r;
    },
    choose(alive: number): GameId {
      const g: GameId = room.chooseGame(alive);
      // mirror GameRoom.beginIntro bookkeeping
      room.currentGame = g;
      if (!room.playedGames.includes(g)) room.playedGames.push(g);
      room.recentGames = [...room.recentGames.filter((x: GameId) => x !== g), g].slice(-RECENT_GAMES_WINDOW);
      return g;
    },
    endRound(_g: GameId) {
      // mirror end-of-round: lastGame = currentGame
      room.lastGame = room.currentGame;
    },
  };
}

function run(sched: ReturnType<typeof makeOld>, seriesRng: Rng) {
  const counts: Record<string, number> = {};
  for (const g of ALL_GAME_IDS) counts[g] = 0;
  let total = 0;
  let backToBack = 0; // same game immediately after another (incl. across series)
  let prev: GameId | null = null;
  for (let s = 0; s < SERIES; s++) {
    const totalRounds = 3 + Math.floor(seriesRng() * 4); // 3..6
    const start = 4 + Math.floor(seriesRng() * 5); // 4..8 lobby
    sched.startSeries(totalRounds);
    for (let r = 0; r < totalRounds; r++) {
      sched.setRound(r);
      const g = sched.choose(aliveFor(r, totalRounds, start));
      counts[g]++;
      total++;
      if (prev === g) backToBack++;
      prev = g;
      sched.endRound(g);
    }
  }
  return { counts, total, backToBack };
}

function report(label: string, r: ReturnType<typeof run>) {
  const entries = Object.entries(r.counts).sort((a, b) => b[1] - a[1]);
  const pcts = entries.map(([, c]) => (c / r.total) * 100);
  const max = Math.max(...pcts);
  const min = Math.min(...pcts);
  const ideal = 100 / ALL_GAME_IDS.length;
  console.log(`\n=== ${label} ===`);
  console.log(`rounds played: ${r.total}`);
  console.log(`back-to-back repeats: ${r.backToBack} (${((r.backToBack / r.total) * 100).toFixed(2)}%)`);
  console.log(`distribution spread: max ${max.toFixed(1)}% / min ${min.toFixed(1)}% (even would be ${ideal.toFixed(1)}%)`);
  for (const [g, c] of entries) {
    const pct = (c / r.total) * 100;
    const bar = "█".repeat(Math.round(pct));
    console.log(`  ${g.padEnd(14)} ${pct.toFixed(1).padStart(5)}%  ${bar}`);
  }
}

// Same series params + same RNG seeds for both, so it's a fair comparison.
report("OLD (reset lastGame each series, no recent tail)", run(makeOld(makeRng(12345)), makeRng(999)));
report("NEW (persist lastGame + recent tail across series)", run(makeNew(12345), makeRng(999)));
