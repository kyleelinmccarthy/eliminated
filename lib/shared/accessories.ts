// Cosmetic accessories worn ON TOP of any blob — hats, eyewear, neckwear, and a
// little something behind the ear. Bought with Marbles like characters, but where
// a character IS your blob, accessories layer over whatever blob you've chosen.
//
// Like the blob roster, everything here is pure data: a slot, a `kind` the canvas
// renderer special-cases, and the colors to paint it with. No image assets.
//
// Equip rule: at most ONE accessory per slot, so a hat + shades + bandana + ear
// flower can all stack, but you can't wear two hats. `equippedBySlot` enforces it.

import { getCharacter } from "./characters";

export type AccessorySlot = "head" | "eyes" | "neck" | "ear";

export interface Accessory {
  id: string;
  name: string;
  slot: AccessorySlot;
  kind: string; // draw routine selector (see drawAccessories in render/draw.ts)
  c1: string; // primary color
  c2?: string; // secondary / accent color
  price: number; // marbles to unlock (always paid — there are no free accessories)
  catchphrase: string;
}

// Cheapest first within each slot, so the picker reads as a little price ladder.
export const ACCESSORIES: Accessory[] = [
  // ---- head (hats) ----
  {
    id: "beanie",
    name: "Last Warm Thought",
    slot: "head",
    kind: "beanie",
    c1: "#46618f", // slate-blue knit (no longer santa red)
    c2: "#e0a23c", // mustard folded cuff
    price: 120,
    catchphrase: "Cozy right up until the end.",
  },
  {
    id: "cap",
    name: "Last At Bat",
    slot: "head",
    kind: "cap",
    c1: "#2e7d5b",
    c2: "#f4f4f0",
    price: 150,
    catchphrase: "Three strikes. You know the rest.",
  },
  {
    id: "partyhat",
    name: "Final Party",
    slot: "head",
    kind: "partyhat",
    c1: "#ff7ab0",
    c2: "#ffd54f",
    price: 180,
    catchphrase: "It's a celebration. Of your removal.",
  },
  {
    id: "cowboy",
    name: "Last Rodeo",
    slot: "head",
    kind: "cowboy",
    c1: "#a9743f",
    c2: "#5b3a22",
    price: 280,
    catchphrase: "This town's about to get smaller.",
  },
  {
    id: "tophat",
    name: "Cap Capitalist",
    slot: "head",
    kind: "tophat",
    c1: "#23202b",
    c2: "#c9a24a",
    price: 360,
    catchphrase: "Old money. New corpse.",
  },
  {
    id: "crown",
    name: "Heavy Is the Head",
    slot: "head",
    kind: "crown",
    c1: "#f5c945",
    c2: "#e23b4e",
    price: 420,
    catchphrase: "Uneasy lies the head. Then it just lies there.",
  },
  // ---- eyes (eyewear) ----
  {
    id: "glasses",
    name: "Hindsight 20/20",
    slot: "eyes",
    kind: "glasses",
    c1: "#2a2733",
    c2: "#bfe9ff",
    price: 140,
    catchphrase: "You'll see it coming. Won't help.",
  },
  {
    id: "specs",
    name: "Fine Print",
    slot: "eyes",
    kind: "squareglasses",
    c1: "#3a2f2a",
    c2: "#bfe9ff",
    price: 160,
    catchphrase: "You read the rules. They got you anyway.",
  },
  {
    id: "cateye",
    name: "Last Look",
    slot: "eyes",
    kind: "cateye",
    c1: "#c2185b",
    c2: "#ffd54f",
    price: 190,
    catchphrase: "Cat-eye. Nine lives not included.",
  },
  {
    id: "rounds",
    name: "Dead Cool",
    slot: "eyes",
    kind: "roundshades",
    c1: "#1b1d22",
    c2: "#b08d57",
    price: 240,
    catchphrase: "Too round to give a damn.",
  },
  {
    id: "shades",
    name: "Future's So Bright",
    slot: "eyes",
    kind: "shades",
    c1: "#16181d",
    c2: "#5d4037",
    price: 260,
    catchphrase: "Too cool to flinch.",
  },
  {
    id: "aviators",
    name: "Top Gunned",
    slot: "eyes",
    kind: "aviators",
    c1: "#2b3a3f",
    c2: "#d4af37",
    price: 300,
    catchphrase: "Maverick energy. Wingman gone.",
  },
  // ---- neck (neckwear) ----
  {
    id: "bandana",
    name: "Dead Man's Bandana",
    slot: "neck",
    kind: "bandana",
    c1: "#e53935",
    c2: "#fff",
    price: 110,
    catchphrase: "Outlaw energy. Indoor lifespan.",
  },
  {
    id: "bowtie",
    name: "Dressed to Kill",
    slot: "neck",
    kind: "bowtie",
    c1: "#7b3f9e",
    c2: "#ffd54f",
    price: 220,
    catchphrase: "Look sharp, die sharp.",
  },
  // ---- ear (behind the ear) ----
  {
    id: "banana",
    name: "Slippery Slope",
    slot: "ear",
    kind: "banana",
    c1: "#ffd83b", // ripe yellow
    c2: "#6b4a2b", // brown stem + tip
    price: 80,
    catchphrase: "One wrong step. Classic.",
  },
  {
    id: "flower",
    name: "Pushing Daisies",
    slot: "ear",
    kind: "flower",
    c1: "#ff8fb3",
    c2: "#ffd54f",
    price: 90,
    catchphrase: "A blossom for the bereaved.",
  },
  {
    id: "greenana",
    name: "Not Quite Ripe",
    slot: "ear",
    kind: "banana",
    c1: "#bcd14a", // green
    c2: "#5a6b2b",
    price: 100,
    catchphrase: "Cut down before your time. Literally.",
  },
  {
    id: "rose",
    name: "Bleeding Heart",
    slot: "ear",
    kind: "flower",
    c1: "#e23b4e", // red
    c2: "#ffd54f",
    price: 130,
    catchphrase: "Romance is dead. You're next.",
  },
  {
    id: "bluebell",
    name: "Forget-Me-Now",
    slot: "ear",
    kind: "flower",
    c1: "#5b8def", // blue
    c2: "#fff3a0",
    price: 150,
    catchphrase: "They will. Almost immediately.",
  },
  {
    id: "sunflower",
    name: "Late Bloomer",
    slot: "ear",
    kind: "flower",
    c1: "#ffca28", // yellow
    c2: "#6d4c2f", // brown seed center
    price: 170,
    catchphrase: "Reaching for the sun. Caught the reaper.",
  },
  {
    id: "spotnana",
    name: "Past Your Prime",
    slot: "ear",
    kind: "spotbanana",
    c1: "#e3a92f", // overripe golden-brown
    c2: "#5a3b22",
    price: 190,
    catchphrase: "A few spots. A lot of regrets.",
  },
  {
    id: "feather",
    name: "Plumage of Doom",
    slot: "ear",
    kind: "feather",
    c1: "#26c6da",
    c2: "#fff",
    price: 200,
    catchphrase: "Light as a feather. Stiff as a board.",
  },
];

