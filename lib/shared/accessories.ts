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
  // ---- head ----
  {
    id: "beanie",
    name: "Last Warm Thought",
    slot: "head",
    kind: "beanie",
    c1: "#ef5350",
    c2: "#fff3e0",
    price: 120,
    catchphrase: "Cozy right up until the end.",
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
    id: "tophat",
    name: "Cap Capitalist",
    slot: "head",
    kind: "tophat",
    c1: "#23202b",
    c2: "#c9a24a",
    price: 360,
    catchphrase: "Old money. New corpse.",
  },
  // ---- eyes ----
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
    id: "shades",
    name: "Future's So Bright",
    slot: "eyes",
    kind: "shades",
    c1: "#16181d",
    c2: "#5d4037",
    price: 260,
    catchphrase: "Too cool to flinch.",
  },
  // ---- neck ----
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
  // ---- ear ----
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
