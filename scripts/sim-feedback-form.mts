// Tests for the player-feedback feature:
//   * validateFeedback: rejects empty/over-long messages and bad emails, accepts
//     valid ones, normalizes category + context.
//   * db.saveFeedback: persists (here, via the in-memory fallback when no DB is
//     configured) and is readable back.
//
// Pure + in-memory — no server, no real DB. Exits nonzero on failure.

// Use an isolated in-memory DB so the test never pollutes the dev sqlite file.
// (If libsql can't open it, db.ts falls back to its in-memory store — also fine;
// recentFeedback reads from whichever backend is active.)
process.env.DATABASE_URL = ":memory:";

import { validateFeedback, FEEDBACK_LIMITS } from "../lib/shared/feedback";
import { saveFeedback, recentFeedback } from "../lib/server/db";

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${msg}`);
  if (!cond) failures++;
}

console.log("Feedback — validation");
{
  check(!validateFeedback({ message: "" }).ok, "empty message rejected");
  check(!validateFeedback({ message: "  " }).ok, "whitespace-only message rejected");
  check(!validateFeedback({ message: "x".repeat(FEEDBACK_LIMITS.messageMax + 1) }).ok, "over-long message rejected");
  check(!validateFeedback({ message: "great game", email: "not-an-email" }).ok, "bad email rejected");

  const ok = validateFeedback({ message: "  the tug rope put me over the pit  ", category: "bug", email: " me@example.com " });
  check(ok.ok, "valid feedback accepted");
  check(ok.value?.message === "the tug rope put me over the pit", "message is trimmed");
  check(ok.value?.email === "me@example.com", "email is trimmed");
  check(ok.value?.category === "bug", "valid category kept");

  const anon = validateFeedback({ message: "love it", category: "nonsense" as any });
  check(anon.ok, "anonymous feedback (no email) accepted");
  check(anon.value?.email === null, "missing email normalizes to null");
  check(anon.value?.category === "other", "unknown category falls back to 'other'");

  const longCtx = validateFeedback({ message: "hi", context: "c".repeat(5000) });
  check((longCtx.value?.context?.length ?? 0) <= FEEDBACK_LIMITS.context, "context is capped");
}

console.log("Feedback — persistence");
{
  const marker = "snakes are too mean @ 2026-06-07T00:00:00.000Z";
  await saveFeedback({ message: marker, email: null, category: "idea", context: "page=/ game=chutesladders", clientId: "c_test", createdAt: "2026-06-07T00:00:00.000Z" });
  const recent = await recentFeedback(50);
  const found = recent.find((r) => r.message === marker);
  check(!!found, "saveFeedback stored and is retrievable");
  check(found?.category === "idea", "stored category round-trips");
  check(found?.clientId === "c_test" && found?.createdAt === "2026-06-07T00:00:00.000Z", "metadata persisted");
  check(found?.email === null, "anonymous email stored as null");
}

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll feedback checks passed.");