export const ACCESSORY_SLOTS: AccessorySlot[] = ["head", "eyes", "neck", "ear"];

const BY_ID = new Map(ACCESSORIES.map((a) => [a.id, a]));

export function accessoryById(id: string): Accessory | undefined {
  return BY_ID.get(id);
}

// Resolve an equipped id list to at most one accessory per slot. Later ids win,
// so toggling on a second "eyes" item naturally replaces the first.
export function equippedBySlot(ids: string[] | undefined): Partial<Record<AccessorySlot, Accessory>> {
  const out: Partial<Record<AccessorySlot, Accessory>> = {};
  if (!ids) return out;
  for (const id of ids) {
    const a = BY_ID.get(id);
    if (a) out[a.slot] = a;
  }
  return out;
}

// Canonicalize an arbitrary id list into a safe equipped set: known ids only,
// one per slot, in a stable slot order. Used server-side on every setAccessories
// so a client can never wear two hats (or junk ids) no matter what it sends.
export function sanitizeEquipped(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const bySlot = equippedBySlot(ids.filter((x): x is string => typeof x === "string"));
  return ACCESSORY_SLOTS.map((s) => bySlot[s]?.id).filter((x): x is string => !!x);
}

// Toggle an owned accessory in an equipped list: turn it off if already on, else
// turn it on and kick out whatever shared its slot. Pure — returns a new list.
export function toggleEquip(equipped: string[], id: string): string[] {
  const acc = BY_ID.get(id);
  if (!acc) return equipped;
  const already = equipped.includes(id);
  const cleared = equipped.filter((e) => {
    const a = BY_ID.get(e);
    return a && a.slot !== acc.slot; // drop anything in the same slot
  });
  return already ? cleared : [...cleared, id];
}

// Unified cost lookup across BOTH cosmetic catalogs (accessories + characters),
// so the single /api/unlock endpoint can price anything buyable. Returns
// undefined for free/unknown ids (nothing to charge for).
export function cosmeticCost(id: string): number | undefined {
  const acc = BY_ID.get(id);
  if (acc) return acc.price;
  const ch = getCharacter(id);
  // getCharacter falls back to CHARACTERS[0] for unknown ids; treat that as
  // "unknown" unless the id actually matches a paid character.
  if (ch.id === id && ch.unlock) return ch.unlock;
  return undefined;
}
