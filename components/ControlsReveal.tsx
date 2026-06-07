"use client";
import { useState } from "react";

// A compact "🎮 Controls" toggle for the game cards. The exact control scheme is
// reference detail most players skim past, so it sits one tap away instead of
// padding out every card with a second wall of text — the rules already sell the
// game. Click reveals the controlText inline; click again to tuck it back.
export function ControlsReveal({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cr">
      <button
        type="button"
        className="cr-btn"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation(); // cards may themselves be buttons (how-to grid)
          setOpen((o) => !o);
        }}
      >
        🎮 Controls <span className="cr-caret" aria-hidden>{open ? "▴" : "▾"}</span>
      </button>
      {open && <p className="cr-text tiny dim">{text}</p>}
      <style jsx>{`
        .cr {
          margin-top: 6px;
        }
        .cr-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: rgba(0, 0, 0, 0.25);
          border: 2px solid var(--line);
          border-radius: 999px;
          padding: 3px 12px;
          color: var(--ink-dim);
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 0.74rem;
          cursor: pointer;
          transition: color 0.1s, border-color 0.1s;
        }
        .cr-btn:hover {
          color: var(--ink);
          border-color: var(--line-bright);
        }
        .cr-caret {
          font-size: 0.7rem;
        }
        .cr-text {
          margin: 6px 0 0;
        }
      `}</style>
    </div>
  );
}
