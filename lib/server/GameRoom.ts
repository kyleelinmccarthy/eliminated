import { Player } from "./Player";
import type { ClientMessage, ServerMessage } from "../shared/protocol";
import type {
  RoomConfig,
  RoomMetaState,
  RoomPhase,
  GameId,
  RoundResult,
  RoundResultEntry,
  SeriesResult,
  SeriesStanding,
  IntroPayload,
} from "../shared/types";
import { ALL_GAME_IDS, GAMES, gameMeta } from "../shared/games";
import { MAPS } from "../shared/maps";
import {
  DEFAULT_CONFIG,
  MARBLES,
  TICK_MS,
  placementTitle,
  MIN_TO_START,
  CURRENCY_ICON,
} from "../shared/constants";
import { makeRng, pick, botName, makeId, MAX_PLAYER_NUMBER, clamp, type Rng } from "../shared/util";
import { randomCharacterId } from "../shared/characters";
import { createMinigame, minPlayersFor } from "./games/registry";
import type { Minigame, GameContext } from "./games/Minigame";
import { recordSeries, type SeriesReward } from "./db";

const INTRO_MS = 5400;
const RESULT_MS = 6000;
const SERIES_RESULT_MS = 30000;
const BOT_FILL_TARGET = 6;

export class GameRoom {
  code: string;
  players = new Map<string, Player>();
  config: RoomConfig = { ...DEFAULT_CONFIG, allowedGames: [] };
  phase: RoomPhase = "lobby";
  hostId = "";

  // series state
  rng: Rng = makeRng(1);
  roundIndex = 0; // completed rounds
  totalRounds = 0;
  totalRoundsKnown = false;
  currentGame: GameId | null = null;
  currentMapId: string | null = null;
  currentNight = false; // is the current round a dark (night-mode) round
  lastGame: GameId | null = null;
  lastMapId: string | null = null;
  private game: Minigame | null = null;
  private participants: string[] = []; // player ids in current round

  private introPayload?: IntroPayload;
  private lastResult?: RoundResult;
  private seriesResult?: SeriesResult;

  private introEndsAt = 0;
  private resultEndsAt = 0;
  private seriesEndsAt = 0;
  private dirty = true;

  constructor(code: string, seed: number) {
    this.code = code;
    this.rng = makeRng(seed);
  }

  // ---- membership ----
  addPlayer(p: Player): void {
    if (this.players.size === 0) {
      p.isHost = true;
      this.hostId = p.id;
    }
    if (!p.number) p.number = this.assignNumber();
    this.players.set(p.id, p);
    this.markDirty();
  }

  // Pick a unique Squid Game-style number (1..456) not in use in this room.
  private assignNumber(): number {
    const used = new Set([...this.players.values()].map((p) => p.number));
    for (let guard = 0; guard < 4000; guard++) {
      const n = 1 + Math.floor(Math.random() * MAX_PLAYER_NUMBER);
      if (!used.has(n)) return n;
    }
    // fallback: smallest free number (handles the unlikely saturated case)
    for (let n = 1; n <= MAX_PLAYER_NUMBER + used.size + 1; n++) {
      if (!used.has(n)) return n;
    }
    return used.size + 1;
  }

  removePlayer(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    // Leaving (or being kicked) mid-game = you die where you stand. Kill the
    // actor in the live minigame first, so a quitter can't win by idling and the
    // survivors get to watch the box drop.
    if (this.phase === "playing" && this.game) this.game.forfeit(id);
    this.players.delete(id);
    if (this.hostId === id) {
      // promote next human, else anyone
      const next =
        [...this.players.values()].find((x) => !x.isBot) ??
        [...this.players.values()][0];
      if (next) {
        next.isHost = true;
        this.hostId = next.id;
      }
    }
    this.markDirty();
  }

  get humanCount(): number {
    return [...this.players.values()].filter((p) => !p.isBot && p.connected).length;
  }

  get isEmpty(): boolean {
    return this.humanCount === 0;
  }

  markDirty(): void {
    this.dirty = true;
  }

  broadcast(msg: ServerMessage): void {
    for (const p of this.players.values()) p.send?.(msg);
  }

