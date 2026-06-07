"use client";
import { useEffect, useRef, useState } from "react";
import { useGame } from "@/lib/client/net";
import { audio } from "@/lib/client/audio";
import { GAMES } from "@/lib/shared/games";
import { getMap } from "@/lib/shared/maps";

export function IntroOverlay() {
  const room = useGame((s) => s.room)!;
  const intro = room.intro;
  const [secs, setSecs] = useState(99);
  const lastBeep = useRef(99);
  const announced = useRef(false);

  // Game Master voiceline announcing the game (once per reveal)
  useEffect(() => {
    if (!intro || announced.current) return;
    announced.current = true;
    const g = GAMES[intro.game];
    const spoken = g.spokenName ?? g.name;
    let line = intro.isFinale
      ? `The final game. ${spoken}.`
      : `Game ${intro.roundNumber}. ${spoken}.`;
    if (intro.night) line += " Lights out.";
    audio.speak(line);
  }, [intro]);

  useEffect(() => {
    if (!intro) return;
    const tick = () => {
      const remain = Math.max(0, Math.ceil((intro.startsAt - Date.now()) / 1000));
      setSecs(remain);
      if (remain !== lastBeep.current && remain <= 3 && remain > 0) {
        audio.sfx("beep");
        lastBeep.current = remain;
      }
    };
    tick();
    const iv = setInterval(tick, 100);
    return () => clearInterval(iv);
  }, [intro]);

  if (!intro) return null;
  const g = GAMES[intro.game];
  const map = getMap(intro.mapId);

  return (
    <div className="intro" style={{ background: `radial-gradient(900px 600px at 50% 30%, ${map.accent}33, transparent), linear-gradient(160deg, ${map.sky}, #0a0618)` }}>
      <div className="gm-band">🎭 The Game Master cordially presents…</div>
      <div className={`game-no pop ${intro.isFinale ? "finale" : ""}`}>
        {intro.isFinale ? "🏁 FINAL GAME" : `GAME ${intro.roundNumber}`}
      </div>
      {intro.night && <div className="night-badge">🌙 Night Round — good luck seeing it coming</div>}
      <div className="icon floaty">{g.icon}</div>
      <h1 className="gname shadowtext">{g.name}</h1>
      <p className="tagline">{g.tagline}</p>
      <div className="rules card">{g.rules}</div>
      {g.lengthHint && <div className="length-hint">⏱ This round runs about {g.lengthHint.replace(/^~/, "")} — survive the clock.</div>}
      <p className="flavor">“{intro.flavor}”</p>
      <div className="controls-hint">{g.controlText}</div>
      <div className={`count ${secs <= 3 ? "hot" : ""}`}>{secs > 0 ? secs : "GO!"}</div>
      <style jsx>{`
        .intro {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6px;
          text-align: center;
          padding: 20px;
          z-index: 20;
        }
        .gm-band {
          font-family: var(--font-display);
          color: var(--accent);
          font-weight: 700;
          letter-spacing: 1px;
          background: rgba(0, 0, 0, 0.3);
          padding: 6px 16px;
          border-radius: 999px;
        }
        .game-no {
          font-family: var(--font-display);
          font-size: 1.4rem;
          letter-spacing: 4px;
          color: var(--yellow);
        }
        .game-no.finale {
          font-size: 1.8rem;
          color: var(--red);
          text-shadow: 0 0 18px rgba(255, 46, 90, 0.7);
        }
        .night-badge {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 0.9rem;
          color: #cbb6ff;
          background: rgba(40, 30, 80, 0.5);
          border: 1px solid rgba(179, 136, 255, 0.5);
          border-radius: 999px;
          padding: 4px 14px;
        }
        .icon {
          font-size: 5rem;
        }
        .gname {
          font-size: clamp(1.7rem, 5.6vw, 3.3rem);
          font-family: var(--font-game);
          line-height: 1.05;
          letter-spacing: 0;
          text-wrap: balance;
        }
        .tagline {
          color: var(--ink-dim);
          font-weight: 700;
          margin: 0;
        }
        .rules {
          max-width: 520px;
          margin-top: 10px;
          font-size: 0.95rem;
        }
        .length-hint {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 0.82rem;
          color: var(--yellow);
          background: rgba(255, 213, 79, 0.12);
          border: 1px solid rgba(255, 213, 79, 0.4);
          border-radius: 999px;
          padding: 3px 14px;
          margin-top: 6px;
        }
        .flavor {
          color: var(--pink);
          font-style: italic;
          font-weight: 700;
          max-width: 560px;
        }
        .controls-hint {
          font-size: 0.85rem;
          color: var(--ink-dim);
          background: rgba(0, 0, 0, 0.35);
          padding: 6px 14px;
          border-radius: 12px;
        }
        .count {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 5rem;
          color: #fff;
          margin-top: 6px;
          animation: pulse 1s ease-in-out infinite;
        }
        .count.hot {
          color: var(--red);
        }
      `}</style>
    </div>
  );
}
