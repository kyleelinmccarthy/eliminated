// WebSocket message protocol shared between client and server.
import type {
  RoomConfig,
  RoomMetaState,
  Snapshot,
  ChatLine,
  ProfileSummary,
} from "./types";

// ---- Client -> Server ----
export type ClientMessage =
  | { t: "hello"; clientId: string; name: string; characterId: string }
  | { t: "createRoom"; config?: Partial<RoomConfig> }
  | { t: "joinRoom"; code: string }
  | { t: "leaveRoom" }
  | { t: "setName"; name: string }
  | { t: "setCharacter"; characterId: string }
  | { t: "setReady"; ready: boolean }
  | { t: "chat"; text: string }
  | { t: "emote"; kind: string }
  | { t: "addBot" }
  | { t: "removeBot"; id: string }
  | { t: "kick"; id: string }
  | { t: "updateConfig"; config: Partial<RoomConfig> }
  | { t: "startSeries" }
  | { t: "returnToLobby" }
  | { t: "input"; input: GameInput }
  | { t: "ping"; ts: number };

// Per-game inputs are unioned here. `seq` lets the server dedupe/reconcile.
export type GameInput =
  | { kind: "move"; dx: number; dy: number; seq?: number } // normalized -1..1
  | { kind: "action"; name: string; on?: boolean } // jump/throw/dash/pull etc
  | { kind: "aim"; angle: number }
  | { kind: "choose"; value: string } // glass bridge L/R, rps throw, etc.
  | { kind: "tap" }; // generic press (tug of war, jump rope)

// ---- Server -> Client ----
export type ServerMessage =
  | { t: "welcome"; clientId: string }
  | { t: "profile"; profile: ProfileSummary }
  | { t: "roomState"; room: RoomMetaState }
  | { t: "snapshot"; snap: Snapshot }
  | { t: "chat"; line: ChatLine }
  | { t: "toast"; text: string; kind?: "info" | "good" | "bad" }
  | { t: "error"; message: string }
  | { t: "pong"; ts: number }
  | { t: "youAre"; playerId: string };

export const WS_PATH = "/ws";
