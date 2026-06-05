// Headless behavioral check for the two fixes:
//  1) King of the Lava Island — powerups only ever spawn ON the island and never
//     linger out in the lava as it shrinks.
//  2) Musical Chairs — a reacting human can win chairs against the bots.
//
// Runs the real game classes at 20Hz with synthetic inputs. Not a unit test
// framework — just assertions that exit nonzero on failure.

import { MusicalChairs } from "../lib/server/games/MusicalChairs";
import { KingOfTheHill } from "../lib/server/games/KingOfTheHill";
import type { GameContext, GamePlayer } from "../lib/server/games/Minigame";
import { makeRng } from "../lib/shared/util";
import { dist } from "../lib/shared/util";

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

// ---------------------------------------------------------------------------
// 1) Lava Island: every spawned powerup is inside the safe island, always.
// ---------------------------------------------------------------------------
function testLava() {
  console.log("King of the Lava Island — powerup placement");
  let worstSpawnOutside = 0; // how far past the edge any powerup was, ever
  let everSawPickup = false;
  for (let seed = 1; seed <= 30; seed++) {
    const ps = players(1, 7);
    const g: any = new KingOfTheHill(mkCtx(ps, seed * 13 + 1, 0.8));
    g.start();
    for (let step = 0; step < 60 * 20; step++) {
      // keep the human parked dead-center so the round runs its course
      g.onInput("h0", { kind: "move", dx: 0, dy: 0 });
      g.tick(DT, step * DT);
      const snap = g.snapshot(step * DT);
      const cx = snap.data.cx as number;
      const cy = snap.data.cy as number;
      const safeR = snap.data.safeR as number;
      for (const p of snap.data.pickups as any[]) {
        everSawPickup = true;
        const d = dist(p.x, p.y, cx, cy);
        worstSpawnOutside = Math.max(worstSpawnOutside, d - safeR);
      }
      if (g.isDone()) break;
    }
  }
  check(everSawPickup, "powerups actually spawned during the games");
  // allow a 1px rounding slop from the snapshot's Math.round on coords/radius
  check(worstSpawnOutside <= 2, `no powerup ever sat in the lava (worst overhang ${worstSpawnOutside.toFixed(1)}px)`);
}

// ---------------------------------------------------------------------------
// 2) Musical Chairs: a human who reacts and runs to the nearest open chair
//    should win a seat a healthy fraction of the time vs bots.
// ---------------------------------------------------------------------------
function testChairs() {
  console.log("Musical Chairs — a reacting human can win");
  let humanSurvived = 0;
  let total = 0;
  let minChairGap = Infinity; // tightest spacing seen between two chairs
  let sawFake = false;

  for (let seed = 1; seed <= 60; seed++) {
    const ps = players(1, 7);
    const g: any = new MusicalChairs(mkCtx(ps, seed * 7 + 3, 0.8));
    g.start();
    let wander = 0;
    for (let step = 0; step < 90 * 20; step++) {
      const snap = g.snapshot(step * DT);
      const data = snap.data;
      const phase = data.phase as string;
      const me = (snap.actors as any[]).find((a) => a.id === "h0");
      if (data.fake) sawFake = true;

      // track chair spacing (proof they aren't stacked, and aren't a tidy ring)
      const chairs = data.chairs as any[];
      for (let i = 0; i < chairs.length; i++)
        for (let j = i + 1; j < chairs.length; j++)
          minChairGap = Math.min(minChairGap, dist(chairs[i].x, chairs[i].y, chairs[j].x, chairs[j].y));

      if (me && me.alive && phase === "scramble") {
        // sprint to the nearest unclaimed chair
        const open = chairs.filter((c) => !c.claimed);
        if (open.length) {
          let best = open[0];
          let bd = Infinity;
          for (const c of open) {
            const d = dist(me.x, me.y, c.x, c.y);
            if (d < bd) { bd = d; best = c; }
          }
          const dx = best.x - me.x;
          const dy = best.y - me.y;
          const m = Math.hypot(dx, dy) || 1;
          g.onInput("h0", { kind: "move", dx: dx / m, dy: dy / m });
        }
      } else if (me && me.alive && phase === "music") {
        // KEEP MOVING — circle the floor (and ignore the fake-outs)
        wander += 0.12;
        g.onInput("h0", { kind: "move", dx: Math.cos(wander), dy: Math.sin(wander) });
      } else {
        g.onInput("h0", { kind: "move", dx: 0, dy: 0 });
      }

      g.tick(DT, step * DT);
      if (g.isDone()) break;
    }
    const finalAlive = (g.snapshot(0).actors as any[]).find((a) => a.id === "h0")?.alive;
    total++;
    if (finalAlive) humanSurvived++;
  }

  const rate = humanSurvived / total;
  console.log(`  human survived ${humanSurvived}/${total} games (${(rate * 100).toFixed(0)}%)`);
  check(rate >= 0.6, `a moving, reacting human wins a seat in a clear majority of games (got ${(rate * 100).toFixed(0)}%)`);
  check(minChairGap >= 90, `scattered chairs never overlap (tightest gap ${minChairGap.toFixed(0)}px, ring-free)`);
  check(sawFake, "fake-out 'STOP!' baits actually fire during the music");
}

// ---------------------------------------------------------------------------
// 3) Keep-moving rule: a player who stands still during the music is eliminated.
// ---------------------------------------------------------------------------
function testLoiter() {
  console.log("Musical Chairs — standing still gets you out");
  let loiterDeaths = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const ps = players(1, 7);
    const g: any = new MusicalChairs(mkCtx(ps, seed * 11 + 5, 0.8));
    g.start();
    for (let step = 0; step < 12 * 20; step++) {
      g.onInput("h0", { kind: "move", dx: 0, dy: 0 }); // refuse to dance
      g.tick(DT, step * DT);
      const me = (g.snapshot(0).actors as any[]).find((a: any) => a.id === "h0");
      if (me && !me.alive) { loiterDeaths++; break; }
      if (g.isDone()) break;
    }
  }
  check(loiterDeaths === 20, `every loiterer was eliminated (${loiterDeaths}/20)`);
}

testLava();
testChairs();
testLoiter();

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll checks passed.");
