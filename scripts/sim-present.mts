// Secret Santa Sabotage — verifies the giver now actively HANDS OUT the gift
// (the bug the user hit: it used to auto-assign). Specifically:
//   * The round opens in a "gift" phase where chosen givers pick a target; the
//     pick is honored — whoever a giver taps becomes their receiver.
//   * Secrecy holds: the public snapshot NEVER carries a giverId before the
//     reveal; the giver's identity/slate rides ONLY the per-player `secret`.
//   * Collisions resolve — two givers tapping the same blob still end up with
//     DISTINCT receivers (the bounded one-elimination-per-gift invariant).
//   * A correct guess catches the giver; a wrong guess fools the receiver.
//   * Full all-bot runs terminate with a well-formed survivor ranking.
//
// Exits nonzero on any failure.

import { PresentSwap } from "../lib/server/games/PresentSwap";
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

const tick = (g: any, n: number, t0 = 0) => {
  for (let i = 0; i < n && !g.isDone(); i++) g.tick(DT, (t0 + i) * DT * 1000);
};
const tickUntil = (g: any, want: string, cap = 400) => {
  let i = 0;
  for (; i < cap && g.phase !== want && !g.isDone(); i++) g.tick(DT, i * DT * 1000);
  return i;
};

// --- 1) opens in the gift phase with un-assigned gifts ---------------------
console.log("Present — the round opens with givers choosing (nothing auto-assigned)");
{
  const g: any = new PresentSwap(mkCtx(players(8), 5));
  g.start();
  check(g.phase === "gift", "round opens in the GIFT phase (givers pick, not auto-assign)");
  check(g.events.length >= 1, `at least one giver was selected (${g.events.length})`);
  check(g.events.every((e: any) => e.targetId === null), "no gift has a target yet — nothing handed out");
  check(g.events.every((e: any) => e.targetSlate.length >= 1), "every giver has a slate of candidate marks");
  // givers ⊄ their own slate (you can't gift yourself)
  check(g.events.every((e: any) => !e.targetSlate.includes(e.giverId)), "a giver is never in their own target slate");
}

// --- 2) a giver's pick is honored -----------------------------------------
console.log("Present — whoever the giver taps becomes the receiver");
{
  // 4 players, low intensity -> exactly one giver (k=1), so no collisions.
  const g: any = new PresentSwap(mkCtx(players(4, 4), 9, 0.3));
  g.start();
  check(g.events.length === 1, `single giver this round (k=${g.events.length})`);
  const ev = g.events[0];
  const mark = ev.targetSlate[1] ?? ev.targetSlate[0]; // deliberately not slate[0]
  g.onInput(ev.giverId, { kind: "choose", value: mark });
  check(ev.targetId === mark, "the giver's tap is recorded as their chosen target");
  tickUntil(g, "guess");
  check(g.phase === "guess", "advances to the guessing phase once gifts are locked");
  check(g.events[0].receiverId === mark, "the chosen mark is exactly who received the gift");
  check(g.events[0].candidateIds.includes(g.events[0].giverId), "the real giver is among the receiver's suspects");
}

// --- 3) secrecy: no giverId in the public snapshot before the reveal -------
console.log("Present — the giver stays secret until the reveal");
{
  const g: any = new PresentSwap(mkCtx(players(8), 21));
  g.start();
  const giverIds = new Set<string>(g.events.map((e: any) => e.giverId));

  // GIFT phase snapshot
  let snap = g.snapshot(0);
  const giftPublic = JSON.stringify(snap.data);
  check([...giverIds].every((id) => !giftPublic.includes(id)), "GIFT: no giver id appears in public snapshot data");
  check((snap.data.events || []).length === 0, "GIFT: public events are empty (receivers not revealed yet)");
  check(!!snap.secrets, "GIFT: a private secrets map exists");
  check(
    [...giverIds].every((id) => snap.secrets[id]?.role === "giver" && Array.isArray(snap.secrets[id].targetSlate)),
    "GIFT: each giver privately learns they're a giver + their slate",
  );
  const nonGiver = ["b0", "b1", "b2", "b3", "b4", "b5", "b6", "b7"].find((id) => !giverIds.has(id))!;
  check(snap.secrets[nonGiver] === undefined, "GIFT: a non-giver gets NO secret payload");

  // GUESS phase snapshot
  tickUntil(g, "guess");
  snap = g.snapshot(0);
  const guessPublic = JSON.stringify(snap.data);
  check([...giverIds].some((id) => g.events.some((e: any) => e.giverId === id)), "givers still tracked internally");
  check(
    snap.data.events.every((e: any) => e.receiverId && Array.isArray(e.candidateIds) && e.giverId === undefined),
    "GUESS: public events expose receiver + suspects but NOT the giver",
  );
  // the giver privately learns who they hit (safe — only their own socket gets it)
  check(
    [...giverIds].every((id) => snap.secrets?.[id]?.gaveToId),
    "GUESS: each giver privately sees who their gift landed on",
  );

  // REVEAL phase snapshot
  tickUntil(g, "reveal");
  snap = g.snapshot(0);
  check(
    snap.data.events.every((e: any) => typeof e.giverId === "string"),
    "REVEAL: the giver is finally exposed",
  );
  check(snap.secrets === undefined, "REVEAL: no more secrets once the truth is out");
}

