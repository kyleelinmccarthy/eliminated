// Shared facts for the legal + patch-notes pages, kept in one place so there's a
// single source of truth for the contact address and the "last updated" date.
//
// ⚠️ BEFORE LAUNCH: change CONTACT_EMAIL to a real inbox you actually read. Privacy
// requests (e.g. "delete my blob") legally need somewhere to land. SITE_NAME/URL are
// cosmetic — tidy them up to match your final domain.

export const SITE_NAME = "Eliminated";
export const SITE_URL = "https://eliminatedgame.com";
export const CONTACT_EMAIL = "hello@eliminatedgame.com"; // must be a real inbox (or forward to one)

// Human-readable date these documents were last touched. Update when you edit them.
export const LEGAL_LAST_UPDATED = "June 5, 2026";

export interface PatchEntry {
  version: string;
  date: string; // human-readable
  tag: "Launch" | "Balance" | "Feature" | "Bugfix" | "Hotfix";
  title: string;
  notes: string[];
}

// Newest first. Add a new object on top each release. Keep the tone; the players can
// smell sincerity and it frightens them.
export const CHANGELOG: PatchEntry[] = [
  {
    version: "1.0.0",
    date: "June 5, 2026",
    tag: "Launch",
    title: "We're Live (You're In Danger)",
    notes: [
      "Opened the doors to the public. Statistically, most of you will not leave through them.",
      "8-player real-time lobbies, a mystery gauntlet of childhood games, and a Hall of Blobs that remembers everything you've done.",
      "Added Patch Notes, a Privacy Policy, and Terms of Service — because going public means lawyers exist now. We're as surprised as you.",
    ],
  },
  {
    version: "0.9.0",
    date: "May 28, 2026",
    tag: "Feature",
    title: "Night Mode & The Finale",
    notes: [
      "Introduced Night Mode: random Hardcore rounds now happen in total darkness, so you can fail to see what kills you. You're welcome.",
      "Every gauntlet now ends on King of Lava Island. The floor is lava, the island shrinks, and dignity is not provided.",
      "Lantern 🔦 powerup added to extend your field of view, and therefore your suffering.",
    ],
  },
  {
    version: "0.8.2",
    date: "May 19, 2026",
    tag: "Balance",
    title: "Powerups Are Now Slightly Less of a Trap",
    notes: [
      "Rebalanced the powerup spawn table. Roughly half of them still want you dead — that's a feature, not a bug.",
      "Red-glow powerups now glow a more honest shade of regret.",
      "Bots will now occasionally walk into the bad powerups too, in the interest of fairness and comedy.",
    ],
  },
  {
    version: "0.8.0",
    date: "May 9, 2026",
    tag: "Bugfix",
    title: "Fixed the Thing You Were Abusing",
    notes: [
      "Patched a desync that let a small number of blobs survive Red Light, Green Light by simply… not following the rules. You know who you are.",
      "Fixed boxes occasionally clapping for the wrong corpse.",
      "Marbles now persist correctly across a series. Your hoard is safe. Your friendships are not.",
    ],
  },
];
