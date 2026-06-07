"use client";
import { useState, useRef, useEffect, type ReactNode } from "react";
import { useGame } from "@/lib/client/net";
import { audio } from "@/lib/client/audio";
import { Chat } from "./Chat";

// One floating, collapsible chat used in two places: the lobby (bottom-right,
// pink) and the in-game spectator view (bottom-left, red — out of the Dead Pool's
// way). Collapses to a pill so it never buries the rest of the UI; while collapsed
// it counts unread lines so people still notice the room talking.
export function ChatDock({
  title,
  accent = "var(--pink)",
  side = "right",
  collapsedLabel = "Chat",
  defaultOpen = false,
}: {
  title?: ReactNode;
  accent?: string;
  side?: "left" | "right";
  collapsedLabel?: string;
  defaultOpen?: boolean;
}) {
  const chatLen = useGame((s) => s.chat.length);
  const [open, setOpen] = useState(defaultOpen);
  const seen = useRef(chatLen);
  const [unread, setUnread] = useState(0);

  // Open => everything's been seen. Closed => tally lines arriving since.
  useEffect(() => {
    if (open) {
      seen.current = chatLen;
      setUnread(0);
    } else {
      setUnread(Math.max(0, chatLen - seen.current));
    }
  }, [open, chatLen]);

  function toggle(next: boolean) {
    audio.sfx("blip");
    setOpen(next);
  }

  return (
    <>
      {open ? (
        <div className={`chatdock ${side}`} style={{ borderColor: accent }}>
          <div className="chatdock-head">
            <span className="chatdock-title" style={{ color: accent }}>
              {title}
            </span>
            <button className="chatdock-min" onClick={() => toggle(false)} title="Collapse" aria-label="Collapse chat">
              ▾
            </button>
          </div>
          <Chat compact height={236} />
        </div>
      ) : (
        <button
          className={`chatdock-fab ${side}`}
          style={{ borderColor: accent }}
          onClick={() => toggle(true)}
          aria-label="Open chat"
        >
          💬 {collapsedLabel}
          {unread > 0 && <span className="chatdock-badge">{unread > 9 ? "9+" : unread}</span>}
        </button>
      )}

      <style jsx>{`
        .chatdock {
          position: fixed;
          bottom: 16px;
          z-index: 40;
          width: min(360px, calc(100vw - 24px));
          background: var(--panel);
          border: 2px solid var(--pink);
          border-radius: 16px;
          padding: 12px;
          backdrop-filter: blur(8px);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.42);
          display: flex;
          flex-direction: column;
          gap: 8px;
          animation: dockIn 0.16s ease;
        }
        .chatdock.right {
          right: 16px;
        }
        .chatdock.left {
          left: 16px;
        }
        .chatdock-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .chatdock-title {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 0.82rem;
          line-height: 1.25;
        }
        .chatdock-min {
          flex-shrink: 0;
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid var(--line);
          color: var(--ink);
          border-radius: 9px;
          width: 28px;
          height: 28px;
          font-size: 1rem;
          font-weight: 800;
          line-height: 1;
          cursor: pointer;
        }
        .chatdock-fab {
          position: fixed;
          bottom: 16px;
          z-index: 40;
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--panel);
          border: 2px solid var(--line-bright);
          border-radius: 999px;
          padding: 11px 18px;
          color: var(--ink);
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 0.95rem;
          backdrop-filter: blur(8px);
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.38);
          cursor: pointer;
        }
        .chatdock-fab.right {
          right: 16px;
        }
        .chatdock-fab.left {
          left: 16px;
        }
        .chatdock-fab:active {
          transform: translateY(1px) scale(0.97);
        }
        .chatdock-badge {
          background: var(--red);
          color: #fff;
          border-radius: 999px;
          font-size: 0.72rem;
          font-weight: 800;
          min-width: 19px;
          height: 19px;
          padding: 0 5px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        @keyframes dockIn {
          from {
            opacity: 0;
            transform: translateY(8px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </>
  );
}
