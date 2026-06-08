// TDD coverage for the Dead Pool (lib/shared/betting.ts) — pure math, no server.
//   * Odds scale with the field (min 2× even money).
//   * Settlement: win pays profit = stake·(mult−1); loss eats the stake.
//   * Stake clamping never lets you over-bet or NaN your earnings.
//   * Rejection rules match the spec (Hardcore-only, eliminated-only, etc).
// Exits nonzero on any failure.

import {
  betMultiplier,
  settleBet,
  betReturn,
  clampStake,
  betRejectionReason,
  MIN_STAKE,
  type Bet,
  type BetContext,
} from "../lib/shared/betting";

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${msg}`);
  if (!cond) failures++;
}

console.log("Dead Pool — odds & settlement math");

// ---- odds scale with field ----
check(betMultiplier(5) === 5, "5 contenders → 5× multiplier");
check(betMultiplier(2) === 2, "final 1v1 → 2× (even money)");
check(betMultiplier(1) === 2, "lone survivor edge → floored at 2×");
check(betMultiplier(0) === 2, "zero/garbage → floored at 2×");
check(betMultiplier(4.9) === 4, "fractional field is floored");

// ---- settlement ----
const bet: Bet = { targetId: "A", stake: 100, oddsAlive: 4 };
check(settleBet(bet, "A") === 300, "win: +stake·(mult−1) = 100·3 = 300 profit");
check(settleBet(bet, "B") === -100, "loss: −stake when your pick isn't champion");
check(settleBet(bet, null) === 0 - 100, "no champion (freak case) → lose stake");
check(settleBet(undefined, "A") === 0, "no bet → no change");
check(settleBet({ targetId: "A", stake: 0, oddsAlive: 3 }, "A") === 0, "zero stake → no change");
check(betReturn(bet) === 400, "winning return = stake + profit = 400");

const finalBet: Bet = { targetId: "X", stake: 80, oddsAlive: 2 };
check(settleBet(finalBet, "X") === 80, "even-money win returns 80 profit");

// ---- stake clamping ----
check(clampStake(150, 100) === 100, "can't stake more than you've earned");
check(clampStake(50, 100) === 50, "an affordable stake passes through");
check(clampStake(-5, 100) === 0, "negative stake clamps to 0");
check(clampStake(NaN, 100) === 0, "NaN stake clamps to 0");
check(clampStake(33.9, 100) === 33, "stake is floored to a whole marble");
check(clampStake(50, -10) === 0, "no earnings → nothing to stake");

// ---- rejection rules: eliminated-player Dead Pool (Hardcore only) ----
const base: BetContext = {
  mode: "hardcore",
  bettorIsSpectator: false,
  bettorAlive: false,
  isSelf: false,
  targetAlive: true,
  aliveCount: 4,
  available: 200,
  stake: 50,
};
check(betRejectionReason(base) === null, "a legal wager is accepted");
check(!!betRejectionReason({ ...base, mode: "casual" }), "casual mode is rejected for players");
check(!!betRejectionReason({ ...base, bettorAlive: true }), "the living can't bet");
check(!!betRejectionReason({ ...base, aliveCount: 1 }), "no bet once the winner's decided");
check(!!betRejectionReason({ ...base, isSelf: true }), "can't back yourself");
check(!!betRejectionReason({ ...base, targetAlive: false }), "can't back an eliminated blob");
check(!!betRejectionReason({ ...base, stake: MIN_STAKE - 1 }), "below the minimum is rejected");
check(
  betRejectionReason({ ...base, stake: 9999 }) === null,
  "an over-stake is clamped, not rejected (UI caps it to earnings)",
);

// ---- rejection rules: gallery spectator (any mode, stakes their bank) ----
const spec: BetContext = { ...base, bettorIsSpectator: true };
check(betRejectionReason(spec) === null, "a spectator's legal wager is accepted");
check(
  betRejectionReason({ ...spec, mode: "casual" }) === null,
  "spectators may bet in Casual too — not a Hardcore-only privilege",
);
check(
  betRejectionReason({ ...spec, bettorAlive: true }) === null,
  "the must-be-eliminated gate doesn't apply to spectators (they never play)",
);
check(!!betRejectionReason({ ...spec, aliveCount: 1 }), "spectator: nothing to bet on at 1 left");
check(!!betRejectionReason({ ...spec, targetAlive: false }), "spectator: can't back a dead blob");
check(
  !!betRejectionReason({ ...spec, available: MIN_STAKE - 1 }),
  "spectator with an empty bank can't bet",
);

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nDead Pool math OK.");
