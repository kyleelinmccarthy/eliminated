"use client";
// The Games grid on /how-to-play. Each card is a button that pops a modal with
// the full rules, control scheme, and a bigger live preview — so the grid stays
// skimmable and the fiddly key bindings live one tap away instead of cluttering
// every card. Server component (the page) hands us nothing; we read the catalog
// straight from lib/shared/games like it does.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { GamePreview } from "./GamePreview";
import { GameIcon } from "./GameIcon";
import { GAMES, ALL_GAME_IDS } from "@/lib/shared/games";
import type { GameId } from "@/lib/shared/types";

// Friendly chips for the abstract control hints (ControlHint + the one-off
// "duel" tag RPS sneaks in). Keeps the modal honest about what your thumbs do.
const HINT_LABEL: Record<string, string> = {
  move: "🕹️ Move",
  tap: "👆 Tap / mash",
  choose: "🤔 Choose",
  aim: "🎯 Aim",
  team: "👥 Teams",
  duel: "⚔️ 1v1 duel",
};

// How hard a game tends to thin the herd, in the house voice.
const CULL_LABEL: Record<string, string> = {
  low: "💀 Gentle cull",
  mid: "💀 Steady cull",
  high: "💀 Brutal cull",
};

export function HowToGames() {
  const [openId, setOpenId] = useState<GameId | null>(null);

  return (
    <div className="htp-games">
      {ALL_GAME_IDS.map((id) => {
        const g = GAMES[id];
        return (
          <button
            key={id}
            type="button"
            className="card htp-game htp-game--btn"
            onClick={() => setOpenId(id)}
            aria-haspopup="dialog"
          >
            <div className="row" style={{ gap: 10 }}>
              <GameIcon id={id} style={{ fontSize: "2rem" }} />
              <strong className="game-name">{g.name}</strong>
            </div>
            <GamePreview gameId={id} />
            <p className="tiny" style={{ margin: "6px 0" }}>{g.rules}</p>
            <span className="htp-controls-cta">🎮 View controls →</span>
          </button>
        );
      })}
      {openId && <GameModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function GameModal({ id, onClose }: { id: GameId; onClose: () => void }) {
  // Esc closes; lock the page behind the modal so the scrim doesn't scroll.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const g = GAMES[id];
  const hints = (g.controls as string[]).filter((h, i, a) => a.indexOf(h) === i);

  return createPortal(
    <div className="htp-modal-backdrop" onClick={onClose}>
      <div
        className="panel htp-modal"
        role="dialog"
        aria-modal="true"
        aria-label={g.name}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="htp-modal-x" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <div className="row" style={{ gap: 12 }}>
          <GameIcon id={id} style={{ fontSize: "2.4rem" }} />
          <div>
            <h3 style={{ margin: 0 }}>{g.name}</h3>
            <p className="tiny dim" style={{ margin: "2px 0 0" }}>{g.tagline}</p>
          </div>
        </div>

        <GamePreview gameId={id} />

        <div className="htp-modal-sect">
          <h4>📜 The Rules</h4>
          <p className="tiny" style={{ margin: 0 }}>{g.rules}</p>
        </div>

        <div className="htp-modal-sect">
          <h4>🎮 Controls</h4>
          {hints.length > 0 && (
            <div className="row wrap" style={{ gap: 6 }}>
              {hints.map((h) => (
                <span key={h} className="pill" style={{ fontSize: "0.74rem", padding: "3px 10px" }}>
                  {HINT_LABEL[h] ?? h}
                </span>
              ))}
            </div>
          )}
          <p className="tiny htp-ctrl">{g.controlText}</p>
        </div>

        <div className="row wrap htp-modal-meta">
          {g.lengthHint && <span className="pill tiny">⏱️ {g.lengthHint}</span>}
          <span className="pill tiny">👥 {g.minPlayers}+ blobs</span>
          {g.requiresEven && <span className="pill tiny">⚖️ Even teams only</span>}
          {g.cull && <span className="pill tiny">{CULL_LABEL[g.cull]}</span>}
          {g.finale && <span className="pill tiny">🏁 The finale</span>}
          {g.finaleCapable && !g.finale && <span className="pill tiny">🏁 Can end a series</span>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
