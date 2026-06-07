// Shared domain types used by both the server and the client.

export type GameId =
  | "redlight"
  | "tag"
  | "mingle"
  | "glassbridge"
  | "tugofwar"
  | "rpsminusone"
  | "jumprope"
  | "boomerang"
  | "dodgeball"
  | "musicalchairs"
  | "present"
  | "prophunt"
  | "chutesladders"
  | "simonsays"
  | "keepyuppy"
  | "koth";

export type RoomPhase =
  | "lobby"
  | "intro" // game master reveal + countdown
  | "playing" // minigame active
  | "roundResult" // eliminations shown
  | "seriesResult"; // final standings

export type SeriesMode = "hardcore" | "casual";

export interface RoomConfig {
  mode: SeriesMode;
  // Number of rounds. "mystery" => hidden random count chosen by the game master.
  rounds: "mystery" | number;
  // Pool of games the game master may draw from. Empty => all games.
  allowedGames: GameId[];
  botFill: boolean; // auto-fill empty slots with bots at series start
  maxPlayers: number;
  friendlyFire: boolean;
  // Hardcore modifier: when on, random rounds go dark (flashlight + vision powerups).
  nightMode: boolean;
}

// A wager an eliminated spectator has placed in the Dead Pool (hardcore only).
// Public so the table can see who the vultures are backing; the bettor reads it
// back to recover their own bet after a reconnect.
export interface PublicBet {
  targetId: string; // contender backed to win
  stake: number; // marbles wagered (from series earnings)
  oddsAlive: number; // field size when locked → payout multiplier
}

export interface PublicPlayer {
  id: string;
  name: string;
  number: number; // Squid Game-style player number (1..456), unique per room
  characterId: string;
  accessories: string[]; // equipped cosmetic ids (≤ one per slot)
  ready: boolean;
  isBot: boolean;
  isHost: boolean;
  connected: boolean;
  alive: boolean; // alive in the current series (hardcore) / this round
  marblesEarned: number; // earned this series
  points: number; // running series score (casual ranking / tiebreaks)
  title?: string;
  emote?: { kind: string; at: number };
  bet?: PublicBet; // Dead Pool wager, if this (eliminated) blob has placed one
}

export interface RoomMetaState {
  code: string;
  phase: RoomPhase;
  hostId: string;
  config: RoomConfig;
  players: PublicPlayer[];
  // Series progress
  roundIndex: number; // 0-based index of current/last game
  roundsRevealed: number; // how many games revealed so far
  totalRoundsKnown: boolean; // whether the count is public (non-mystery)
  totalRounds: number; // only meaningful if totalRoundsKnown
  currentGame: GameId | null;
  currentMapId: string | null;
  // For intro/result overlays
  intro?: IntroPayload;
  lastResult?: RoundResult;
  seriesResult?: SeriesResult;
}

export interface IntroPayload {
  game: GameId;
  mapId: string;
  roundNumber: number; // 1-based
  countdownMs: number;
  startsAt: number; // server epoch ms
  flavor: string;
  isFinale?: boolean; // the climactic last game of the series
  night?: boolean; // this round runs in the dark
}

export interface RoundResultEntry {
  playerId: string;
  survived: boolean;
  placement: number; // 1 = best this round
  marbles: number; // marbles awarded this round
  note?: string; // "Fell!", "Caught moving", "Tagged out", etc.
}

export interface RoundResult {
  game: GameId;
  roundNumber: number;
  entries: RoundResultEntry[];
  survivorIds: string[];
}

export interface SeriesStanding {
  playerId: string;
  name: string;
  number: number; // player's Squid Game number
  characterId: string;
  placement: number; // 1 = champion
  marbles: number;
  roundsSurvived: number;
  isBot: boolean;
  title: string;
}

export interface SeriesResult {
  standings: SeriesStanding[];
  championId: string | null;
}

// ---- Per-tick game snapshot ----
// Each minigame produces an opaque-ish snapshot. We keep a shared envelope and
// let each game define its `data` shape (typed in lib/shared/games-state.ts).
export interface Snapshot {
  game: GameId;
  t: number; // server tick time (ms)
  // Server epoch ms when play unfreezes. Present only during the pre-round
  // "3·2·1·GO" hold (the board is shown but logic/input are frozen); absent
  // once the game is live.
  startAt?: number;
  // Generic actor list used by most arena games (movement/combat).
  actors?: Actor[];
  // Per-game payload.
  data?: any;
  // One-shot visual effects to spawn on clients this frame.
  fx?: Effect[];
}

export interface Actor {
  id: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  facing?: number; // radians
  characterId: string;
  name: string;
  alive: boolean;
  // status flags
  it?: boolean; // tag "it"
  team?: number;
  carrying?: string; // powerup id / held item (e.g. dodgeball "ball")
  scale?: number; // size multiplier (tiny/giant)
  ghost?: boolean;
  shield?: boolean;
  frozen?: boolean; // freeze tag: held in place until thawed
  burning?: boolean; // floor-is-lava: standing in lava
  vision?: number; // night mode: flashlight radius (arena units)
  flash?: number; // hurt flash 0..1
  anim?: string; // current animation hint (run/idle/fall/cheer/dead)
  progress?: number; // generic 0..1 (e.g. glass bridge row)
}

export type EffectKind =
  | "death"
  | "confetti"
  | "splat"
  | "poof"
  | "spark"
  | "shockwave"
  | "pickup"
  | "shatter"
  | "ring"
  | "shake";

export interface Effect {
  kind: EffectKind;
  x: number;
  y: number;
  color?: string;
  scale?: number;
  text?: string;
}

export interface ChatLine {
  from: string;
  name: string;
  text: string;
  at: number;
  system?: boolean;
}

export interface ProfileSummary {
  clientId: string;
  name: string;
  marbles: number;
  wins: number;
  gamesPlayed: number;
  roundsSurvived: number;
  bestTitle: string;
  unlocked: string[];
}
