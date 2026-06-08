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
    version: "1.2.0",
    date: "June 8, 2026",
    tag: "Feature",
    title: "Pull Up a Chair (The Gallery)",
    notes: [
      "👁 SPECTATE: don't feel like dying today? In the lobby, hit “Spectate & bet instead” to sit the whole run out. You never take the field, you never get culled — you just watch the little blobs suffer in peace.",
      "🎰 THE GALLERY: spectating isn't free entertainment, it's a casino. Bet your real saved Marbles on who you think wins it all and pocket the winnings — odds scale with the field (call it from a crowd of five and it pays 5×), settled the instant a champion is crowned.",
      "Unlike the eliminated-player Dead Pool, the Gallery is open in BOTH Casual and Hardcore — and you're wagering your actual bank, not house chips. Win big, or watch your Marbles walk off with someone else's blob. Your pick gets boxed up mid-run? You're warned to re-bet before the finale.",
      "Spectators don't count toward starting a match — load the lobby with watchers and the host can still kick things off (just keep enough contestants or bot-fill on). A whole room of vultures and six bots? Now legal.",
    ],
  },
  {
    version: "1.1.0",
    date: "June 7, 2026",
    tag: "Feature",
    title: "Drip & The Dead Pool",
    notes: [
      "👒 ACCESSORIES: spend your Marbles dressing your blob to die in style. Hats (beanie, baseball cap, party hat, cowboy hat, top hat, crown), eyewear (round & square glasses, cat-eye, sunglasses, aviators, round shades), neckwear (outlaw bandana, dapper bow tie), and a little something behind the ear (flowers in every color, a feather, even a banana). Buy them in the lobby under “Dress your blob.”",
      "Mix and match one item per slot — hat + shades + bandana + ear-flower all at once — and everyone sees your full ensemble in every game. Looking incredible offers exactly zero protection. As intended.",
      "☠️ THE DEAD POOL (Hardcore only): being eliminated is no longer just spectating. Bet the Marbles you earned this run on who'll be the last blob standing and keep cashing in from the afterlife.",
      "Odds scale with the field: call the winner while the crowd is big and it pays big (a five-blob field pays 5×); wait for the 1v1 final and it's even money. Your pick gets boxed up? You're warned to re-bet before the finale — or kiss the wager goodbye. Settled the instant a champion is crowned.",
      "Bots now show up with a little random drip of their own, because of course they do.",
    ],
  },
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
      "Every gauntlet now ends on a proper finale — a last decisive round, and in Hardcore it doesn't stop until exactly one blob is left standing. Dignity, in any case, is not provided.",
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
