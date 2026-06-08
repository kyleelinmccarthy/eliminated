import type { ServerMessage } from "../shared/protocol";
import type { PublicPlayer } from "../shared/types";
import type { Bet } from "../shared/betting";

export class Player {
  id: string; // unique within room
  clientId: string; // persistent (profile key); bots get a synthetic one
  name: string;
  number = 0; // Squid Game-style player number, assigned by the room on join
  characterId: string;
  accessories: string[] = []; // equipped cosmetics (≤ one per slot)
  ready = false;
  isBot: boolean;
  isHost = false;
  connected = true;
  // Sat out the series on purpose — never plays, never culled, just watches and
  // bets. Toggled in the lobby; bots are never spectators.
  isSpectator = false;

  // series state
  alive = true;
  marblesEarned = 0;
  points = 0;
  roundsSurvived = 0;
  title?: string;
  emote?: { kind: string; at: number };
  bet?: Bet; // Dead Pool wager (eliminated players, hardcore — or any spectator)
  // Spectator betting balance: seeded from the player's real saved Marbles at
  // series start (bankStart), wagered through the Dead Pool, and reconciled back
  // to the bank as a signed delta (bankroll − bankStart) at series end. Players
  // (non-spectators) ignore these — they stake marblesEarned instead.
  bankroll = 0;
  bankStart = 0;

  // transport (undefined for bots / disconnected)
  send?: (msg: ServerMessage) => void;

  constructor(opts: {
    id: string;
    clientId: string;
    name: string;
    characterId: string;
    accessories?: string[];
    isBot?: boolean;
  }) {
    this.id = opts.id;
    this.clientId = opts.clientId;
    this.name = opts.name;
    this.characterId = opts.characterId;
    this.accessories = opts.accessories ?? [];
    this.isBot = !!opts.isBot;
  }

  toPublic(): PublicPlayer {
    return {
      id: this.id,
      name: this.name,
      number: this.number,
      characterId: this.characterId,
      accessories: this.accessories,
      ready: this.ready,
      isBot: this.isBot,
      isHost: this.isHost,
      connected: this.connected,
      isSpectator: this.isSpectator,
      alive: this.alive,
      marblesEarned: this.marblesEarned,
      bankroll: this.isSpectator ? this.bankroll : undefined,
      points: this.points,
      title: this.title,
      emote: this.emote,
      bet: this.bet ? { targetId: this.bet.targetId, stake: this.bet.stake, oddsAlive: this.bet.oddsAlive } : undefined,
    };
  }
}
