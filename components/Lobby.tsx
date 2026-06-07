"use client";
import { useEffect, useRef, useState } from "react";
import { useGame, net } from "@/lib/client/net";
import { audio } from "@/lib/client/audio";
import { GAMES, ALL_GAME_IDS } from "@/lib/shared/games";
import type { GameId, SeriesMode } from "@/lib/shared/types";
import { CURRENCY, CURRENCY_ICON, MIN_TO_START } from "@/lib/shared/constants";
import { formatPlayerNumber } from "@/lib/shared/util";
import { characterVariants, CHARACTERS } from "@/lib/shared/characters";
import { BlobAvatar } from "./BlobAvatar";
import { CharacterPicker } from "./CharacterPicker";
import { AccessoryPicker } from "./AccessoryPicker";
import { GameIcon } from "./GameIcon";
import { ChatDock } from "./ChatDock";
import { MuteButton } from "./MuteButton";

const EMOTES = ["👋", "😂", "😎", "😱", "💀", "❤️", "🔥", "🤡"];

// Emotes broadcast to everyone through room meta, but the server only stashes
// the latest {kind, at} per player — nothing ever rendered it, so the buttons
// felt dead. This watches each player's emote timestamp and floats the emoji
// over their card for a beat. The TTL runs on a local timer, so the server's
// clock (and any skew) never matters; we just react to `at` changing.
function useEmoteBubbles(players: { id: string; emote?: { kind: string; at: number } }[]) {
  const [bubbles, setBubbles] = useState<Map<string, { kind: string; key: number }>>(new Map());
  const lastAt = useRef<Map<string, number>>(new Map());
  const seeded = useRef(false);
  const seq = useRef(0);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    // Seed on first sight so a pre-existing emote doesn't pop the instant you
    // open the lobby — only changes from here on float a bubble.
    if (!seeded.current) {
      for (const p of players) if (p.emote) lastAt.current.set(p.id, p.emote.at);
      seeded.current = true;
      return;
    }
    for (const p of players) {
      const at = p.emote?.at;
      if (!at || at === lastAt.current.get(p.id)) continue;
      lastAt.current.set(p.id, at);
      const key = ++seq.current;
      const kind = p.emote!.kind;
      setBubbles((m) => new Map(m).set(p.id, { kind, key }));
      const t = setTimeout(() => {
        timers.current.delete(t);
        setBubbles((m) => {
          if (m.get(p.id)?.key !== key) return m; // a newer emote already replaced it
          const n = new Map(m);
          n.delete(p.id);
          return n;
        });
      }, 2400);
      timers.current.add(t);
    }
  }, [players]);

  useEffect(() => () => { for (const t of timers.current) clearTimeout(t); }, []);
  return bubbles;
}

