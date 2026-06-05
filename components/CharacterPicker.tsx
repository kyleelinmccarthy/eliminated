"use client";
import { useGame } from "@/lib/client/net";
import { CHARACTERS } from "@/lib/shared/characters";
import { CURRENCY_ICON } from "@/lib/shared/constants";
import { BlobAvatar } from "./BlobAvatar";
import { audio } from "@/lib/client/audio";

export function CharacterPicker({
  value,
  onPick,
  size = 64,
}: {
  value: string;
  onPick: (id: string) => void;
  size?: number;
}) {
  const profile = useGame((s) => s.profile);
  const unlocked = new Set(profile?.unlocked ?? CHARACTERS.filter((c) => !c.unlock).map((c) => c.id));

  async function tryUnlock(id: string, cost: number) {
    const clientId = useGame.getState().clientId;
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId, characterId: id, cost }),
      });
      const data = await res.json();
      if (data.error) {
        audio.sfx("bad");
        useGame.getState().set({ toasts: [...useGame.getState().toasts, { id: Date.now(), text: data.error, kind: "bad" }] });
      } else {
        audio.sfx("win");
        useGame.setState({ profile: data });
        onPick(id);
      }
    } catch {
      /* ignore */
    }
  }

  const hasLocked = CHARACTERS.some((c) => c.unlock && !unlocked.has(c.id));

  return (
    <div className="picker">
      <div className="char-strip scroll">
        {CHARACTERS.map((c) => {
          const isUnlocked = unlocked.has(c.id);
          const selected = value === c.id;
          return (
            <button
              key={c.id}
              className={`char-cell ${selected ? "sel" : ""} ${isUnlocked ? "" : "locked"}`}
              title={isUnlocked ? c.catchphrase : `Tap to buy ${c.name} — ${c.unlock} ${CURRENCY_ICON} Marbles. Looking good is no defense.`}
              onClick={() => {
                audio.sfx("blip");
                if (isUnlocked) onPick(c.id);
                else tryUnlock(c.id, c.unlock!);
              }}
            >
              <div className="av">
                <div style={{ filter: isUnlocked ? "none" : "grayscale(1) brightness(0.5)" }}>
                  <BlobAvatar characterId={c.id} size={size} animate={selected} />
                </div>
                {!isUnlocked && <span className="lock-glyph">🔒</span>}
              </div>
              <div className="char-name">{c.name}</div>
              {!isUnlocked && (
                <div className="char-lock">
                  {c.unlock}
                  {CURRENCY_ICON}
                </div>
              )}
            </button>
          );
        })}
      </div>
      {hasLocked && (
        <div className="picker-hint tiny dim">
          🔒 Tap a locked blob to buy it with {CURRENCY_ICON} Marbles — earned the honest way, by outliving your friends.
        </div>
      )}
      <style jsx>{`
        .char-strip {
          display: flex;
          gap: 10px;
          overflow-x: auto;
          padding: 8px 4px 12px;
          max-width: 100%;
        }
        .char-cell {
          flex: 0 0 auto;
          width: 112px;
          background: rgba(0, 0, 0, 0.25);
          border: 2px solid var(--line);
          border-radius: 16px;
          padding: 8px 6px 8px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          transition: transform 0.1s, border-color 0.1s;
          color: var(--ink);
          cursor: pointer;
        }
        .char-cell:hover {
          transform: translateY(-3px);
        }
        .char-cell.sel {
          border-color: var(--pink);
          background: rgba(255, 79, 154, 0.16);
          box-shadow: 0 0 0 2px rgba(255, 79, 154, 0.3);
        }
        .char-cell.locked {
          border-style: dashed;
        }
        .char-cell.locked:hover {
          border-color: var(--yellow);
        }
        .av {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .lock-glyph {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.3rem;
          filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.7));
          pointer-events: none;
        }
        .char-name {
          font-family: var(--font-display);
          font-size: 0.82rem;
          font-weight: 700;
          text-align: center;
          line-height: 1.12;
          width: 100%;
          /* wrap two-word names onto a second row; only break a single long
             word as a last resort so nothing spills outside the tile */
          overflow-wrap: break-word;
          hyphens: none;
          min-height: 2.45em;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .char-lock {
          font-size: 0.64rem;
          font-weight: 700;
          color: var(--yellow);
          background: var(--bg-2);
          border: 1px solid var(--yellow);
          border-radius: 8px;
          padding: 1px 7px;
          white-space: nowrap;
        }
        .picker-hint {
          margin: 2px 4px 0;
          line-height: 1.3;
        }
      `}</style>
    </div>
  );
}
