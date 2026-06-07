import type { WebSocket } from "ws";
import { GameRoom } from "./GameRoom";
import { Player } from "./Player";
import type { ClientMessage, ServerMessage } from "../shared/protocol";
import { TICK_MS, MAX_PLAYERS } from "../shared/constants";
import { makeRoomCode, makeId } from "../shared/util";
import { sanitizeEquipped } from "../shared/accessories";
import { getOrCreateProfile, setProfileName, profileKey } from "./db";

interface Conn {
  ws: WebSocket;
  clientId: string; // effective persistence key (account key when logged in, else guest id)
  guestClientId: string; // the browser's localStorage clientId — the guest anchor
  userId: string | null; // verified Better Auth user id (from the WS upgrade), or null
  name: string;
  characterId: string;
  accessories: string[]; // equipped cosmetics, carried like name/characterId
  roomCode?: string;
  playerId?: string;
  alive: boolean; // ws heartbeat
}

const EMPTY_GRACE_MS = 30000;

export class RoomManager {
  private rooms = new Map<string, GameRoom>();
  private conns = new Map<WebSocket, Conn>();
  private emptySince = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  onConnect(ws: WebSocket, userId: string | null = null): void {
    const guestClientId = makeId("c_");
    this.conns.set(ws, {
      ws,
      clientId: guestClientId,
      guestClientId,
      userId,
      name: "Blob",
      characterId: "avo",
      accessories: [],
      alive: true,
    });
  }

  onClose(ws: WebSocket): void {
    const conn = this.conns.get(ws);
    if (conn?.roomCode && conn.playerId) {
      const room = this.rooms.get(conn.roomCode);
      const player = room?.players.get(conn.playerId);
      if (room && player) {
        if (room.phase === "lobby") {
          room.removePlayer(player.id);
        } else {
          player.connected = false;
          player.send = undefined;
          room.markDirty();
        }
      }
    }
    this.conns.delete(ws);
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }

  onMessage(ws: WebSocket, raw: string): void {
    const conn = this.conns.get(ws);
    if (!conn) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.t) {
      case "hello": {
        conn.guestClientId = msg.clientId || conn.guestClientId;
        // A verified session wins: the account key is derived server-side, so a
        // client can never spoof its way into someone else's profile/marbles.
        conn.clientId = profileKey(conn.userId, conn.guestClientId);
        conn.name = (msg.name || "Blob").slice(0, 16);
        conn.characterId = msg.characterId || "avo";
        conn.accessories = sanitizeEquipped(msg.accessories);
        // Echo the GUEST id back so the client keeps its stable localStorage
        // anchor (needed for the one-time merge and for reverting on sign-out).
        this.send(ws, { t: "welcome", clientId: conn.guestClientId });
        getOrCreateProfile(conn.clientId, conn.name)
          .then((profile) => this.send(ws, { t: "profile", profile }))
          .catch(() => {});
        return;
      }
      case "ping":
        this.send(ws, { t: "pong", ts: msg.ts });
        return;
      case "createRoom":
        this.createRoom(conn, msg.config);
        return;
      case "joinRoom":
        this.joinRoom(conn, msg.code.toUpperCase().trim());
        return;
      case "leaveRoom":
        this.leaveRoom(conn);
        return;
    }

    // Identity updates apply at the connection level FIRST, so they stick even
    // when no room exists yet (e.g. tweaking name/character on the home page
    // before hosting or joining). makePlayer() reads conn.name/conn.characterId
    // when a room is later created or joined — if we only synced these while in a
    // room, home-page changes would be silently dropped and the lobby would show
    // the stale hello-time identity.
    // Identity updates apply at the connection level FIRST, so they stick even
    // when no room exists yet (e.g. tweaking name/character on the home page
    // before hosting or joining). makePlayer() reads conn.name/conn.characterId
    // when a room is later created or joined — if we only synced these while in a
    // room, home-page changes would be silently dropped and the lobby would show
    // the stale hello-time identity.
    if (msg.t === "setName") {
      conn.name = msg.name.slice(0, 16) || conn.name;
      setProfileName(conn.clientId, conn.name).catch(() => {});
    }
    if (msg.t === "setCharacter") conn.characterId = msg.characterId || conn.characterId;
    if (msg.t === "setAccessories") conn.accessories = sanitizeEquipped(msg.accessories);

