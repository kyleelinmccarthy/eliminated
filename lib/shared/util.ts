// Small shared helpers: RNG, vectors, ids, and name pools.

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt(dist2(ax, ay, bx, by));
}

// Mulberry32 — tiny seeded PRNG for deterministic-ish game setups.
export function makeRng(seed: number) {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export function pick<T>(rng: Rng, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function shuffle<T>(rng: Rng, arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
export function makeRoomCode(len = 4): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

export function makeId(prefix = ""): string {
  return (
    prefix +
    Math.random().toString(36).slice(2, 8) +
    Math.random().toString(36).slice(2, 6)
  );
}

// Squid Game-style player numbers: each blob gets a unique 1..456 tag, shown
// zero-padded to three digits ("067", "456") on tracksuit-style badges.
export const MAX_PLAYER_NUMBER = 456;

export function formatPlayerNumber(n: number | undefined | null): string {
  return n && n > 0 ? String(n).padStart(3, "0") : "—";
}

export const BOT_FIRST = [
  "Wiggly",
  "Squishy",
  "Chompy",
  "Bouncy",
  "Mr.",
  "Lil",
  "Big",
  "Captain",
  "Sir",
  "Lady",
  "Doctor",
  "Sneaky",
  "Sleepy",
  "Wobbly",
  "Zesty",
  "Crunchy",
  "Gloopy",
  "Spicy",
];

export const BOT_LAST = [
  "Beans",
  "Nugget",
  "Pickles",
  "Wobbles",
  "Munch",
  "Snackington",
  "Crumbs",
  "Noodle",
  "Biscuit",
  "Tofu",
  "Gravy",
  "Sprout",
  "Dumpling",
  "Waffles",
  "Pretzel",
  "Mochi",
];

export function botName(): string {
  const a = BOT_FIRST[Math.floor(Math.random() * BOT_FIRST.length)];
  const b = BOT_LAST[Math.floor(Math.random() * BOT_LAST.length)];
  return `${a} ${b}`;
}
