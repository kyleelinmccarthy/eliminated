import type { ServerMessage } from "../shared/protocol";
import type { PublicPlayer } from "../shared/types";

export class Player {
  id: string; // unique within room
  clientId: string; // persistent (profile key); bots get a synthetic one
  name: string;
  number = 0; // Squid Game-style player number, assigned by the room on join
  characterId: string;
  ready = false;
  isBot: boolean;
  isHost = false;
  connected = true;

  // series state
  alive = true;
  marblesEarned = 0;
  points = 0;
  roundsSurvived = 0;
  title?: string;
  emote?: { kind: string; at: number };

  // transport (undefined for bots / disconnected)
  send?: (msg: ServerMessage) => void;

  constructor(opts: {
    id: string;
    clientId: string;
    name: string;
    characterId: string;
    isBot?: boolean;
  }) {
    this.id = opts.id;
    this.clientId = opts.clientId;
    this.name = opts.name;
    this.characterId = opts.characterId;
    this.isBot = !!opts.isBot;
  }

  toPublic(): PublicPlayer {
    return {
      id: this.id,
      name: this.name,
      number: this.number,
      characterId: this.characterId,
      ready: this.ready,
      isBot: this.isBot,
      isHost: this.isHost,
      connected: this.connected,
      alive: this.alive,
      marblesEarned: this.marblesEarned,
      points: this.points,
      title: this.title,
      emote: this.emote,
    };
  }
}