// --- 4) colliding picks still resolve to distinct receivers ----------------
console.log("Present — two givers tapping the same blob still get distinct receivers");
{
  // 6 players @ 0.5 -> k=2 givers, pool of 4 (each slate == whole pool), so we
  // can force BOTH givers onto the same mark.
  const g: any = new PresentSwap(mkCtx(players(6, 6), 33, 0.5));
  g.start();
  check(g.events.length === 2, `two givers this round (k=${g.events.length})`);
  const common = g.events[0].targetSlate[0];
  check(g.events[1].targetSlate.includes(common), "both givers share the same candidate pool");
  g.onInput(g.events[0].giverId, { kind: "choose", value: common });
  g.onInput(g.events[1].giverId, { kind: "choose", value: common });
  tickUntil(g, "guess");
  const r0 = g.events[0].receiverId;
  const r1 = g.events[1].receiverId;
  check(r0 !== r1, "the collision was broken — receivers are distinct");
  check(r0 === common || r1 === common, "one giver kept the contested mark");
  const giverSet = new Set(g.events.map((e: any) => e.giverId));
  check(![r0, r1].some((r) => giverSet.has(r)), "no giver was also made a receiver (roles stay disjoint)");
}

// --- 5) right guess catches the giver, wrong guess fools the receiver ------
console.log("Present — correct guess catches the giver; wrong guess fools the receiver");
{
  const g: any = new PresentSwap(mkCtx(players(4, 4), 4, 0.3));
  g.start();
  const ev = g.events[0];
  g.onInput(ev.giverId, { kind: "choose", value: ev.targetSlate[0] });
  tickUntil(g, "guess");
  const e = g.events[0];
  g.onInput(e.receiverId, { kind: "choose", value: e.giverId }); // accuse correctly
  tickUntil(g, "reveal");
  const seat = (id: string) => g.seats.get(id);
  check(e.correct === true && e.result === "caught", "a correct accusation is marked caught");
  check(seat(e.giverId).alive === false, "the caught giver is eliminated");
  check(seat(e.receiverId).alive === true, "the sharp receiver survives");
}
{
  const g: any = new PresentSwap(mkCtx(players(4, 4), 8, 0.3));
  g.start();
  const ev = g.events[0];
  g.onInput(ev.giverId, { kind: "choose", value: ev.targetSlate[0] });
  tickUntil(g, "guess");
  const e = g.events[0];
  const wrong = e.candidateIds.find((id: string) => id !== e.giverId)!;
  g.onInput(e.receiverId, { kind: "choose", value: wrong }); // accuse the wrong blob
  tickUntil(g, "reveal");
  const seat = (id: string) => g.seats.get(id);
  check(e.correct === false && e.result === "fooled", "a wrong accusation is marked fooled");
  check(seat(e.receiverId).alive === false, "the fooled receiver is eliminated");
  check(seat(e.giverId).alive === true, "the sneaky giver gets away with it");
}

// --- 6) all-bot runs terminate with a valid, bounded ranking ---------------
console.log("Present — all-bot runs terminate with a well-formed, bounded ranking");
{
  let ok = 0;
  const runs = 30;
  let minSurv = Infinity, maxSurv = 0;
  for (let s = 0; s < runs; s++) {
    const n = 8;
    const g: any = new PresentSwap(mkCtx(players(n), 1 + s * 77, 0.4 + (s % 3) * 0.2));
    g.start();
    // re-validate invariants every time a round locks in
    let invariantsOk = true;
    let lastPhase = g.phase;
    let steps = 0;
    while (!g.isDone() && steps < 80 * 20) {
      g.tick(DT, steps * DT * 1000);
      steps++;
      if (g.phase === "guess" && lastPhase !== "guess") {
        // just locked in this round's gifts — check disjointness + distinctness
        const givers = g.events.map((e: any) => e.giverId);
        const recvs = g.events.map((e: any) => e.receiverId);
        const gset = new Set(givers), rset = new Set(recvs);
        if (gset.size !== givers.length || rset.size !== recvs.length) invariantsOk = false;
        if (givers.some((id: string) => rset.has(id))) invariantsOk = false; // disjoint
        if (g.events.some((e: any) => !e.candidateIds.includes(e.giverId))) invariantsOk = false;
      }
      lastPhase = g.phase;
    }
    const res = g.result();
    const survivors = res.survivorIds.length;
    minSurv = Math.min(minSurv, survivors);
    maxSurv = Math.max(maxSurv, survivors);
    const ids = new Set(res.ranking.map((r: any) => r.playerId));
    const places = new Set(res.ranking.map((r: any) => r.placement));
    if (
      g.isDone() && invariantsOk && survivors >= 1 && survivors <= n &&
      res.ranking.length === n && ids.size === n && places.size === n
    ) ok++;
  }
  check(ok === runs, `all ${runs} runs terminated well-formed with invariants intact (got ${ok})`);
  console.log(`    survivors ranged ${minSurv}..${maxSurv}`);
}

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll Present (Secret Santa Sabotage) checks passed.");
