"use client";
import { create } from "zustand";
import type { ClientMessage, ServerMessage, GameInput } from "../shared/protocol";
import { WS_PATH } from "../shared/protocol";
import type {
  RoomMetaState,
  Snapshot,
  ChatLine,
  ProfileSummary,
} from "../shared/types";

// --- snapshot buffer lives OUTSIDE React so the 20Hz stream never re-renders UI.
// The canvas polls this each animation frame and interpolates prev->cur.
export const snapBuffer: {
  prev: Snapshot | null;
  cur: Snapshot | null;
  recvAt: number;
  prevAt: number;
} = { prev: null, cur: null, recvAt: 0, prevAt: 0 };

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "good" | "bad";
}

interface GameState {
  status: "idle" | "connecting" | "open" | "closed";
  clientId: string;
  name: string;
  characterId: string;
  accessories: string[]; // equipped cosmetic ids (≤ one per slot)
  profile: ProfileSummary | null;
  room: RoomMetaState | null;
  youId: string | null;
  chat: ChatLine[];
  toasts: Toast[];
  error: string | null;
  ping: number;
  set: (p: Partial<GameState>) => void;
}

export const useGame = create<GameState>((set) => ({
  status: "idle",
  clientId: "",
  name: "Blob",
  characterId: "avo",
  accessories: [],
  profile: null,
  room: null,
  youId: null,
  chat: [],
  toasts: [],
  error: null,
  ping: 0,
  set: (p) => set(p),
}));

const LS = {
  id: "eliminated:clientId",
  name: "eliminated:name",
  char: "eliminated:char",
  acc: "eliminated:acc",
};

function loadAccessories(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS.acc) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function loadLocal() {
  if (typeof window === "undefined") return;
  let clientId = localStorage.getItem(LS.id);
  if (!clientId) {
    clientId = "c_" + Math.random().toString(36).slice(2, 12);
    localStorage.setItem(LS.id, clientId);
  }
  const name = localStorage.getItem(LS.name) || "Blob" + Math.floor(Math.random() * 1000);
  const characterId = localStorage.getItem(LS.char) || "avo";
  const accessories = loadAccessories();
  useGame.setState({ clientId, name, characterId, accessories });
}

