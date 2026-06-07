"use client";
import { useState, useRef, useEffect } from "react";
import { useGame, net } from "@/lib/client/net";

export function Chat({ compact = false, height }: { compact?: boolean; height?: number | string }) {
  const chat = useGame((s) => s.chat);
  const youId = useGame((s) => s.youId);
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);

  function send() {
    const t = text.trim();
    if (!t) return;
    net.chat(t);
    setText("");
  }

  return (
    <div className="chat" style={{ height: height ?? (compact ? 160 : "100%") }}>
      <div className="chat-log scroll" ref={scrollRef}>
        {chat.length === 0 && <div className="dim tiny">Say something nice. It may be your last. 👋</div>}
        {chat.map((l, i) => (
          <div key={i} className={`chat-line ${l.system ? "sys" : ""}`}>
            {l.system ? (
              <span className="gm">🎭 {l.text}</span>
            ) : (
              <>
                <span className="who" style={{ color: l.from === youId ? "var(--yellow)" : "var(--teal)" }}>
                  {l.name}:
                </span>{" "}
                <span>{l.text}</span>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <input
          className="input"
          style={{ flex: 1, padding: "8px 12px", fontSize: "0.9rem" }}
          value={text}
          maxLength={140}
          placeholder="message…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="btn sm" onClick={send}>
          ➤
        </button>
      </div>
      <style jsx>{`
        .chat {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-height: 0;
        }
        .chat-log {
          flex: 1;
          min-height: 0;
          background: rgba(0, 0, 0, 0.25);
          border-radius: 12px;
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 0.88rem;
        }
        .chat-line.sys .gm {
          color: var(--accent);
          font-style: italic;
          font-weight: 700;
        }
        .who {
          font-weight: 800;
        }
      `}</style>
    </div>
  );
}
