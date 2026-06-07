// Checks for the reworked Mingle:
//   * GEOMETRY: rooms form an even ring around the central platform — all the
//     same distance from center, evenly spaced, never overlapping the platform
//     or each other, all on-screen.
//   * BEHAVIOR (real Mingle class): players START on the platform; wrong-sized
//     groups (too few OR too many, or stranded on the platform) are eliminated;
//     the round terminates with >= 1 survivor and a full ranking.
//
// Exits nonzero on any failure.

import { Mingle } from "../lib/server/games/Mingle";
import {
  mingleRooms,
  MINGLE_PLATFORM,
  MINGLE_RING_RADIUS,
  MINGLE_ROOM_RADIUS,
  MINGLE_ROOM_COUNT,
} from "../lib/shared/mingle";
import type { GameContext, GamePlayer } from "../lib/server/games/Minigame";
import { makeRng, dist } from "../lib/shared/util";
import { ARENA_W, ARENA_H } from "../lib/shared/constants";

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

// --- 1) geometry: an even ring around the platform
console.log("Mingle — rooms ring the central platform evenly");
{
  const rooms = mingleRooms();
  check(rooms.length === MINGLE_ROOM_COUNT, `${MINGLE_ROOM_COUNT} rooms in the ring`);
  // all equidistant from center
  const dists = rooms.map((r) => dist(r.x, r.y, MINGLE_PLATFORM.x, MINGLE_PLATFORM.y));
  check(dists.every((d) => Math.abs(d - MINGLE_RING_RADIUS) < 1), "every room is the same distance from center");
  // none overlaps the central platform
  check(
    rooms.every((r) => dist(r.x, r.y, MINGLE_PLATFORM.x, MINGLE_PLATFORM.y) > MINGLE_PLATFORM.r + r.r),
    "no room overlaps the platform (platform is NOT a safe room)",
  );
  // adjacent rooms don't overlap each other
  let minGap = Infinity;
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++)
      minGap = Math.min(minGap, dist(rooms[i].x, rooms[i].y, rooms[j].x, rooms[j].y) - 2 * MINGLE_ROOM_RADIUS);
  check(minGap > 0, `rooms don't overlap each other (min gap ${minGap.toFixed(0)})`);
  // all on-screen
  check(
    rooms.every((r) => r.x - r.r >= 0 && r.x + r.r <= ARENA_W && r.y - r.r >= 0 && r.y + r.r <= ARENA_H),
    "all rooms fit inside the arena",
  );
}

// --- 2) players start ON the platform
console.log("Mingle — everyone starts on the spinning platform");
{
  let ok = true;
  for (let s = 0; s < 10; s++) {
    const g: any = new Mingle(mkCtx(players(8), 3 + s * 17));
    g.start();
    for (const a of g.actors.values()) {
      if (dist(a.x, a.y, MINGLE_PLATFORM.x, MINGLE_PLATFORM.y) > MINGLE_PLATFORM.r + 1) ok = false;
    }
  }
  check(ok, "all players begin within the central platform");
}

// --- 3) wrong-sized groups are eliminated (too few AND too many)
console.log("Mingle — wrong group sizes get eliminated");
{
  const g: any = new Mingle(mkCtx(players(6, 6), 21));
  g.start();
  const rooms = g.rooms as { x: number; y: number; r: number }[];
  const as = [...g.actors.values()];
  // call groups of 2
  g.phase = "mingle";
  g.callN = 2;
  // a perfect pair in room 0
  as[0].x = rooms[0].x; as[0].y = rooms[0].y;
  as[1].x = rooms[0].x; as[1].y = rooms[0].y;
  // a lonely one in room 1 (too few)
  as[2].x = rooms[1].x; as[2].y = rooms[1].y;
  // a crowd of THREE in room 2 (too many)
  as[3].x = rooms[2].x; as[3].y = rooms[2].y;
  as[4].x = rooms[2].x; as[4].y = rooms[2].y;
  as[5].x = rooms[2].x; as[5].y = rooms[2].y;
  g.timer = 0.001;
  g.tick(DT, 0); // triggers evaluate()
  check(as[0].alive && as[1].alive, "the exact pair survives");
  check(!as[2].alive, "the lonely one (too few) is eliminated");
  check(!as[3].alive && !as[4].alive && !as[5].alive, "the over-crowded trio (too many) is eliminated");
}

// --- 4) a player left standing on the platform when the music stops is out
console.log("Mingle — dawdling on the platform is fatal");
{
  const g: any = new Mingle(mkCtx(players(3, 3), 23));
  g.start();
  const rooms = g.rooms as { x: number; y: number; r: number }[];
  const as = [...g.actors.values()];
  g.phase = "mingle";
  g.callN = 2;
  as[0].x = rooms[0].x; as[0].y = rooms[0].y;
  as[1].x = rooms[0].x; as[1].y = rooms[0].y;
  as[2].x = MINGLE_PLATFORM.x; as[2].y = MINGLE_PLATFORM.y; // stuck on the platform
  g.timer = 0.001;
  g.tick(DT, 0);
  check(as[0].alive && as[1].alive, "the pair in a room survives");
  check(!as[2].alive, "the player stranded on the platform is eliminated");
}

// --- 5) termination + well-formed ranking across many all-bot runs
console.log("Mingle — terminates with a valid survivor ranking");
{
  let ok = 0;
  const runs = 24;
  let minSurv = Infinity, maxSurv = 0;
  for (let s = 0; s < runs; s++) {
    const n = 8;
    const g: any = new Mingle(mkCtx(players(n), 1 + s * 91));
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
console.log("\nAll Mingle checks passed.");
