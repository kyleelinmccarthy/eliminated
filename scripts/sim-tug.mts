// Geometry check for Tug of War: every puller must START on their team's LEDGE,
// never out over the central pit (the reported bug). Mirrors renderTug's pit
// layout. Pure-function test — no server, no canvas. Exits nonzero on failure.

import { pullerStandX, tugSide } from "../lib/shared/tug";

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${msg}`);
  if (!cond) failures++;
}

// A representative canvas: pit centered, half-width 160 → pit spans [340, 660].
const W = 1000;
const pitHalf = 160;
const pitL = W / 2 - pitHalf; // 340 — left team's inner edge
const pitR = W / 2 + pitHalf; // 660 — right team's inner edge

console.log("Tug of War — pullers start on the ledge, not over the pit");

// At the start the rope is centered (lean 0): nobody is over the pit.
for (let i = 0; i < 4; i++) {
  const lx = pullerStandX(pitL, tugSide(0), i, 0);
  check(lx < pitL, `team 0 puller ${i} stands on the LEFT ledge (x=${lx} < pitL=${pitL})`);
  const rx = pullerStandX(pitR, tugSide(1), i, 0);
  check(rx > pitR, `team 1 puller ${i} stands on the RIGHT ledge (x=${rx} > pitR=${pitR})`);
}

// Higher index = further back from the pit (further from center), so the front
// puller is the one nearest the void.
check(
  pullerStandX(pitL, tugSide(0), 1, 0) < pullerStandX(pitL, tugSide(0), 0, 0),
  "team 0: a back-row puller sits further from the pit than the front",
);
check(
  pullerStandX(pitR, tugSide(1), 1, 0) > pullerStandX(pitR, tugSide(1), 0, 0),
  "team 1: a back-row puller sits further from the pit than the front",
);

// Lean drags the losing side toward the pit but the winners stay on solid ground.
const heavyLeanLeft = -120; // team 0 winning → formation shifts left
check(
  pullerStandX(pitL, tugSide(0), 0, heavyLeanLeft) < pitL,
  "winning team stays well clear of the pit under lean",
);

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nTug ledge geometry OK.");
