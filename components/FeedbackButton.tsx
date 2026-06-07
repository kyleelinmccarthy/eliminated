"use client";
import { useState } from "react";
import { useGame, net } from "@/lib/client/net";
import { audio } from "@/lib/client/audio";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_LIMITS,
  type FeedbackCategory,
} from "@/lib/shared/feedback";

type Variant = "pill" | "link" | "hud";

// Reusable "send us feedback" entry point. Used on the landing page (pill + footer
// link) and in the in-game HUD. The modal posts to /api/feedback, attaching a bit
// of context (page + current game + clientId) so a bug report is actually useful.
export function FeedbackButton({ variant = "pill", label }: { variant?: Variant; label?: string }) {
  const [open, setOpen] = useState(false);
  const text = label ?? (variant === "hud" ? "💬" : "💬 Feedback");
  return (
    <>
      {variant === "link" ? (
        <button className="fb-link" onClick={() => (audio.sfx("blip"), setOpen(true))}>
          {label ?? "Feedback"}
          <style jsx>{`
            .fb-link {
              background: none;
              border: none;
              padding: 0;
              color: inherit;
              font: inherit;
              cursor: pointer;
              text-decoration: underline;
              text-underline-offset: 2px;
            }
            .fb-link:hover {
              color: var(--accent);
            }
          `}</style>
        </button>
      ) : (
        <button
          className="pill"
          title="Send us feedback"
          aria-label="Send feedback"
          onClick={() => (audio.sfx("blip"), setOpen(true))}
        >
          {text}
        </button>
      )}
      {open && <FeedbackModal onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedbackModal({ onClose }: { onClose: () => void }) {
  const clientId = useGame((s) => s.clientId);
  const room = useGame((s) => s.room) as any;
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const tooShort = message.trim().length < FEEDBACK_LIMITS.messageMin;

  async function submit() {
    if (status === "sending" || tooShort) return;
    setStatus("sending");
    setError(null);
    // small, privacy-light context: where they were when they hit send
    const page = typeof location !== "undefined" ? location.pathname : "";
    const game = room?.currentGame ? `game=${room.currentGame} phase=${room.phase}` : "page";
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const context = `page=${page} ${game} ua=${ua}`.slice(0, FEEDBACK_LIMITS.context);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, email, category, context, clientId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        setStatus("error");
        setError(data?.error || "Something went wrong. Try again in a moment.");
        audio.sfx("bad");
        return;
      }
      setStatus("done");
      audio.sfx("good");
      net.pushToast("Thanks — feedback received. 💌", "good");
      setTimeout(onClose, 1100);
    } catch {
      setStatus("error");
      setError("Network hiccup — couldn't send. Try again?");
      audio.sfx("bad");
    }
  }

  return (
    <div
      className="fb-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Send feedback"
      onClick={onClose}
      // Keep typing inside the modal from reaching the in-game control listeners
      // (which live on window and e.g. preventDefault Space / read WASD as moves).
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        e.stopPropagation();
      }}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <div className="fb-card" onClick={(e) => e.stopPropagation()}>
        <button className="fb-x" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <div className="fb-icon">💬</div>
        <h2>Tell us what you think</h2>
        <p className="fb-sub">
          Found a bug? Got an idea? Hated something? We read all of it. Be as honest as your blob is doomed.
        </p>

        {status === "done" ? (
          <div className="fb-done">✅ Got it — thank you!</div>
        ) : (
          <>
            <div className="fb-cats">
              {FEEDBACK_CATEGORIES.map((c) => (
                <button
                  key={c}
                  className={`fb-cat ${category === c ? "sel" : ""}`}
                  onClick={() => setCategory(c)}
                  type="button"
                >
                  {FEEDBACK_CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>

            <textarea
              className="fb-text"
              placeholder="What happened, or what would you change?"
              value={message}
              maxLength={FEEDBACK_LIMITS.messageMax}
              onChange={(e) => setMessage(e.target.value)}
              autoFocus
              rows={5}
            />

            <input
              className="fb-email"
              type="email"
              placeholder="Email (optional — only if you want a reply)"
              value={email}
              maxLength={FEEDBACK_LIMITS.email}
              onChange={(e) => setEmail(e.target.value)}
            />

            {error && <div className="fb-err">{error}</div>}

            <button className="fb-send" onClick={submit} disabled={status === "sending" || tooShort}>
              {status === "sending" ? "Sending…" : "Send feedback →"}
            </button>
          </>
        )}
      </div>

      <style jsx>{`
        .fb-modal {
          position: fixed;
          inset: 0;
          z-index: 80;
          /* the in-game HUD sets pointer-events:none on its container; the modal
             is a DOM descendant of it, so re-enable interaction explicitly. */
          pointer-events: auto;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          background: rgba(4, 3, 10, 0.72);
          backdrop-filter: blur(4px);
          animation: fbFade 0.18s ease both;
        }
        .fb-card {
          position: relative;
          width: min(480px, 100%);
          max-height: 90vh;
          overflow: auto;
          background: var(--panel-2, #14122a);
          border: 2px solid var(--line-bright);
          border-radius: 20px;
          padding: 26px 24px 22px;
          text-align: center;
          box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
          animation: fbPop 0.22s ease both;
        }
        .fb-x {
          position: absolute;
          top: 12px;
          right: 14px;
          background: none;
          border: none;
          color: var(--ink-dim);
          font-size: 1.1rem;
          cursor: pointer;
        }
        .fb-icon {
          font-size: 2.4rem;
          line-height: 1;
        }
        .fb-card h2 {
          font-family: var(--font-display);
          font-weight: 800;
          font-size: 1.4rem;
          margin: 6px 0 4px;
        }
        .fb-sub {
          color: var(--ink-dim);
          font-size: 0.9rem;
          line-height: 1.4;
          margin: 0 0 14px;
        }
        .fb-cats {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: center;
          margin-bottom: 12px;
        }
        .fb-cat {
          background: rgba(255, 255, 255, 0.06);
          border: 2px solid var(--line);
          border-radius: 999px;
          padding: 6px 12px;
          color: var(--ink);
          font-size: 0.82rem;
          font-weight: 700;
          cursor: pointer;
        }
        .fb-cat.sel {
          border-color: var(--yellow);
          background: rgba(255, 213, 79, 0.18);
        }
        .fb-text,
        .fb-email {
          width: 100%;
          box-sizing: border-box;
          background: rgba(0, 0, 0, 0.3);
          border: 2px solid var(--line);
          border-radius: 12px;
          padding: 10px 12px;
          color: var(--ink);
          font: inherit;
          font-size: 0.95rem;
          resize: vertical;
        }
        .fb-text {
          margin-bottom: 10px;
        }
        .fb-text:focus,
        .fb-email:focus {
          outline: none;
          border-color: var(--accent);
        }
        .fb-err {
          color: var(--red);
          font-size: 0.85rem;
          margin: 10px 0 0;
        }
        .fb-send {
          margin-top: 14px;
          width: 100%;
          padding: 12px;
          border-radius: 14px;
          border: none;
          font-family: var(--font-display);
          font-weight: 800;
          font-size: 1.05rem;
          color: #06241f;
          background: radial-gradient(circle at 30% 25%, #aef5b5, #2bb84d);
          box-shadow: 0 6px 0 #157a2e;
          cursor: pointer;
        }
        .fb-send:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          box-shadow: 0 6px 0 #157a2e;
        }
        .fb-send:active:not(:disabled) {
          transform: translateY(4px);
          box-shadow: 0 2px 0 #157a2e;
        }
        .fb-done {
          font-family: var(--font-display);
          font-weight: 800;
          font-size: 1.2rem;
          color: var(--teal);
          padding: 22px 0;
        }
        @keyframes fbFade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes fbPop {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}
