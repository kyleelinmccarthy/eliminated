// The Dead Pool — eliminated spectators (Hardcore only) wager their hard-won
// series Marbles on who'll be the last blob standing. Pure logic lives here so
// the server and the tests agree on the math; GameRoom just calls into it.
//
// Stake source:  the marbles you EARNED this series (never your saved bank).
// Odds:          scale with the field — calling the winner out of a big crowd
//                pays more than calling a 1v1 final. Settled once, at series end.

export interface Bet {
  targetId: string; // the contender you backed to win
  stake: number; // marbles wagered, drawn from your series earnings
  oddsAlive: number; // contenders still standing when the bet was LOCKED → sets the multiplier
}

export const MIN_STAKE = 5;

// Payout multiplier = how many blobs were still in it when you called the winner.
// Backing the champion out of a field of five returns 5× your stake; a coin-flip
// final returns the floor of 2× (even money). Bigger field = longer odds.
export function betMultiplier(oddsAlive: number): number {
  return Math.max(2, Math.floor(oddsAlive || 0));
}

// What a bet does to the bettor's series earnings once the champion is known.
//   win  → +stake·(multiplier − 1)   (the profit; the stake itself was never taken)
//   lose → −stake
// Returns the NET delta to apply to marblesEarned.
export function settleBet(bet: Bet | undefined | null, championId: string | null): number {
  if (!bet || bet.stake <= 0) return 0;
  if (championId && bet.targetId === championId) {
    return bet.stake * (betMultiplier(bet.oddsAlive) - 1);
  }
  return -bet.stake;
}

// The total a winning bet hands back (stake + profit) — for showing payouts.
export function betReturn(bet: Bet): number {
  return bet.stake * betMultiplier(bet.oddsAlive);
}

// Largest stake a spectator may wager: their current series earnings, floored to
// a whole, non-negative number. Guards against NaN / over-betting.
export function clampStake(stake: number, available: number): number {
  if (!Number.isFinite(stake)) return 0;
  return Math.max(0, Math.min(Math.floor(stake), Math.floor(Math.max(0, available))));
}

export interface BetContext {
  mode: "hardcore" | "casual";
  // A pure spectator (sat the series out) may bet in any mode, stakes their real
  // saved Marbles, and is never "in" the field — so the Hardcore-only and
  // must-be-eliminated gates don't apply to them.
  bettorIsSpectator: boolean;
  bettorAlive: boolean; // eliminated players must be dead to bet
  isSelf: boolean; // can't back a corpse — and you're one
  targetAlive: boolean; // your pick must still be in the running
  aliveCount: number; // contenders still standing
  available: number; // the most you can stake (spectator: bank; player: series earnings)
  stake: number; // attempted wager
}

// Returns a player-facing rejection reason, or null if the bet is legal. Centralizing
// this keeps the server's guard and the client's button-disabling in lockstep.
export function betRejectionReason(c: BetContext): string | null {
  // Eliminated-player betting (the original Dead Pool) is a Hardcore-only blood
  // sport and you have to be dead. Spectators skip both gates — they bought a
  // seat in the gallery precisely to wager on the carnage.
  if (!c.bettorIsSpectator) {
    if (c.mode !== "hardcore") return "Betting is a Hardcore-only spectator sport.";
    if (c.bettorAlive) return "Only the eliminated may bet. Get yourself killed first.";
  }
  if (c.aliveCount < 2) return "Nothing left to bet on — the winner's all but decided.";
  if (c.isSelf) return "You can't bet on yourself. You're in a box.";
  if (!c.targetAlive) return "That blob's already boxed up. Back one who's still breathing.";
  if (clampStake(c.stake, c.available) < MIN_STAKE) {
    return c.bettorIsSpectator
      ? `Minimum wager is ${MIN_STAKE} ◍. Win some Marbles first, then come gamble them.`
      : `Minimum wager is ${MIN_STAKE} ◍. Earn a little before you gamble it.`;
  }
  return null;
}
