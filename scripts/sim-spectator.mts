// End-to-end coverage for SPECTATE MODE driven through a real GameRoom:
//   * A spectator never enters the field (never a participant, never "alive"),
//     so bot-fill still musters a full roster around them.
//   * A spectator's gallery wager settles at series end against their REAL bank,
//     and the signed swing persists (winnings credited / losses debited) WITHOUT
//     bumping gamesPlayed — they didn't compete.
// Runs against an in-memory DB and a controllable clock so the whole series plays
// out in a tight loop. Exits nonzero on any failure.

process.env.DATABASE_URL = ":memory:"; // isolate from the local sqlite file

import { GameRoom } from "../lib/server/GameRoom";
import { Player } from "../lib/server/Player";
import { DEFAULT_CONFIG, TICK_MS } from "../lib/shared/constants";
import { getOrCreateProfile, recordSeries } from "../lib/server/db";

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${msg}`);
  if (!cond) failures++;
}

// --- controllable clock: GameRoom mixes Date.now() (timer fields) with the now
// passed to update(); override both with one counter so phases advance lockstep.
let CLOCK = 1_000_000;
(Date as any).now = () => CLOCK;

function human(id: string, name: string): Player {
  const p = new Player({ id, clientId: "spec_test_" + id, name, characterId: "avo" });
  p.send = () => {}; // swallow toasts/snapshots
  return p;
}

console.log("Spectate mode — field exclusion, betting & persistence");

const SPEC_BANK = 500;
const STAKE = 100;

// Pre-seed the spectator's saved bank so they have real Marbles to wager.
const spec = human("spec", "Voyeur");
await recordSeries([
  { clientId: spec.clientId, name: spec.name, marbles: SPEC_BANK, won: false, roundsSurvived: 0, title: "Blob" },
]);
const before = await getOrCreateProfile(spec.clientId, spec.name);
check(before.marbles === SPEC_BANK && before.gamesPlayed === 1, `seeded bank = ${SPEC_BANK}, gamesPlayed = 1`);

const room = new GameRoom("SPEC", 7);
room.config = { ...DEFAULT_CONFIG, mode: "hardcore", rounds: 3, allowedGames: [], botFill: true };

const host = human("host", "Host");
room.addPlayer(host); // first in => host
room.addPlayer(spec);
room.handle(spec, { t: "setSpectate", on: true });
check(spec.isSpectator, "spectator flag set via setSpectate");

room.handle(host, { t: "startSeries" });
check(room.phase !== "lobby", "series started (host pulled the trigger)");

// Let the async bankroll seeding (a DB read kicked off in startSeries) resolve —
// in-game the ~8s intro/GO hold covers this before any round can be bet on.
const flush = () => new Promise<void>((r) => setImmediate(r));
for (let k = 0; k < 8; k++) await flush();
check(spec.bankroll === SPEC_BANK, `gallery bankroll seeded from the real bank (${spec.bankroll})`);

// Field should be host + bot-fill, spectator excluded.
const competitors = [...room.players.values()].filter((p) => !p.isSpectator);
check(competitors.length >= 2, `bot-fill mustered a field of ${competitors.length} around the spectator`);
check(spec.alive === false, "spectator is never 'alive' in the field");

// Run the whole series on the simulated clock; bet the moment play begins, and
// assert the spectator never lands in the round's participant list.
let betPlaced = false;
let everParticipated = false;
let target: Player | undefined;
for (let i = 0; i < 60_000 && room.phase !== "seriesResult"; i++) {
  CLOCK += TICK_MS;
  room.update(CLOCK);

  if ((room as any).participants?.includes(spec.id)) everParticipated = true;

  if (!betPlaced && (room.phase === "intro" || room.phase === "playing")) {
    target = [...room.players.values()].find((p) => p.isBot && p.alive);
    if (target) {
      room.handle(spec, { t: "placeBet", targetId: target.id, stake: STAKE });
      betPlaced = !!spec.bet;
    }
  }
}

check(room.phase === "seriesResult", "series reached its conclusion");
check(!everParticipated, "spectator was NEVER a round participant");
check(betPlaced, "spectator placed a gallery wager");
check(spec.bet === undefined, "wager was settled (cleared) at series end");

const champ = (room as any).seriesResult?.championId as string | null;
const standings = (room as any).seriesResult?.standings ?? [];
check(!standings.some((s: any) => s.playerId === spec.id), "spectator is absent from the final standings");

// Bankroll reflects the bet outcome: backed the champion => up; otherwise => down.
const won = !!champ && target?.id === champ;
if (won) check(spec.bankroll > SPEC_BANK, `winning bet grew the bankroll (${SPEC_BANK} → ${spec.bankroll})`);
else check(spec.bankroll < SPEC_BANK, `losing bet shrank the bankroll (${SPEC_BANK} → ${spec.bankroll})`);

// Persistence: the swing is banked for real, and spectating didn't inflate stats.
// (endSeries fires recordSeries fire-and-forget — let it land before we read back.)
for (let k = 0; k < 8; k++) await flush();
const after = await getOrCreateProfile(spec.clientId, spec.name);
check(after.marbles === spec.bankroll, `bank persisted to match bankroll (${after.marbles})`);
check(after.gamesPlayed === 1, "spectating did NOT increment gamesPlayed (still 1)");

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nSpectate mode OK.");
