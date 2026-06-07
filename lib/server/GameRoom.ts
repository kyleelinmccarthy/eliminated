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
  MAX_PLAYERS,
  CURRENCY_ICON,
} from "../shared/constants";
import { makeRng, pick, botName, makeId, MAX_PLAYER_NUMBER, clamp, type Rng } from "../shared/util";
import { randomCharacterId } from "../shared/characters";
import { ACCESSORIES, sanitizeEquipped } from "../shared/accessories";
import { betMultiplier, betRejectionReason, clampStake, settleBet } from "../shared/betting";
import { createMinigame, minPlayersFor } from "./games/registry";
import type { Minigame, GameContext } from "./games/Minigame";
import { recordSeries, type SeriesReward } from "./db";

const INTRO_MS = 5400;
// After the reveal, the board is shown frozen for this long while a "3·2·1·GO"
// counts down on the field — gives everyone a beat to find their blob before
// anything can move or die. Game logic and input are held until it elapses.
const GO_MS = 3200;
const RESULT_MS = 6000;
const SERIES_RESULT_MS = 30000;
const BOT_FILL_TARGET = 6;
// How many of the most-recently-played games to remember across series (Play
// Again) and steer the next draw away from, so the room doesn't repeat itself.
const RECENT_GAMES_WINDOW = 3;
// Hardcore is "last blob standing": the series ends only when ONE survivor
// remains. The scheduled final round is a decisive finale that crowns a single
// champion, so this rarely matters — it's a safety net for the freak case where
// a finale still leaves two alive (we'd run extra sudden-death finales).
const FINALE_OVERTIME_CAP = 5;
// Math-based pacing (hardcore): we scale each round's cull strength so the field
// funnels down to roughly this many blobs entering the decisive finale — tense,
// but not an anticlimactic 1v1 reached three rounds early.
const FINALE_FIELD_TARGET = 3;
// Rough model of how a round's cull strength maps to its survival ratio:
// survivors ≈ players · (1 − CULL_COEFF · intensity). The target-based games
// (brawls / skill games) sit around 0.5; we invert it to solve for intensity.
const CULL_COEFF = 0.5;

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
  // Every game already played THIS series. We draw from the unplayed games first
  // so a short gauntlet shows real variety instead of randomly repeating a couple
  // while never touching others.
  private playedGames: GameId[] = [];
  // The last few games played in this ROOM, persisted ACROSS series (Play Again).
  // A fresh series resets playedGames/lastGame, so without this the next series
  // could open on the exact game that just closed the previous one, and short
  // back-to-back series recycle the same handful. We exclude this tail from the
  // draw so the room keeps feeling varied session-to-session, not just per-series.
  private recentGames: GameId[] = [];
  private game: Minigame | null = null;
  private participants: string[] = []; // player ids in current round

  private introPayload?: IntroPayload;
  private lastResult?: RoundResult;
  private seriesResult?: SeriesResult;

  private introEndsAt = 0;
  private playStartsAt = 0; // server epoch ms when the pre-round GO countdown ends
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
      case "setAccessories":
        // Cosmetic-only, changed in the lobby (like your blob). Sanitized so a
        // client can never wear two hats or smuggle in junk ids.
        if (this.phase === "lobby") {
          p.accessories = sanitizeEquipped(msg.accessories);
          this.markDirty();
        }
        break;
      case "placeBet":
        this.placeBet(p, msg.targetId, msg.stake);
        break;
      case "cancelBet":
        this.cancelBet(p);
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
        // Ignore input during the pre-round GO hold — no jumping the gun.
        if (this.phase === "playing" && this.game && Date.now() >= this.playStartsAt)
          this.game.onInput(p.id, msg.input);
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
    bot.accessories = this.randomBotDrip();
    this.players.set(bot.id, bot);
    this.markDirty();
    return bot;
  }

  // Give bots a little random drip (≤ one item per slot) so accessories are
  // visible even in bot-fill games. Deterministic via the room rng.
  private randomBotDrip(): string[] {
    const slots = [...new Set(ACCESSORIES.map((a) => a.slot))];
    const out: string[] = [];
    for (const slot of slots) {
      if (this.rng() < 0.35) out.push(pick(this.rng, ACCESSORIES.filter((a) => a.slot === slot)).id);
    }
    return out;
  }

  // ---- Dead Pool betting (hardcore spectators) ----
  // An eliminated blob wagers some of its series earnings on who'll be the last
  // one standing. Validated against the same rules the client uses to grey out
  // the button; the bet is stored and settled once, at endSeries.
  private placeBet(p: Player, targetId: string, stake: number): void {
    // Only meaningful mid-series, while a champion is still undecided.
    if (this.phase === "lobby" || this.phase === "seriesResult") return;
    const target = this.players.get(targetId);
    const aliveCount = this.alivePlayers().length;
    const reason = betRejectionReason({
      mode: this.config.mode,
      bettorAlive: p.alive,
      isSelf: targetId === p.id,
      targetAlive: !!target?.alive,
      aliveCount,
      available: p.marblesEarned,
      stake,
    });
    if (reason) {
      p.send?.({ t: "toast", text: reason, kind: "bad" });
      return;
    }
    const finalStake = clampStake(stake, p.marblesEarned);
    p.bet = { targetId, stake: finalStake, oddsAlive: aliveCount };
    const mult = betMultiplier(aliveCount);
    p.send?.({
      t: "toast",
      text: `🎲 Bet locked: ${finalStake} ${CURRENCY_ICON} on ${target!.name} at ${mult}× — pays ${finalStake * mult} ${CURRENCY_ICON} if they win it all.`,
      kind: "good",
    });
    this.markDirty();
  }

  private cancelBet(p: Player): void {
    if (!p.bet) return;
    p.bet = undefined;
    p.send?.({ t: "toast", text: "Bet pulled. Cold feet are a survival instinct you discovered too late.", kind: "info" });
    this.markDirty();
  }

  // Pay out / collect every wager once the champion is known (hardcore only).
  private settleBets(championId: string | null): void {
    const winners: string[] = [];
    for (const p of this.players.values()) {
      if (!p.bet) continue;
      const delta = settleBet(p.bet, championId);
      const won = delta > 0;
      const tgt = this.players.get(p.bet.targetId);
      p.marblesEarned = Math.max(0, p.marblesEarned + delta);
      if (won && !p.isBot) winners.push(`${p.name} (+${delta} ${CURRENCY_ICON})`);
      if (!p.isBot) {
        p.send?.({
          t: "toast",
          text: won
            ? `🤑 DEAD POOL: your ${p.bet.stake} ${CURRENCY_ICON} on ${tgt?.name ?? "your pick"} cashed in — +${delta} ${CURRENCY_ICON}!`
            : `💸 DEAD POOL: ${tgt?.name ?? "your pick"} let you down. There goes ${p.bet.stake} ${CURRENCY_ICON}.`,
          kind: won ? "good" : "bad",
        });
      }
      p.bet = undefined;
    }
    if (winners.length) {
      this.systemChat(`🦅 The vultures feast: ${winners.join(", ")} called it from the afterlife.`);
    }
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
      p.bet = undefined;
    }
    this.roundIndex = 0;
    // Intentionally NOT clearing lastGame / recentGames here: they carry across
    // series so a new series (Play Again) doesn't open on the game that just
    // closed the previous one. Only the per-series freshness list resets.
    this.lastMapId = null;
    this.playedGames = [];

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

  // The round being set up is the last scheduled one — or beyond it, if we've
  // gone into sudden-death overtime because a finale left more than one blob
  // alive (hardcore only; casual always stops exactly at totalRounds). Forces a
  // decisive finale game.
  private isFinalRound(): boolean {
    return this.totalRounds > 0 && this.roundIndex >= this.totalRounds - 1;
  }

  // 0..1 cull strength for the round being set up.
  //  - The finale runs brisk (it collapses to one regardless).
  //  - Casual keeps a simple gentle→harsh ramp (no persistent elimination to
  //    funnel, since everyone replays every round).
  //  - Hardcore solves for the cull rate that lands the field on
  //    FINALE_FIELD_TARGET by the time the finale starts, recomputed each round
  //    from the LIVE alive count so it self-corrects when a round over/under-culls.
  private computeIntensity(aliveNow: number): number {
    if (this.isFinalRound()) return 0.9;
    if (this.config.mode !== "hardcore") {
      if (this.totalRounds <= 1) return 0.7;
      return clamp(0.18 + 0.7 * (this.roundIndex / (this.totalRounds - 1)), 0.12, 0.85);
    }
    if (aliveNow <= FINALE_FIELD_TARGET) return 0.22; // already thin — keep it light
    // culling rounds left before the finale (this round included)
    const roundsToCull = Math.max(1, this.totalRounds - 1 - this.roundIndex);
    const perRoundRatio = Math.pow(FINALE_FIELD_TARGET / aliveNow, 1 / roundsToCull);
    return clamp((1 - perRoundRatio) / CULL_COEFF, 0.12, 0.9);
  }

  private chooseGame(aliveCount: number): GameId {
    const allowList = this.config.allowedGames.length ? this.config.allowedGames : ALL_GAME_IDS;
    // A game is playable only if it has enough blobs AND — for team / 1v1 games
    // flagged requiresEven (Freeze Tag, RPS Minus One) — the field is even, so
    // teams/pairings come out balanced (no lopsided 2v1 or free byes).
    const playable = (g: GameId) =>
      minPlayersFor(g) <= aliveCount && (!GAMES[g].requiresEven || aliveCount % 2 === 0);

    // The final round is always a decisive finale — a game that can crown a
    // single survivor (king of the hill, or any finale-CAPABLE game like the
    // brawls / skill games, told to leave exactly one). We prefer the host's
    // allowed finale games; if they disabled them all, we fall back to ANY
    // finale-capable game so hardcore still guarantees a lone champion.
    if (this.isFinalRound()) {
      const canFinale = (g: GameId) => (GAMES[g].finale || GAMES[g].finaleCapable) && playable(g);
      let finales = allowList.filter(canFinale);
      if (!finales.length) finales = ALL_GAME_IDS.filter(canFinale);
      // Prefer a finale we haven't shown recently (across series), then at least
      // not the immediately-previous game, then anything finale-capable.
      const unseen = finales.filter((g) => !this.recentGames.includes(g));
      const notLast = finales.filter((g) => g !== this.lastGame);
      const pool = unseen.length ? unseen : notLast.length ? notLast : finales;
      if (pool.length) return pick(this.rng, pool);
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

    // Variety first, with constraints relaxed in order so the pool can never end
    // up empty:
    //   1. not played this series AND not in the room's recent tail (best variety)
    //   2. not played this series (cross-series tail exhausted the options)
    //   3. anything playable
    const freshAndUnseen = pool.filter(
      (g) => !this.playedGames.includes(g) && !this.recentGames.includes(g),
    );
    const fresh = pool.filter((g) => !this.playedGames.includes(g));
    let finalPool = freshAndUnseen.length ? freshAndUnseen : fresh.length ? fresh : pool;
    // Hard guard against repeats: never serve the immediately-previous game
    // back-to-back unless it is genuinely the only thing playable.
    const noRepeat = finalPool.filter((g) => g !== this.lastGame);
    if (noRepeat.length) finalPool = noRepeat;
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
    if (!this.playedGames.includes(game)) this.playedGames.push(game);
    // Track the room's recent tail (across series), newest last, capped to the
    // window. Dedupe so a game can't pad out the tail and crowd out others.
    this.recentGames = [...this.recentGames.filter((g) => g !== game), game].slice(
      -RECENT_GAMES_WINDOW,
    );
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
      intensity: this.computeIntensity(participants.length),
      night: this.currentNight,
      // The hardcore finale must crown exactly one champion (Squid Game rule).
      forceSingleSurvivor: this.config.mode === "hardcore" && this.isFinalRound(),
    };
    this.game = createMinigame(this.currentGame!, ctx);
    this.game.start();
    this.phase = "playing";
    // Hold the round on a "3·2·1·GO" beat: the board renders in its starting
    // pose but logic & input stay frozen until playStartsAt (see update/handle).
    this.playStartsAt = Date.now() + GO_MS;
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

    // Dead Pool: warn any spectator whose horse just died, so they can re-bet
    // before the finale instead of silently eating the loss. Fires once — the
    // round their pick is eliminated.
    if (this.config.mode === "hardcore" && this.alivePlayers().length >= 2) {
      for (const p of this.players.values()) {
        if (!p.bet || p.isBot || !p.connected) continue;
        if (!survivors.has(p.bet.targetId)) {
          const tgt = this.players.get(p.bet.targetId);
          p.send?.({
            t: "toast",
            text: `💸 Your pick ${tgt?.name ?? ""} is OUT — re-bet before the finale or kiss ${p.bet.stake} ${CURRENCY_ICON} goodbye.`,
            kind: "bad",
          });
        }
      }
    }

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
      // Squid Game rule: nobody splits the prize. The series ends only when a
      // single survivor remains. The scheduled final round is always a decisive
      // finale (see chooseGame) that crowns exactly one champion, so this
      // normally lands right on schedule; the overtime cap is a safety net for
      // the freak case where a finale still leaves two blobs standing.
      if (aliveCount <= 1) seriesOver = true;
      else if (this.roundIndex >= this.totalRounds + FINALE_OVERTIME_CAP) seriesOver = true;
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

    // Settle the Dead Pool FIRST, so bet winnings/losses fold into marblesEarned
    // before the placement bonuses, the standings, and the DB persist all read it.
    if (this.config.mode === "hardcore") {
      const championId = all[0] && all[0].alive ? all[0].id : null;
      this.settleBets(championId);
    }

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
      p.bet = undefined;
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
          const live = now >= this.playStartsAt;
          if (live) this.game.tick(TICK_MS / 1000, now);
          const snap = this.game.snapshot(now);
          // While frozen, advertise when play begins so clients can run the
          // on-field 3·2·1·GO countdown over the (still) starting positions.
          if (!live) snap.startAt = this.playStartsAt;
          this.broadcast({ t: "snapshot", snap });
          if (live && this.game.isDone()) this.endRound();
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
  if (typeof c.maxPlayers === "number") out.maxPlayers = Math.max(2, Math.min(MAX_PLAYERS, c.maxPlayers));
  return out;
}