  systemChat(text: string): void {
    this.broadcast({
      t: "chat",
      line: { from: "GM", name: "Game Master", text, at: Date.now(), system: true },
    });
  }

  // ---- meta state ----
  buildMeta(): RoomMetaState {
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      config: this.config,
      players: [...this.players.values()].map((p) => p.toPublic()),
      roundIndex: this.roundIndex,
      roundsRevealed: this.roundIndex + (this.phase === "intro" || this.phase === "playing" ? 1 : 0),
      totalRoundsKnown: this.totalRoundsKnown,
      totalRounds: this.totalRounds,
      currentGame: this.currentGame,
      currentMapId: this.currentMapId,
      intro: this.phase === "intro" ? this.introPayload : undefined,
      lastResult: this.phase === "roundResult" ? this.lastResult : undefined,
      seriesResult: this.phase === "seriesResult" ? this.seriesResult : undefined,
    };
  }

  pushMeta(): void {
    this.broadcast({ t: "roomState", room: this.buildMeta() });
    this.dirty = false;
  }

  // ---- client messages ----
  handle(p: Player, msg: ClientMessage): void {
    switch (msg.t) {
      case "setName":
        p.name = msg.name.slice(0, 16) || p.name;
        this.markDirty();
        break;
      case "setCharacter":
        if (this.phase === "lobby") {
          p.characterId = msg.characterId;
          this.markDirty();
        }
        break;
      case "setReady":
        p.ready = msg.ready;
        this.markDirty();
        break;
      case "chat": {
        const text = msg.text.slice(0, 140).trim();
        if (text)
          this.broadcast({ t: "chat", line: { from: p.id, name: p.name, text, at: Date.now() } });
        break;
      }
      case "emote":
        p.emote = { kind: msg.kind, at: Date.now() };
        this.markDirty();
        break;
      case "addBot":
        if (p.id === this.hostId && this.phase === "lobby") this.addBot();
        break;
      case "removeBot":
        if (p.id === this.hostId) {
          const b = this.players.get(msg.id);
          if (b?.isBot) this.removePlayer(msg.id);
        }
        break;
      case "kick":
        if (p.id === this.hostId && msg.id !== this.hostId) {
          const target = this.players.get(msg.id);
          target?.send?.({ t: "error", message: "The host has voted you off the island. No marbles for you." });
          this.removePlayer(msg.id);
        }
        break;
      case "updateConfig":
        if (p.id === this.hostId && this.phase === "lobby") {
          this.config = { ...this.config, ...sanitizeConfig(msg.config) };
          this.markDirty();
        }
        break;
      case "startSeries":
        if (p.id === this.hostId && this.phase === "lobby") this.startSeries();
        break;
      case "returnToLobby":
        if (p.id === this.hostId && this.phase === "seriesResult") this.toLobby();
        break;
      case "input":
        if (this.phase === "playing" && this.game) this.game.onInput(p.id, msg.input);
        break;
    }
  }

  addBot(): Player {
    const bot = new Player({
      id: makeId("bot_"),
      clientId: makeId("botc_"),
      name: botName(),
      characterId: randomCharacterId(),
      isBot: true,
    });
    bot.ready = true;
    bot.number = this.assignNumber();
    this.players.set(bot.id, bot);
    this.markDirty();
    return bot;
  }

  // ---- series flow ----
  private startSeries(): void {
    // bot fill
    if (this.config.botFill) {
      while (this.players.size < BOT_FILL_TARGET && this.players.size < this.config.maxPlayers) {
        this.addBot();
      }
    }
    const total = this.players.size;
    if (total < MIN_TO_START) {
      this.broadcast({ t: "toast", text: "A massacre needs at least 2 victims (enable bot fill!)", kind: "bad" });
      return;
    }

    // reset series state
    for (const p of this.players.values()) {
      p.alive = true;
      p.marblesEarned = 0;
      p.points = 0;
      p.roundsSurvived = 0;
      p.title = undefined;
    }
    this.roundIndex = 0;
    this.lastGame = null;
    this.lastMapId = null;

    if (this.config.rounds === "mystery") {
      this.totalRounds = 3 + Math.floor(this.rng() * 4); // 3..6, hidden
      this.totalRoundsKnown = false;
    } else {
      this.totalRounds = Math.max(1, Math.min(12, this.config.rounds as number));
      this.totalRoundsKnown = true;
    }

    this.systemChat(
      this.totalRoundsKnown
        ? `The trials begin. ${this.totalRounds} games stand between you and the prize. ${CURRENCY_ICON} to whoever's left.`
        : `The trials begin. How many games? Wouldn't you love to know. ${CURRENCY_ICON} to whoever's left.`,
    );
    this.beginIntro();
  }

  private alivePlayers(): Player[] {
    return [...this.players.values()].filter((p) => p.alive);
  }

  private getParticipants(): Player[] {
    if (this.config.mode === "hardcore") return this.alivePlayers();
    return [...this.players.values()]; // casual: everyone plays every round
  }

  // The round being set up is the last scheduled one (forces the finale game).
  private isFinalRound(): boolean {
    return this.totalRounds > 0 && this.roundIndex === this.totalRounds - 1;
  }

  // 0..1 cull strength: gentle opener, harsher as the series nears its end.
  private computeIntensity(): number {
    if (this.totalRounds <= 1) return 0.7;
    return clamp(0.18 + 0.7 * (this.roundIndex / (this.totalRounds - 1)), 0.12, 0.85);
  }

  private chooseGame(aliveCount: number): GameId {
    const allowList = this.config.allowedGames.length ? this.config.allowedGames : ALL_GAME_IDS;
    const isAllowed = (g: GameId) => allowList.includes(g);
    const playable = (g: GameId) => minPlayersFor(g) <= aliveCount;

    // Finale games (king of the hill) are never random — they're saved for the
    // final scheduled round, then only if allowed and big enough to run.
    if (this.isFinalRound()) {
      const finales = ALL_GAME_IDS.filter((g) => GAMES[g].finale && isAllowed(g) && playable(g));
      if (finales.length) return pick(this.rng, finales);
    }

    // Normal pool excludes finale-only games.
    let pool = allowList.filter((g) => !GAMES[g].finale && playable(g));
    if (pool.length === 0) pool = ALL_GAME_IDS.filter((g) => !GAMES[g].finale && playable(g));
    if (pool.length === 0) pool = ["redlight"];

    // Opener bias: don't open a series with a brutal (high-cull) game.
    if (this.roundIndex === 0) {
      const gentle = pool.filter((g) => GAMES[g].cull !== "high");
      if (gentle.length) pool = gentle;
    }

    const noRepeat = pool.filter((g) => g !== this.lastGame);
    const finalPool = noRepeat.length ? noRepeat : pool;
    return pick(this.rng, finalPool);
  }

  private chooseMap(): string {
    const pool = MAPS.filter((m) => m.id !== this.lastMapId);
    return pick(this.rng, pool.length ? pool : MAPS).id;
  }

  private beginIntro(): void {
    const participants = this.getParticipants();
    // reset per-round alive for casual respawn / display
    if (this.config.mode === "casual") {
      for (const p of this.players.values()) p.alive = true;
    }
    const game = this.chooseGame(participants.length);
    const mapId = this.chooseMap();
    this.currentGame = game;
    this.currentMapId = mapId;
    const meta = gameMeta(game);
    // Night mode: a hardcore modifier that darkens random rounds. Only games
    // where local vision is fair & fun qualify (not e.g. Red Light, which needs
    // a clear view of the Doll).
    const nightable = (["tag", "dodgeball", "boomerang", "koth"] as GameId[]).includes(game);
    this.currentNight =
      this.config.nightMode && this.config.mode === "hardcore" && nightable
        ? this.rng() < 0.5
        : false;
    // Tease the finale only when it won't spoil a mystery count.
    const isFinale = this.isFinalRound() && (this.totalRoundsKnown || !!meta.finale);
    this.introPayload = {
      game,
      mapId,
      roundNumber: this.roundIndex + 1,
      countdownMs: INTRO_MS,
      startsAt: Date.now() + INTRO_MS,
      flavor: pick(this.rng, meta.flavors),
      isFinale,
      night: this.currentNight,
    };
    this.phase = "intro";
    this.introEndsAt = Date.now() + INTRO_MS;
    this.systemChat(
      `Game ${this.roundIndex + 1}: ${meta.icon} ${meta.name}.${this.currentNight ? " 🌙 The lights go out…" : ""}`,
    );
    this.pushMeta();
  }

  private beginPlaying(): void {
    const participants = this.getParticipants();
    this.participants = participants.map((p) => p.id);
    const map = MAPS.find((m) => m.id === this.currentMapId) ?? MAPS[0];
    const ctx: GameContext = {
      players: participants.map((p) => ({
        id: p.id,
        name: p.name,
        characterId: p.characterId,
        isBot: p.isBot || !p.connected, // disconnected humans act as idle (no AI)
      })),
      map,
      rng: this.rng,
      friendlyFire: this.config.friendlyFire,
      emitFx: () => {},
      toast: (text, kind) => this.broadcast({ t: "toast", text, kind }),
      roundIndex: this.roundIndex,
      totalRounds: this.totalRounds,
      isFinale: this.isFinalRound(),
      intensity: this.computeIntensity(),
      night: this.currentNight,
    };
    this.game = createMinigame(this.currentGame!, ctx);
    this.game.start();
    this.phase = "playing";
    this.pushMeta();
  }

  private endRound(): void {
    if (!this.game) return;
    const result = this.game.result();
    const survivors = new Set(result.survivorIds);
    const rankByPlayer = new Map(result.ranking.map((r) => [r.playerId, r]));
    const bestPlacement = Math.min(...result.ranking.map((r) => r.placement), 1);

    const entries: RoundResultEntry[] = [];
    for (const pid of this.participants) {
      const p = this.players.get(pid);
      if (!p) continue;
      const rk = rankByPlayer.get(pid);
      const placement = rk?.placement ?? 999;
      const survived = survivors.has(pid);
      let marbles = 0;
      if (survived) {
        marbles += MARBLES.survivePerRound;
        if (placement === bestPlacement) marbles += MARBLES.roundWinBonus;
        p.roundsSurvived += 1;
        p.points += (this.participants.length - placement + 1) * 10 + 50;
      } else {
        marbles += MARBLES.elimParticipation;
        p.points += Math.max(0, this.participants.length - placement) * 4;
        if (this.config.mode === "hardcore") p.alive = false;
      }
      p.marblesEarned += marbles;
      entries.push({
        playerId: pid,
        survived,
        placement,
        marbles,
        note: rk?.note,
      });
    }
    entries.sort((a, b) => a.placement - b.placement);
    this.lastResult = {
      game: this.currentGame!,
      roundNumber: this.roundIndex + 1,
      entries,
      survivorIds: [...survivors],
    };
    this.lastGame = this.currentGame;
    this.lastMapId = this.currentMapId;
    this.game = null;
    this.phase = "roundResult";
    this.resultEndsAt = Date.now() + RESULT_MS;
    this.pushMeta();
  }

  private advanceAfterResult(): void {
    this.roundIndex += 1;
    const aliveCount = this.alivePlayers().length;
    let seriesOver = false;
    if (this.config.mode === "hardcore") {
      if (aliveCount <= 1) seriesOver = true;
      else if (this.roundIndex >= this.totalRounds) seriesOver = true;
    } else {
      if (this.roundIndex >= this.totalRounds) seriesOver = true;
    }
    if (seriesOver) this.endSeries();
    else this.beginIntro();
  }

  private endSeries(): void {
    const all = [...this.players.values()];
    // ranking: alive first (hardcore), then rounds survived, points, marbles
    all.sort((a, b) => {
      if (this.config.mode === "hardcore" && a.alive !== b.alive) return a.alive ? -1 : 1;
      if (a.roundsSurvived !== b.roundsSurvived) return b.roundsSurvived - a.roundsSurvived;
      if (a.points !== b.points) return b.points - a.points;
      return b.marblesEarned - a.marblesEarned;
    });

    const standings: SeriesStanding[] = [];
    all.forEach((p, i) => {
      const placement = i + 1;
      // placement bonus + champion bonus
      const curveBonus = MARBLES.placementCurve[Math.min(placement - 1, MARBLES.placementCurve.length - 1)] ?? 0;
      let bonus = curveBonus;
      const isChampion = placement === 1 && (this.config.mode !== "hardcore" || p.alive);
      if (isChampion) bonus += MARBLES.championBonus;
      p.marblesEarned += bonus;
      const title = placementTitle(placement);
      p.title = title;
      standings.push({
        playerId: p.id,
        name: p.name,
        number: p.number,
        characterId: p.characterId,
        placement,
        marbles: p.marblesEarned,
        roundsSurvived: p.roundsSurvived,
        isBot: p.isBot,
        title,
      });
    });

    const champion = standings[0];
    this.seriesResult = {
      standings,
      championId: champion ? champion.playerId : null,
    };
    this.phase = "seriesResult";
    this.seriesEndsAt = Date.now() + SERIES_RESULT_MS;

    if (champion) {
      this.systemChat(
        `👑 ${champion.name} is the LAST BLOB STANDING — ${champion.marbles} ${CURRENCY_ICON} richer and surrounded by former friends. Worth it!`,
      );
    }

    // persist humans
    const rewards: SeriesReward[] = all
      .filter((p) => !p.isBot)
      .map((p, i) => {
        const placement = standings.find((s) => s.playerId === p.id)!.placement;
        return {
          clientId: p.clientId,
          name: p.name,
          marbles: p.marblesEarned,
          won: placement === 1,
          roundsSurvived: p.roundsSurvived,
          title: p.title ?? "Blob",
        };
      });
    recordSeries(rewards).catch((e) => console.warn("[db] recordSeries failed", e));

    this.pushMeta();
  }

  private toLobby(): void {
    this.phase = "lobby";
    this.currentGame = null;
    this.currentMapId = null;
    this.game = null;
    this.introPayload = undefined;
    this.lastResult = undefined;
    this.seriesResult = undefined;
    for (const p of this.players.values()) {
      p.alive = true;
      p.ready = p.isBot;
      p.marblesEarned = 0;
      p.points = 0;
      p.roundsSurvived = 0;
      p.title = undefined;
    }
    this.pushMeta();
  }

  // ---- tick ----
  update(now: number): void {
    switch (this.phase) {
      case "lobby":
        if (this.dirty) this.pushMeta();
        break;
      case "intro":
        if (now >= this.introEndsAt) this.beginPlaying();
        else if (this.dirty) this.pushMeta();
        break;
      case "playing":
        if (this.game) {
          this.game.tick(TICK_MS / 1000, now);
          this.broadcast({ t: "snapshot", snap: this.game.snapshot(now) });
          if (this.game.isDone()) this.endRound();
        }
        break;
      case "roundResult":
        if (now >= this.resultEndsAt) this.advanceAfterResult();
        else if (this.dirty) this.pushMeta();
        break;
      case "seriesResult":
        if (now >= this.seriesEndsAt) this.toLobby();
        else if (this.dirty) this.pushMeta();
        break;
    }
  }
}

function sanitizeConfig(c: Partial<RoomConfig>): Partial<RoomConfig> {
  const out: Partial<RoomConfig> = {};
  if (c.mode === "hardcore" || c.mode === "casual") out.mode = c.mode;
  if (c.rounds === "mystery") out.rounds = "mystery";
  else if (typeof c.rounds === "number") out.rounds = Math.max(1, Math.min(12, Math.floor(c.rounds)));
  if (Array.isArray(c.allowedGames)) out.allowedGames = c.allowedGames.filter((g) => g in GAMES) as GameId[];
  if (typeof c.botFill === "boolean") out.botFill = c.botFill;
  if (typeof c.friendlyFire === "boolean") out.friendlyFire = c.friendlyFire;
  if (typeof c.nightMode === "boolean") out.nightMode = c.nightMode;
  if (typeof c.maxPlayers === "number") out.maxPlayers = Math.max(2, Math.min(16, c.maxPlayers));
  return out;
}
