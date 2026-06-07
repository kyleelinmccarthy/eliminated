// Tunable constants shared across client and server.

export const TICK_HZ = 20; // server simulation + snapshot rate
export const TICK_MS = 1000 / TICK_HZ;

export const ARENA_W = 1280; // logical arena units (server space)
export const ARENA_H = 720;

export const PLAYER_RADIUS = 26;
export const PLAYER_SPEED = 240; // units / second

export const ROOM_CODE_LEN = 4;
export const MAX_PLAYERS = 8;
export const MIN_TO_START = 2;

export const CURRENCY = "Marbles";
export const CURRENCY_ICON = "◍";

export const DEFAULT_CONFIG = {
  mode: "casual" as const,
  rounds: "mystery" as const,
  allowedGames: [] as never[],
  botFill: true,
  maxPlayers: MAX_PLAYERS,
  friendlyFire: true,
  nightMode: false,
};

// Marble payouts
export const MARBLES = {
  survivePerRound: 50,
  roundWinBonus: 40,
  elimParticipation: 5,
  championBonus: 300,
  placementCurve: [200, 120, 80, 50, 30], // 1st..5th place series bonus
};

// Titles awarded by final placement / feats (bragging rights).
export const TITLES = [
  "The Last Blob Standing",
  "First Loser",
  "Bronze Is Just Shiny Last",
  "Mid-Tier Menace",
  "Cannon Fodder",
];

export function placementTitle(placement: number): string {
  return TITLES[Math.min(placement - 1, TITLES.length - 1)];
}
