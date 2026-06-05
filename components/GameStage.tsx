"use client";
import { useEffect, useRef, useState } from "react";
import { useGame, net, snapBuffer } from "@/lib/client/net";
import { audio } from "@/lib/client/audio";
import { renderFrame } from "@/lib/client/render/renderers";
import { FxSystem } from "@/lib/client/render/fx";
import { GAMES } from "@/lib/shared/games";
import { getMap } from "@/lib/shared/maps";
import { ARENA_W, ARENA_H, TICK_MS } from "@/lib/shared/constants";
import { formatPlayerNumber } from "@/lib/shared/util";
import type { Snapshot } from "@/lib/shared/types";
import { IntroOverlay } from "./overlays/IntroOverlay";
import { RoundResultOverlay } from "./overlays/RoundResultOverlay";
import { SeriesResultOverlay } from "./overlays/SeriesResultOverlay";
import { GameControls } from "./GameControls";
import { MuteButton } from "./MuteButton";

export function GameStage() {
  const phase = useGame((s) => s.room?.phase);

  return (
    <div className="stage">
      <PlayingView />
      {phase === "intro" && <IntroOverlay />}
      {phase === "roundResult" && <RoundResultOverlay />}
      {phase === "seriesResult" && <SeriesResultOverlay />}
      <style jsx>{`
        .stage {
          position: fixed;
          inset: 0;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}

function liveCount(snap: Snapshot | null): number {
  if (!snap) return 0;
  const d: any = snap.data || {};
  if (snap.actors) return snap.actors.filter((a) => a.alive).length;
  if (d.walkers) return d.walkers.filter((w: any) => w.alive).length;
  if (d.jumpers) return d.jumpers.filter((j: any) => j.alive).length;
  if (d.pullers) return d.pullers.length;
  if (d.duels) return d.duels.filter((x: any) => x.status !== "done" || x.winner).length;
  return 0;
}

// Per-entity alive flags for the games that track individual life/death.
function aliveStates(snap: Snapshot): Map<string, boolean> {
  const m = new Map<string, boolean>();
  const d: any = snap.data || {};
  if (snap.actors) for (const a of snap.actors) m.set(a.id, !!a.alive);
  else if (d.walkers) for (const w of d.walkers) m.set(w.id, !!w.alive);
  else if (d.jumpers) for (const j of d.jumpers) m.set(j.id, !!j.alive);
  return m;
}

// Game Master callout when OTHER players are eliminated. Throttled, and on a
// mass wipe (e.g. a red light) reads out every fallen player's number in order.
function announceDeaths(
  cur: Snapshot,
  prevAlive: React.MutableRefObject<Map<string, boolean>>,
  lastAnnounce: React.MutableRefObject<number>,
  numbers: Map<string, number>,
  youId: string | null,
  now: number,
) {
  const curAlive = aliveStates(cur);
  const prev = prevAlive.current;
  if (prev.size > 0) {
    const deadOthers: number[] = [];
    let youDied = false;
    for (const [id, alive] of curAlive) {
      if (prev.get(id) === true && !alive) {
        if (id === youId) youDied = true;
        else {
          const n = numbers.get(id);
          if (n) deadOthers.push(n);
        }
      }
    }
    if (youDied) {
      // your own "You have been eliminated." line takes priority — stay quiet
      lastAnnounce.current = now;
    } else if (deadOthers.length && now - lastAnnounce.current > 1500) {
      // Read every fallen number in order ("three oh five, three oh six…").
      // Spaced digits force the TTS to read a tracksuit tag, not "three hundred".
      const sorted = [...deadOthers].sort((a, b) => a - b);
      const named = sorted.map((n) => formatPlayerNumber(n).split("").join(" "));
      const label = sorted.length === 1 ? "Player" : "Players";
      audio.speak(`${label} ${named.join(", ")}, eliminated.`);
      lastAnnounce.current = now;
    }
  }
  prevAlive.current = curAlive;
}

function youAliveIn(snap: Snapshot | null, youId: string | null): boolean {
  if (!snap || !youId) return true;
  const d: any = snap.data || {};
  if (snap.actors) {
    const a = snap.actors.find((x) => x.id === youId);
    return a ? a.alive : false;
  }
  if (d.walkers) {
    const w = d.walkers.find((x: any) => x.id === youId);
    return w ? w.alive : true;
  }
  if (d.jumpers) {
    const j = d.jumpers.find((x: any) => x.id === youId);
    return j ? j.alive : true;
  }
  return true;
}

function PlayingView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef(new FxSystem());
  const room = useGame((s) => s.room);
  const youId = useGame((s) => s.youId);
  const [hud, setHud] = useState({ timeLeft: 0, alive: 0, game: room?.currentGame, youDown: false });
  const [showElim, setShowElim] = useState(false);
  const wasDown = useRef(false);
  const aliveThisRound = useRef(false);
  const lastSnapT = useRef(0);
  const prevLight = useRef<string>("");
  const prevPhase = useRef<string>("");
  const numbersRef = useRef<Map<string, number>>(new Map());
  const prevAliveRef = useRef<Map<string, boolean>>(new Map());
  const deathAtRef = useRef<Map<string, number>>(new Map());
  const lastAnnounceRef = useRef(0);
  const playing = room?.phase === "playing";
  const myNumber = room?.players.find((p) => p.id === youId)?.number;

  // keep a fast playerId -> Squid Game number lookup for the canvas loop
  useEffect(() => {
    const m = new Map<string, number>();
    for (const p of room?.players ?? []) m.set(p.id, p.number);
    numbersRef.current = m;
  }, [room?.players]);

  useEffect(() => {
    fxRef.current.reset();
    lastSnapT.current = 0;
    prevLight.current = "";
    prevPhase.current = "";
    audio.stopMusic();
    wasDown.current = false;
    aliveThisRound.current = false;
    prevAliveRef.current = new Map();
    deathAtRef.current = new Map();
    lastAnnounceRef.current = 0;
    setShowElim(false);
  }, [room?.currentGame, room?.roundIndex]);

  // stop the musical-chairs loop whenever we leave the play phase
  useEffect(() => {
    if (!playing) audio.stopMusic();
  }, [playing]);

  // dramatic "You have been Eliminated." flash on the frame you go down — but
  // only if you were actually playing this round (not an existing spectator).
  useEffect(() => {
    if (!playing) {
      wasDown.current = false;
      return;
    }
    const down = !!hud.youDown;
    if (!down) aliveThisRound.current = true;
    else if (aliveThisRound.current && !wasDown.current) setShowElim(true);
    wasDown.current = down;
  }, [hud.youDown, playing]);

  useEffect(() => {
    if (!showElim) return;
    const id = setTimeout(() => setShowElim(false), 3000);
    return () => clearTimeout(id);
  }, [showElim]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let hudThrottle = 0;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const fx = fxRef.current;
      const cur = snapBuffer.cur;
      const prev = snapBuffer.prev;
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;

      if (cur) {
        // ingest new snapshot once
        if (cur.t !== lastSnapT.current) {
          handleSnapshotAudio(cur, prevLight, prevPhase);
          if (cur.actors) fx.ingest(cur.fx);
          else playFxSounds(cur.fx);
          announceDeaths(cur, prevAliveRef, lastAnnounceRef, numbersRef.current, youId, now);
          // stamp the moment each blob is first seen dead so the coffin can drop in
          for (const [id, alive] of aliveStates(cur)) {
            if (!alive) {
              if (!deathAtRef.current.has(id)) deathAtRef.current.set(id, now);
            } else if (deathAtRef.current.has(id)) {
              deathAtRef.current.delete(id);
            }
          }
          lastSnapT.current = cur.t;
        }
        const alpha = Math.min(1, (now - snapBuffer.recvAt) / TICK_MS);
        fx.update(dt);
        const mapId = room?.currentMapId ?? null;
        renderFrame(ctx, W, H, cur, prev, alpha, { youId, time: now, fx, mapId, numbers: numbersRef.current, deaths: deathAtRef.current });
      } else {
        ctx.clearRect(0, 0, W, H);
      }

      // HUD throttle
      hudThrottle += dt;
      if (hudThrottle > 0.12) {
        hudThrottle = 0;
        const d: any = cur?.data || {};
        setHud({
          timeLeft: d.timeLeft ?? 0,
          alive: liveCount(cur),
          game: cur?.game ?? room?.currentGame,
          youDown: !youAliveIn(cur, youId),
        });
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [room?.currentMapId, room?.currentGame, youId]);

  const gameMeta = hud.game ? GAMES[hud.game] : null;
  const map = getMap(room?.currentMapId ?? null);
  const roundLabel = room
    ? room.totalRoundsKnown
      ? `Game ${room.roundIndex + 1} / ${room.totalRounds}`
      : `Game ${room.roundIndex + 1} / ?`
    : "";

  return (
    <div className="playview">
      <canvas ref={canvasRef} className="gamecanvas" />

      {/* HUD */}
      <div className="hud-top">
        <LeaveGameButton />
        <div className="hud-pill">
          <span style={{ fontSize: "1.3rem" }}>{gameMeta?.icon}</span>
          <div className="col" style={{ gap: 0 }}>
            <strong className="title-font" style={{ lineHeight: 1 }}>{gameMeta?.name}</strong>
            <span className="tiny dim">{roundLabel} · {map.name}</span>
          </div>
        </div>
        <div className="spacer" />
        {playing && hud.timeLeft > 0 && (
          <div className="hud-pill timer">
            ⏱ <strong>{Math.ceil(hud.timeLeft)}</strong>
          </div>
        )}
        <div className="hud-pill">
          🩸 <strong>{hud.alive}</strong> left
        </div>
        <MuteButton />
      </div>

      {showElim && playing && <EliminatedOverlay number={myNumber} />}

      {hud.youDown && playing && !showElim && (
        <div className="spectate">
          💀 Player {formatPlayerNumber(myNumber)} eliminated — enjoy the rest of the show from the great beyond…
        </div>
      )}

      {playing && hud.game && !hud.youDown && (
        <GameControls game={hud.game} />
      )}

      <style jsx>{`
        .playview {
          position: absolute;
          inset: 0;
        }
        .gamecanvas {
          width: 100%;
          height: 100%;
          display: block;
          touch-action: none;
        }
        .hud-top {
          position: absolute;
          top: 12px;
          left: 12px;
          right: 12px;
          display: flex;
          align-items: center;
          gap: 10px;
          pointer-events: none;
        }
        .hud-top :global(.pill) {
          pointer-events: auto;
        }
        .hud-pill {
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--panel);
          border: 2px solid var(--line);
          border-radius: 14px;
          padding: 7px 14px;
          backdrop-filter: blur(8px);
        }
        .hud-pill.timer strong {
          color: var(--yellow);
          font-size: 1.2rem;
        }
        .spectate {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(0, 0, 0, 0.55);
          border: 2px solid var(--red);
          border-radius: 16px;
          padding: 14px 26px;
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 1.2rem;
        }
      `}</style>
    </div>
  );
}

// Bail out of a match in progress. Leaving mid-game gets your blob boxed up on
// the server (see GameRoom.removePlayer) AND the doors lock behind you — once a
// match has started you can't rejoin (RoomManager.joinRoom). So it's gated
// behind an explicit "are you sure?" that spells out both consequences; no
// accidental rage-quits mid-WASD. Lives in the HUD so it's reachable any round.
function LeaveGameButton() {
  const [confirm, setConfirm] = useState(false);
  const leave = () => {
    audio.sfx("death");
    setConfirm(false);
    net.leaveRoom();
  };
  return (
    <>
      <button
        className="pill"
        onClick={() => (audio.sfx("blip"), setConfirm(true))}
        title="Leave the match"
      >
        🚪 Leave
      </button>

      {confirm && (
        <div className="leave-modal" role="dialog" aria-modal="true">
          <div className="leave-card">
            <div className="leave-icon">⚰️</div>
            <h2>Leave for good?</h2>
            <p>
              Walk out now and you're <strong>eliminated on the spot</strong> — boxed up, ribbon
              and bow, the works.
            </p>
            <p className="leave-warn">
              🔒 And the doors lock behind you: <strong>you can't rejoin this match.</strong> No
              refunds, no do-overs. The Game Master is already moving on.
            </p>
            <div className="leave-actions">
              <button className="btn ghost big" onClick={() => setConfirm(false)}>
                Never mind, I'll stay
              </button>
              <button className="btn pink big" onClick={leave}>
                ⚰️ Box me up &amp; leave
              </button>
            </div>
          </div>
          <style jsx>{`
            .leave-modal {
              position: fixed;
              inset: 0;
              z-index: 60;
              pointer-events: auto;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
              background: rgba(4, 3, 10, 0.74);
              backdrop-filter: blur(4px);
              animation: leaveFade 0.18s ease both;
            }
            .leave-card {
              width: min(440px, 100%);
              background: var(--panel-2, #14312788);
              border: 2px solid var(--red);
              border-radius: 20px;
              padding: 26px 24px 22px;
              text-align: center;
              box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
              animation: leavePop 0.22s ease both;
            }
            .leave-icon {
              font-size: 2.6rem;
              line-height: 1;
            }
            .leave-card h2 {
              font-family: var(--font-display);
              font-weight: 800;
              font-size: 1.5rem;
              margin: 8px 0 6px;
            }
            .leave-card p {
              color: var(--ink-dim);
              font-size: 0.95rem;
              line-height: 1.45;
              margin: 6px 0;
            }
            .leave-card strong {
              color: var(--ink);
            }
            .leave-warn {
              background: rgba(255, 46, 90, 0.12);
              border: 1px solid rgba(255, 46, 90, 0.4);
              border-radius: 12px;
              padding: 8px 12px;
              margin-top: 10px !important;
            }
            .leave-actions {
              display: flex;
              flex-wrap: wrap;
              gap: 10px;
              margin-top: 18px;
            }
            .leave-actions :global(.btn) {
              flex: 1 1 0;
              min-width: 150px;
            }
            @keyframes leaveFade {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes leavePop {
              from { opacity: 0; transform: translateY(10px) scale(0.96); }
              to { opacity: 1; transform: translateY(0) scale(1); }
            }
          `}</style>
        </div>
      )}
    </>
  );
}

function EliminatedOverlay({ number }: { number?: number }) {
  useEffect(() => {
    audio.speak("You have been eliminated.");
  }, []);
  return (
    <div className="elim" aria-live="assertive">
      <div className="shapes">○ △ □</div>
      <div className="tag">PLAYER {formatPlayerNumber(number)}</div>
      <div className="title">
        You have been
        <br />
        Eliminated.
      </div>
      <div className="rule" />
      <style jsx>{`
        .elim {
          position: absolute;
          inset: 0;
          z-index: 30;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          text-align: center;
          pointer-events: none;
          background:
            radial-gradient(820px 620px at 50% 50%, rgba(255, 46, 90, 0.32), transparent 70%),
            rgba(6, 3, 12, 0.82);
          animation: elimIn 0.45s ease both;
        }
        .shapes {
          font-size: 1.6rem;
          letter-spacing: 0.5rem;
          color: var(--pink);
          opacity: 0.85;
          text-shadow: 0 0 18px rgba(255, 46, 136, 0.7);
        }
        .tag {
          font-family: var(--font-display);
          font-weight: 800;
          letter-spacing: 0.32rem;
          font-size: 1.1rem;
          color: #fff;
          background: rgba(255, 46, 136, 0.16);
          border: 2px solid var(--line-bright);
          border-radius: 999px;
          padding: 6px 20px;
        }
        .title {
          font-family: var(--font-display);
          font-weight: 800;
          font-size: clamp(2.4rem, 8vw, 5rem);
          line-height: 1.02;
          color: #fff;
          text-shadow:
            0 0 6px rgba(255, 46, 90, 0.9),
            0 0 28px rgba(255, 46, 90, 0.7),
            0 6px 0 rgba(120, 8, 36, 0.55);
          animation: elimPulse 1.6s ease-in-out infinite;
        }
        .rule {
          width: min(360px, 70vw);
          height: 4px;
          border-radius: 4px;
          background: linear-gradient(90deg, transparent, var(--red), transparent);
        }
        @keyframes elimIn {
          from {
            opacity: 0;
            transform: scale(1.12);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        @keyframes elimPulse {
          0%,
          100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.035);
          }
        }
      `}</style>
    </div>
  );
}

function handleSnapshotAudio(
  snap: Snapshot,
  prevLight: React.MutableRefObject<string>,
  prevPhase: React.MutableRefObject<string>,
) {
  if (snap.game === "redlight") {
    const light = (snap.data as any)?.light;
    if (light && light !== prevLight.current) {
      if (light === "red") audio.sfx("alarm");
      else audio.sfx("chime");
      prevLight.current = light;
    }
  }
  if (snap.game === "musicalchairs") {
    const phase = (snap.data as any)?.phase;
    if (phase && phase !== prevPhase.current) {
      if (phase === "music") audio.startMusic();
      else {
        audio.stopMusic();
        if (phase === "scramble") audio.sfx("bad");
      }
      prevPhase.current = phase;
    }
  }
  playFxSounds(snap.fx);
}

function playFxSounds(fx: Snapshot["fx"]) {
  if (!fx) return;
  for (const e of fx) {
    switch (e.kind) {
      case "death":
        audio.sfx("death");
        break;
      case "shatter":
        audio.sfx("shatter");
        break;
      case "pickup":
        audio.sfx("pickup");
        break;
      case "confetti":
        audio.sfx("good");
        break;
      case "shockwave":
        audio.sfx("jump");
        break;
      case "ring":
        audio.sfx("beep");
        break;
    }
  }
}