export function Lobby() {
  const room = useGame((s) => s.room)!;
  const youId = useGame((s) => s.youId);
  const characterId = useGame((s) => s.characterId);
  const [copied, setCopied] = useState(false);
  const [charOpen, setCharOpen] = useState(false);

  const isHost = youId === room.hostId;
  const me = room.players.find((p) => p.id === youId);
  const emoteBubbles = useEmoteBubbles(room.players);
  const humans = room.players.filter((p) => !p.isBot);
  const canStart = room.players.length >= MIN_TO_START || room.config.botFill;
  // accent rims so two players on the same blob aren't a confusing pair
  const variants = characterVariants(room.players);
  const currentChar = CHARACTERS.find((c) => c.id === characterId);

  function patch(p: any) {
    audio.sfx("click");
    net.updateConfig(p);
  }
  function copyCode() {
    navigator.clipboard?.writeText(room.code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  const allowed = new Set(room.config.allowedGames);
  function toggleGame(id: GameId) {
    if (!isHost) return;
    const next = new Set(allowed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // empty == all
    patch({ allowedGames: next.size === ALL_GAME_IDS.length ? [] : Array.from(next) });
  }
  const gameIsOn = (id: GameId) => allowed.size === 0 || allowed.has(id);

  return (
    <div className="page lobby">
      <div className="topbar container">
        <button className="btn ghost sm" onClick={() => net.leaveRoom()}>
          ← Leave
        </button>
        <div className="spacer" />
        <div className="codebox" onClick={copyCode} title="Click to copy">
          <span className="tag">Room Code</span>
          <span className="code">{room.code}</span>
          <span className="tiny dim">{copied ? "copied!" : "📋 share"}</span>
        </div>
        <div className="spacer" />
        <MuteButton />
      </div>

      <div className="container lobby-grid">
        {/* players */}
        <div className="panel players-panel">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3>
              Contestants <span className="dim">({room.players.length} — for now)</span>
            </h3>
            {isHost && (
              <button className="btn sm teal" onClick={() => (audio.sfx("blip"), net.addBot())}>
                + Add Bot
              </button>
            )}
          </div>
          <div className="players">
            {room.players.map((p) => (
              <div key={p.id} className={`pcard ${p.id === youId ? "me" : ""} ${!p.connected ? "off" : ""}`}>
                {emoteBubbles.has(p.id) && (
                  <div className="emote-bubble" key={emoteBubbles.get(p.id)!.key}>
                    {emoteBubbles.get(p.id)!.kind}
                  </div>
                )}
                <span className="pnum" title="Player number">{formatPlayerNumber(p.number)}</span>
                <div className="pcard-av">
                  <BlobAvatar characterId={p.characterId} size={64} animate={p.ready} anim={p.ready ? "cheer" : "idle"} variant={variants.get(p.id) ?? 0} accessories={p.accessories} />
                </div>
                <div className="pcard-name">
                  {p.isHost && <span title="Host">👑 </span>}
                  {p.name}
                  {p.isBot && <span className="bot-tag">BOT</span>}
                </div>
                <div className="pcard-status">
                  {p.ready ? <span className="rdy">READY</span> : <span className="dim tiny">waiting…</span>}
                </div>
                {isHost && p.id !== youId && (
                  <button className="kick" onClick={() => (p.isBot ? net.removeBot(p.id) : net.kick(p.id))} title="Remove">
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="reactions">
            <label className="tag">React (they can't hear you scream — but they'll see this)</label>
            <div className="row wrap" style={{ gap: 6 }}>
              {EMOTES.map((e) => (
                <button key={e} className="emote" onClick={() => (audio.sfx("blip"), net.emote(e))}>
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div className="char-change">
            <button
              className="collapse-head"
              onClick={() => (audio.sfx("blip"), setCharOpen((o) => !o))}
              aria-expanded={charOpen}
            >
              <span className="tag">Change your blob</span>
              {!charOpen && (
                <span className="collapse-current">
                  <BlobAvatar characterId={characterId} size={26} accessories={me?.accessories} />
                  {currentChar?.name}
                </span>
              )}
              <span className={`chev ${charOpen ? "open" : ""}`}>▾</span>
            </button>
            {charOpen && (
              <CharacterPicker value={characterId} onPick={(id) => net.setCharacter(id)} size={52} />
            )}
          </div>

          <div className="char-change">
            <label className="tag">Dress your blob 💅</label>
            <AccessoryPicker size={52} />
          </div>
        </div>

        {/* config + start */}
        <div className="col" style={{ gap: 14 }}>
          <div className="panel config">
            <h3>House Rules</h3>
            {!isHost && <div className="tiny dim">Only the host decides how you die. Take it up with them.</div>}

            <div className="cfg-row">
              <label className="tag">Death Rule</label>
              <div className="seg">
                <button className={room.config.mode === "hardcore" ? "on" : ""} disabled={!isHost} onClick={() => patch({ mode: "hardcore" as SeriesMode })}>
                  💀 Hardcore
                </button>
                <button className={room.config.mode === "casual" ? "on" : ""} disabled={!isHost} onClick={() => patch({ mode: "casual" as SeriesMode })}>
                  🩹 Casual
                </button>
              </div>
              <div className="tiny dim">
                {room.config.mode === "hardcore" ? "Eliminated = dead for the whole series. No respawns, no refunds. Last blob standing wins." : "Respawn each round and pretend it never happened. Most points across all games wins."}
              </div>
            </div>

            <div className="cfg-row">
              <label className="tag"># of Games</label>
              <div className="seg">
                {(["mystery", 1, 3, 5, 7, 10, 12] as const).map((r) => (
                  <button key={String(r)} className={room.config.rounds === r ? "on" : ""} disabled={!isHost} onClick={() => patch({ rounds: r })}>
                    {r === "mystery" ? "❓ Mystery" : r}
                  </button>
                ))}
              </div>
              <div className="tiny dim">
                {room.config.rounds === "mystery" ? "The Game Master won't say how many. The not-knowing is part of the package." : `Exactly ${room.config.rounds} games. Pace your panic accordingly.`}
              </div>
            </div>

            <div className="cfg-row">
              <label className="tag">Extras</label>
              <div className="row wrap" style={{ gap: 8 }}>
                <button className={`toggle ${room.config.botFill ? "on" : ""}`} disabled={!isHost} onClick={() => patch({ botFill: !room.config.botFill })}>
                  🤖 Fill with bots
                </button>
                <button className={`toggle ${room.config.friendlyFire ? "on" : ""}`} disabled={!isHost} onClick={() => patch({ friendlyFire: !room.config.friendlyFire })}>
                  💥 Friendly fire
                </button>
                <button
                  className={`toggle ${room.config.nightMode ? "on" : ""}`}
                  disabled={!isHost || room.config.mode !== "hardcore"}
                  onClick={() => patch({ nightMode: !room.config.nightMode })}
                  title="Hardcore only: random rounds go dark, so you can't see it coming."
                >
                  🌙 Night mode
                </button>
              </div>
              {room.config.mode !== "hardcore" ? (
                <div className="tiny dim">🌙 Night mode needs the Hardcore death rule. Go big or stay alive.</div>
              ) : room.config.nightMode ? (
                <div className="tiny dim">🌙 Random rounds go pitch black — grab 🔦 lanterns to watch it happen in detail.</div>
              ) : null}
            </div>

            <div className="cfg-row">
              <label className="tag">Game Pool {allowed.size === 0 ? "(all)" : `(${allowed.size})`}</label>
              <div className="game-chips">
                {ALL_GAME_IDS.map((id) => (
                  <button key={id} className={`chip ${gameIsOn(id) ? "on" : ""}`} disabled={!isHost} onClick={() => toggleGame(id)} title={GAMES[id].tagline}>
                    <GameIcon id={id} /> {GAMES[id].name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="panel start-panel">
            {isHost ? (
              <>
                <button className="btn pink big" style={{ width: "100%" }} disabled={!canStart} onClick={() => (audio.sfx("drum"), net.start())}>
                  ▶ Begin the Trials
                </button>
                {!canStart && <div className="tiny dim center" style={{ textAlign: "center" }}>You need at least {MIN_TO_START} blobs to have a proper massacre. Add a friend or enable bot-fill.</div>}
              </>
            ) : (
              <>
                <button
                  className={`btn big ${me?.ready ? "ghost" : "teal"}`}
                  style={{ width: "100%" }}
                  onClick={() => (audio.sfx("blip"), net.ready(!me?.ready))}
                >
                  {me?.ready ? "✓ Ready! (on second thought…)" : "I Consent to This"}
                </button>
                <div className="tiny dim center" style={{ textAlign: "center" }}>Waiting for the host to pull the trigger…</div>
              </>
            )}
            <div className="tiny dim center" style={{ textAlign: "center", marginTop: 8 }}>
              Win {CURRENCY} {CURRENCY_ICON} and eternal bragging rights. {humans.length} human{humans.length === 1 ? "" : "s"} present, all of them expendable.
            </div>
          </div>

        </div>
      </div>

      <ChatDock title="Lobby chat — last words welcome" collapsedLabel="Chat" accent="var(--pink)" side="right" />

      <style jsx>{`
        .topbar {
          display: flex;
          align-items: center;
          padding-top: 16px;
        }
        .codebox {
          display: flex;
          flex-direction: column;
          align-items: center;
          cursor: pointer;
          background: rgba(255, 79, 154, 0.12);
          border: 2px solid var(--line-bright);
          border-radius: 16px;
          padding: 6px 26px;
        }
        .code {
          font-family: var(--font-display);
          font-size: 2.2rem;
          font-weight: 700;
          letter-spacing: 8px;
          color: var(--pink);
          line-height: 1;
        }
        .lobby-grid {
          display: grid;
          grid-template-columns: 1.4fr 1fr;
          gap: 16px;
          padding-top: 14px;
          padding-bottom: 30px;
        }
        /* Let both columns shrink so the character strip scrolls horizontally
           instead of blowing out the grid and shoving the config panel off-screen. */
        .lobby-grid > * {
          min-width: 0;
        }
        .players-panel {
          padding: 18px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .players {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
          gap: 10px;
        }
        .pcard {
          position: relative;
          background: rgba(0, 0, 0, 0.22);
          border: 2px solid var(--line);
          border-radius: 16px;
          padding: 10px 8px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }
        .pcard.me {
          border-color: var(--yellow);
          background: rgba(255, 213, 79, 0.08);
        }
        .pnum {
          position: absolute;
          top: 6px;
          left: 6px;
          font-family: var(--font-display);
          font-weight: 800;
          font-size: 0.72rem;
          letter-spacing: 1.5px;
          color: #16201d;
          background: rgba(245, 247, 244, 0.94);
          border: 1.5px solid rgba(20, 30, 28, 0.35);
          border-radius: 7px;
          padding: 1px 6px;
          line-height: 1.3;
        }
        .pcard.me .pnum {
          background: var(--yellow);
        }
        .pcard.off {
          opacity: 0.5;
        }
        .pcard-name {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 0.9rem;
          text-align: center;
        }
        .bot-tag {
          font-size: 0.6rem;
          background: var(--accent);
          border-radius: 6px;
          padding: 1px 5px;
          margin-left: 4px;
          vertical-align: middle;
        }
        .rdy {
          color: var(--green);
          font-weight: 800;
          font-size: 0.8rem;
        }
        .kick {
          position: absolute;
          top: 4px;
          right: 4px;
          background: rgba(255, 82, 82, 0.2);
          border: none;
          color: var(--red);
          border-radius: 8px;
          width: 22px;
          height: 22px;
          font-weight: 800;
        }
        .emote {
          font-size: 1.2rem;
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid var(--line);
          border-radius: 10px;
          padding: 4px 8px;
        }
        .emote:active {
          transform: translateY(1px) scale(0.94);
        }
        .emote-bubble {
          position: absolute;
          top: -16px;
          left: 50%;
          font-size: 1.8rem;
          pointer-events: none;
          z-index: 5;
          filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.55));
          animation: emotePop 2.4s ease forwards;
        }
        @keyframes emotePop {
          0% {
            opacity: 0;
            transform: translate(-50%, 8px) scale(0.4) rotate(-8deg);
          }
          12% {
            opacity: 1;
            transform: translate(-50%, -3px) scale(1.3) rotate(4deg);
          }
          24% {
            transform: translate(-50%, -5px) scale(1) rotate(0deg);
          }
          78% {
            opacity: 1;
            transform: translate(-50%, -10px) scale(1);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -26px) scale(0.9);
          }
        }
        .config {
          padding: 18px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .cfg-row {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .seg {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .seg button,
        .toggle {
          background: rgba(0, 0, 0, 0.22);
          border: 2px solid var(--line);
          border-radius: 12px;
          padding: 8px 14px;
          color: var(--ink);
          font-family: var(--font-display);
          font-weight: 700;
        }
        .seg button.on,
        .toggle.on {
          border-color: var(--pink);
          background: rgba(255, 79, 154, 0.18);
        }
        .seg button:disabled,
        .toggle:disabled,
        .chip:disabled {
          opacity: 0.7;
          cursor: default;
        }
        .game-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .chip {
          background: rgba(0, 0, 0, 0.2);
          border: 2px solid var(--line);
          border-radius: 999px;
          padding: 5px 12px;
          font-family: var(--font-game);
          font-size: 0.72rem;
          letter-spacing: 0;
          color: var(--ink-dim);
          font-weight: 400;
        }
        .chip.on {
          border-color: var(--teal);
          color: var(--ink);
          background: rgba(31, 227, 194, 0.12);
        }
        .start-panel {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .char-change {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .collapse-head {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          background: none;
          border: none;
          padding: 2px 0;
          color: var(--ink);
          cursor: pointer;
          text-align: left;
        }
        .collapse-current {
          display: flex;
          align-items: center;
          gap: 6px;
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 0.82rem;
          color: var(--ink-dim);
        }
        .chev {
          margin-left: auto;
          font-size: 0.9rem;
          color: var(--ink-dim);
          transition: transform 0.15s ease;
        }
        .chev.open {
          transform: rotate(180deg);
        }
        .reactions {
          display: flex;
          flex-direction: column;
          gap: 6px;
          background: rgba(255, 79, 154, 0.08);
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 10px 12px;
        }
        .reactions .emote {
          font-size: 1.4rem;
          padding: 5px 10px;
        }
        @media (max-width: 860px) {
          .lobby-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