    // room-scoped messages
    if (!conn.roomCode || !conn.playerId) return;
    const room = this.rooms.get(conn.roomCode);
    if (!room) return;
    const player = room.players.get(conn.playerId);
    if (!player) return;

    room.handle(player, msg);
  }

  private bindPlayer(conn: Conn, room: GameRoom, player: Player): void {
    conn.roomCode = room.code;
    conn.playerId = player.id;
    player.send = (m) => this.send(conn.ws, m);
    player.connected = true;
    this.send(conn.ws, { t: "youAre", playerId: player.id });
    this.send(conn.ws, { t: "roomState", room: room.buildMeta() });
  }

  private createRoom(conn: Conn, config?: Partial<ClientMessage & any>): void {
    this.leaveRoom(conn);
    let code = makeRoomCode();
    let guard = 0;
    while (this.rooms.has(code) && guard++ < 50) code = makeRoomCode();
    const seed = [...code].reduce((a, c) => a + c.charCodeAt(0), 0) * 7919 + (Date.now() & 0xffff);
    const room = new GameRoom(code, seed);
    if (config) room.config = { ...room.config, ...config };
    this.rooms.set(code, room);
    const player = this.makePlayer(conn);
    room.addPlayer(player);
    this.bindPlayer(conn, room, player);
    console.log(`[room] created ${code} by ${conn.name}`);
  }

  private joinRoom(conn: Conn, code: string): void {
    const room = this.rooms.get(code);
    if (!room) {
      this.send(conn.ws, { t: "error", message: `No room "${code}". It either never existed or everyone in it already perished.` });
      return;
    }
    // reconnect: same clientId already in this room
    const existing = [...room.players.values()].find(
      (p) => !p.isBot && p.clientId === conn.clientId,
    );
    if (existing) {
      this.leaveRoomExcept(conn, code);
      this.bindPlayer(conn, room, existing);
      room.markDirty();
      return;
    }
    if (room.phase !== "lobby") {
      this.send(conn.ws, { t: "error", message: "That match has already started. The doors are locked. House policy." });
      return;
    }
    if (room.players.size >= room.config.maxPlayers || room.players.size >= MAX_PLAYERS) {
      this.send(conn.ws, { t: "error", message: "Room is full. Maximum occupancy reached — fire marshals and Game Masters agree." });
      return;
    }
    this.leaveRoom(conn);
    const player = this.makePlayer(conn);
    room.addPlayer(player);
    this.bindPlayer(conn, room, player);
    room.systemChat(`${player.name} stumbled into the arena.`);
  }

  private leaveRoom(conn: Conn): void {
    if (!conn.roomCode) return;
    const room = this.rooms.get(conn.roomCode);
    if (room && conn.playerId) room.removePlayer(conn.playerId);
    conn.roomCode = undefined;
    conn.playerId = undefined;
  }

  private leaveRoomExcept(conn: Conn, keepCode: string): void {
    if (conn.roomCode && conn.roomCode !== keepCode) this.leaveRoom(conn);
  }

  private makePlayer(conn: Conn): Player {
    return new Player({
      id: makeId("p_"),
      clientId: conn.clientId,
      name: conn.name,
      characterId: conn.characterId,
      accessories: conn.accessories,
    });
  }

  private tick(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      try {
        room.update(now);
      } catch (e) {
        console.error(`[room ${code}] tick error`, e);
      }
      if (room.isEmpty) {
        const since = this.emptySince.get(code) ?? now;
        this.emptySince.set(code, since);
        if (now - since > EMPTY_GRACE_MS) {
          this.rooms.delete(code);
          this.emptySince.delete(code);
          console.log(`[room] reaped ${code}`);
        }
      } else {
        this.emptySince.delete(code);
      }
    }
  }

  get stats() {
    return { rooms: this.rooms.size, conns: this.conns.size };
  }
}

export const roomManager = new RoomManager();
