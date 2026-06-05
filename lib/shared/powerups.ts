// Powerup catalog shared by the server (effects), the canvas renderer (pickup
// icons), and the how-to-play page. À la Boomerang Fu: a mix of blessings and
// curses, so grabbing a glowing orb is always a gamble.

export type PowerupKind =
  | "speed"
  | "shield"
  | "tiny"
  | "vision"
  | "bamboozled"
  | "slow"
  | "giant"
  | "dizzy";

export interface PowerupMeta {
  id: PowerupKind;
  icon: string;
  label: string;
  good: boolean;
  blurb: string;
}

export const POWERUPS: Record<PowerupKind, PowerupMeta> = {
  speed: { id: "speed", icon: "⚡", label: "Zoomies", good: true, blurb: "Move way faster, briefly, like your will to live." },
  shield: { id: "shield", icon: "🛡️", label: "Bubble", good: true, blurb: "Blocks one hit, freeze, or lava splash. Singular. Spend it wisely." },
  tiny: { id: "tiny", icon: "🔻", label: "Shrink", good: true, blurb: "Become a tiny, nimble, harder-to-murder blob." },
  vision: { id: "vision", icon: "🔦", label: "Lantern", good: true, blurb: "See in the dark. See exactly how doomed you are." },
  bamboozled: { id: "bamboozled", icon: "🌀", label: "Bamboozled", good: false, blurb: "Your controls are REVERSED. Sincerely, the management." },
  slow: { id: "slow", icon: "🐌", label: "Molasses", good: false, blurb: "Sluggish, syrupy, an easy target with extra steps." },
  giant: { id: "giant", icon: "🎈", label: "Embiggen", good: false, blurb: "Puff up huge — a bigger, prouder target." },
  dizzy: { id: "dizzy", icon: "💫", label: "Dizzy", good: false, blurb: "Wibble-wobble. Your steering develops opinions of its own." },
};

export const ALL_POWERUPS = Object.keys(POWERUPS) as PowerupKind[];
export const GOOD_POWERUPS = ALL_POWERUPS.filter((k) => POWERUPS[k].good);
export const BAD_POWERUPS = ALL_POWERUPS.filter((k) => !POWERUPS[k].good);

// Quick icon lookup for renderers (kept in sync with the catalog above).
export const POWERUP_ICONS: Record<string, string> = Object.fromEntries(
  ALL_POWERUPS.map((k) => [k, POWERUPS[k].icon]),
);
