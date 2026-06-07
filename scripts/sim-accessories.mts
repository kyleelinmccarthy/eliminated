// TDD coverage for cosmetic accessories.
//   * Catalog integrity: unique ids (no collision with characters), valid slots,
//     real prices, a draw kind.
//   * Slot equip rules: at most one per slot; toggle on/off; sanitize junk.
//   * Unified cosmeticCost() prices both accessories and paid characters.
//   * unlockCosmetic() (in-memory DB) debits marbles, grants ownership, and never
//     double-charges.
// Exits nonzero on any failure.

// Isolate the DB to an in-memory Turso so we never touch the real ./data file.
process.env.DATABASE_URL = ":memory:";

import {
  ACCESSORIES,
  ACCESSORY_SLOTS,
  accessoryById,
  equippedBySlot,
  sanitizeEquipped,
  toggleEquip,
  cosmeticCost,
} from "../lib/shared/accessories";
import { CHARACTERS, FREE_CHARACTERS } from "../lib/shared/characters";
import { getOrCreateProfile, recordSeries, unlockCosmetic } from "../lib/server/db";

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${msg}`);
  if (!cond) failures++;
}

async function main() {
  console.log("Accessories — catalog, slots & purchase");

  // ---- catalog integrity ----
  const ids = ACCESSORIES.map((a) => a.id);
  check(new Set(ids).size === ids.length, "accessory ids are unique");
  const charIds = new Set(CHARACTERS.map((c) => c.id));
  check(ids.every((id) => !charIds.has(id)), "no accessory id collides with a character id");
  check(
    ACCESSORIES.every((a) => ACCESSORY_SLOTS.includes(a.slot)),
    "every accessory has a valid slot",
  );
  check(ACCESSORIES.every((a) => a.price > 0), "every accessory costs marbles (none free)");
  check(ACCESSORIES.every((a) => !!a.kind && !!a.c1), "every accessory has a draw kind + color");
  check(
    ACCESSORY_SLOTS.every((s) => ACCESSORIES.some((a) => a.slot === s)),
    "every slot has at least one accessory to wear",
  );

  // ---- equip-by-slot (one per slot, last wins) ----
  const both = equippedBySlot(["glasses", "shades"]); // both are eyes
  check(both.eyes?.id === "shades" && !both.head, "two eyes items collapse to the last one");
  const full = equippedBySlot(["tophat", "glasses", "bandana", "flower"]);
  check(
    !!(full.head && full.eyes && full.neck && full.ear),
    "one item per slot all coexist (hat + glasses + bandana + flower)",
  );
  check(accessoryById("tophat")?.slot === "head", "accessoryById resolves a known id");
  check(accessoryById("nope") === undefined, "accessoryById returns undefined for junk");

  // ---- toggleEquip ----
  let eq: string[] = [];
  eq = toggleEquip(eq, "glasses");
  check(eq.includes("glasses"), "toggle on adds the item");
  eq = toggleEquip(eq, "shades"); // same slot replaces
  check(eq.includes("shades") && !eq.includes("glasses"), "same-slot toggle replaces");
  eq = toggleEquip(eq, "shades"); // toggle off
  check(!eq.includes("shades"), "toggling the worn item takes it off");
  eq = toggleEquip(eq, "bogus");
  check(eq.length === 0, "toggling an unknown id is a no-op");

  // ---- sanitize (server guard) ----
  const dirty = sanitizeEquipped(["tophat", "beanie", "glasses", "junk", 7, "flower"]);
  check(
    dirty.filter((id) => accessoryById(id)?.slot === "head").length === 1,
    "sanitize keeps only one head item",
  );
  check(!dirty.includes("junk") && !dirty.some((x) => typeof x !== "string"), "sanitize drops junk");
  check(sanitizeEquipped("not an array" as any).length === 0, "sanitize handles non-arrays");

  // ---- cosmeticCost across both catalogs ----
  check(cosmeticCost("flower") === 90, "accessory price via cosmeticCost");
  const paidChar = CHARACTERS.find((c) => c.unlock)!;
  check(cosmeticCost(paidChar.id) === paidChar.unlock, "paid character price via cosmeticCost");
  check(cosmeticCost(FREE_CHARACTERS[0]) === undefined, "free character has no cost");
  check(cosmeticCost("totally-fake") === undefined, "unknown id has no cost");

  // ---- unlockCosmetic against an in-memory profile ----
  const key = "test_acc_buyer";
  await getOrCreateProfile(key, "Buyer");
  await recordSeries([
    { clientId: key, name: "Buyer", marbles: 500, won: false, roundsSurvived: 3, title: "x" },
  ]);

  const poor = await unlockCosmetic(key, "tophat", 360);
  check("unlocked" in poor && poor.unlocked.includes("tophat"), "buying the top hat grants it");
  check("marbles" in poor && poor.marbles === 140, "buying debits the price (500 − 360 = 140)");

  const tooDear = await unlockCosmetic(key, "shades", 260); // only 140 left
  check("error" in tooDear, "can't afford → error, no purchase");

  const again = await unlockCosmetic(key, "tophat", 360); // already owned
  check("marbles" in again && again.marbles === 140, "re-buying an owned item never double-charges");

  if (failures) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAccessories OK.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