function wsUrl(): string {
  const env = process.env.NEXT_PUBLIC_WS_URL;
  if (env) return env;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${WS_PATH}`;
}

class Net {
  private ws: WebSocket | null = null;
  private reconnectT: ReturnType<typeof setTimeout> | null = null;
  private pingT: ReturnType<typeof setInterval> | null = null;
  private backoff = 500;
  private toastSeq = 1;
  private pendingMove: { dx: number; dy: number } | null = null;
  private moveSeq = 0;
  started = false;

  ensure() {
    if (this.started) return;
    this.started = true;
    loadLocal();
    this.connect();
  }

  private connect() {
    useGame.setState({ status: "connecting" });
    try {
      this.ws = new WebSocket(wsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.backoff = 500;
      useGame.setState({ status: "open", error: null });
      const { clientId, name, characterId, accessories } = useGame.getState();
      this.send({ t: "hello", clientId, name, characterId, accessories });
      this.startPing();
    };
    this.ws.onmessage = (ev) => this.onMessage(ev.data);
    this.ws.onclose = () => {
      useGame.setState({ status: "closed" });
      this.stopPing();
      this.scheduleReconnect();
    };
    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectT) return;
    this.reconnectT = setTimeout(() => {
      this.reconnectT = null;
      this.backoff = Math.min(this.backoff * 1.6, 6000);
      this.connect();
    }, this.backoff);
  }

  // Drop and immediately re-open the socket so the upgrade handshake re-reads the
  // (just changed) auth cookie — used right after sign-in and sign-out so the live
  // connection is re-keyed to the account (or back to guest).
  reauth() {
    if (this.reconnectT) {
      clearTimeout(this.reconnectT);
      this.reconnectT = null;
    }
    this.backoff = 500;
    if (this.ws) {
      try {
        this.ws.onclose = null; // don't let the old socket trigger its own reconnect
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.connect();
  }

  // One-time fold of this browser's guest progress into the signed-in account.
  // Idempotent server-side (the guest row is marked spent), so it's safe to call
  // again. Updates the local profile with the merged result.
  async linkGuest() {
    if (typeof window === "undefined") return;
    const clientId = localStorage.getItem(LS.id) || useGame.getState().clientId;
    if (!clientId) return;
    try {
      const res = await fetch("/api/link-guest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      if (res.ok) {
        const profile = await res.json();
        if (profile && !profile.error) useGame.setState({ profile });
      }
    } catch {
      /* ignore — guests keep their local progress regardless */
    }
  }

  // Call right after a successful sign-in: merge guest progress, then re-key the
  // live socket to the account.
  async afterLogin() {
    await this.linkGuest();
    this.reauth();
  }

  private startPing() {
    this.stopPing();
    this.pingT = setInterval(() => this.send({ t: "ping", ts: Date.now() }), 4000);
  }
  private stopPing() {
    if (this.pingT) clearInterval(this.pingT);
    this.pingT = null;
  }

  private onMessage(raw: string) {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.t) {
      case "welcome":
        useGame.setState({ clientId: msg.clientId });
        break;
      case "profile":
        useGame.setState({ profile: msg.profile });
        break;
      case "roomState":
        useGame.setState({ room: msg.room });
        break;
      case "youAre":
        useGame.setState({ youId: msg.playerId });
        break;
      case "snapshot": {
        snapBuffer.prev = snapBuffer.cur;
        snapBuffer.prevAt = snapBuffer.recvAt;
        snapBuffer.cur = msg.snap;
        snapBuffer.recvAt = performance.now();
        break;
      }
      case "chat": {
        const chat = [...useGame.getState().chat, msg.line].slice(-60);
        useGame.setState({ chat });
        break;
      }
      case "toast":
        this.pushToast(msg.text, msg.kind || "info");
        break;
      case "error":
        useGame.setState({ error: msg.message });
        this.pushToast(msg.message, "bad");
        break;
      case "pong":
        useGame.setState({ ping: Date.now() - msg.ts });
        break;
    }
  }

  pushToast(text: string, kind: "info" | "good" | "bad") {
    const id = this.toastSeq++;
    const toasts = [...useGame.getState().toasts, { id, text, kind }].slice(-4);
    useGame.setState({ toasts });
    setTimeout(() => {
      useGame.setState({ toasts: useGame.getState().toasts.filter((t) => t.id !== id) });
    }, 3200);
  }

  send(msg: ClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  // ---- convenience actions ----
  setIdentity(name: string, characterId: string) {
    useGame.setState({ name, characterId });
    localStorage.setItem(LS.name, name);
    localStorage.setItem(LS.char, characterId);
    this.send({ t: "setName", name });
    this.send({ t: "setCharacter", characterId });
  }
  createRoom() {
    this.send({ t: "createRoom" });
  }
  joinRoom(code: string) {
    this.send({ t: "joinRoom", code });
  }
  leaveRoom() {
    this.send({ t: "leaveRoom" });
    useGame.setState({ room: null, youId: null });
  }
  setCharacter(characterId: string) {
    useGame.setState({ characterId });
    localStorage.setItem(LS.char, characterId);
    this.send({ t: "setCharacter", characterId });
  }
  setAccessories(accessories: string[]) {
    useGame.setState({ accessories });
    localStorage.setItem(LS.acc, JSON.stringify(accessories));
    this.send({ t: "setAccessories", accessories });
  }
  // Sit the series out to watch & bet (lobby only).
  setSpectate(on: boolean) {
    this.send({ t: "setSpectate", on });
  }
  // Dead Pool: wager `stake` series-Marbles that `targetId` wins it all.
  placeBet(targetId: string, stake: number) {
    this.send({ t: "placeBet", targetId, stake });
  }
  cancelBet() {
    this.send({ t: "cancelBet" });
  }
  setName(name: string) {
    useGame.setState({ name });
    localStorage.setItem(LS.name, name);
    this.send({ t: "setName", name });
  }
  ready(r: boolean) {
    this.send({ t: "setReady", ready: r });
  }
  chat(text: string) {
    this.send({ t: "chat", text });
  }
  emote(kind: string) {
    this.send({ t: "emote", kind });
  }
  addBot() {
    this.send({ t: "addBot" });
  }
  removeBot(id: string) {
    this.send({ t: "removeBot", id });
  }
  kick(id: string) {
    this.send({ t: "kick", id });
  }
  updateConfig(config: any) {
    this.send({ t: "updateConfig", config });
  }
  start() {
    this.send({ t: "startSeries" });
  }
  returnToLobby() {
    this.send({ t: "returnToLobby" });
  }
  input(input: GameInput) {
    this.send({ t: "input", input });
  }
  // throttled move: only send when direction meaningfully changes
  move(dx: number, dy: number) {
    const last = this.pendingMove;
    if (last && Math.abs(last.dx - dx) < 0.06 && Math.abs(last.dy - dy) < 0.06) return;
    this.pendingMove = { dx, dy };
    this.send({ t: "input", input: { kind: "move", dx, dy, seq: ++this.moveSeq } });
  }
}

export const net = new Net();
