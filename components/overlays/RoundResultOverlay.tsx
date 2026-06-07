"use client";
import { useEffect } from "react";
import { useGame } from "@/lib/client/net";
import { audio } from "@/lib/client/audio";
import { GAMES } from "@/lib/shared/games";
import { CURRENCY_ICON } from "@/lib/shared/constants";
import { formatPlayerNumber } from "@/lib/shared/util";
import { characterVariants } from "@/lib/shared/characters";
import { BlobAvatar } from "../BlobAvatar";
import { GameIcon } from "../GameIcon";

export function RoundResultOverlay() {
  const room = useGame((s) => s.room)!;
  const youId = useGame((s) => s.youId);
  const result = room.lastResult;

  useEffect(() => {
    if (!result) return;
    const mine = result.entries.find((e) => e.playerId === youId);
    if (mine) audio.sfx(mine.survived ? "win" : "death");
  }, [result, youId]);

  if (!result) return null;
  const g = GAMES[result.game];
  const byId = new Map(room.players.map((p) => [p.id, p]));
  const variants = characterVariants(room.players);

  return (
    <div className="rr">
      <div className="rr-head">
        <GameIcon id={result.game} style={{ fontSize: "2rem" }} />
        <h2><span className="title-font">{g.name}</span> — The Reckoning</h2>
      </div>
      <div className="rr-list scroll">
        {result.entries.map((e) => {
          const p = byId.get(e.playerId);
          if (!p) return null;
          return (
            <div key={e.playerId} className={`rr-row ${e.playerId === youId ? "me" : ""} ${e.survived ? "alive" : "dead"}`}>
              <span className="place">#{e.placement}</span>
              <BlobAvatar characterId={p.characterId} size={42} anim={e.survived ? "cheer" : "dead"} variant={variants.get(p.id) ?? 0} />
              <span className="rnum" title="Player number">{formatPlayerNumber(p.number)}</span>
              <span className="rname">
                {p.name}
                {p.isBot && <span className="bt">BOT</span>}
              </span>
              <span className="note dim tiny">{e.note || (e.survived ? "Lived to suffer again" : "")}</span>
              <span className="spacer" />
              <span className="marb marbles">
                +{e.marbles} {CURRENCY_ICON}
              </span>
              <span className={`badge ${e.survived ? "ok" : "ko"}`}>{e.survived ? "✓ SAFE" : "💀 OUT"}</span>
            </div>
          );
        })}
      </div>
      <div className="rr-foot dim">The Game Master tallies the survivors and orders more ribbon… next trial incoming.</div>
      <style jsx>{`
        .rr {
          position: absolute;
          inset: 0;
          background: rgba(8, 4, 18, 0.86);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 14px;
          z-index: 20;
          padding: 20px;
        }
        .rr-head {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .rr-list {
          width: min(640px, 94vw);
          max-height: 58vh;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .rr-row {
          display: flex;
          align-items: center;
          gap: 10px;
          background: rgba(255, 255, 255, 0.05);
          border: 2px solid var(--line);
          border-radius: 14px;
          padding: 6px 12px;
          animation: rise 0.3s ease both;
        }
        .rr-row.me {
          border-color: var(--yellow);
        }
        .rr-row.dead {
          opacity: 0.65;
        }
        .place {
          font-family: var(--font-display);
          font-weight: 700;
          width: 34px;
          color: var(--ink-dim);
        }
        .rnum {
          font-family: var(--font-display);
          font-weight: 800;
          font-size: 0.7rem;
          letter-spacing: 1px;
          color: #16201d;
          background: rgba(245, 247, 244, 0.92);
          border-radius: 6px;
          padding: 1px 6px;
        }
        .rname {
          font-family: var(--font-display);
          font-weight: 700;
        }
        .bt {
          font-size: 0.55rem;
          background: var(--accent);
          border-radius: 5px;
          padding: 1px 4px;
          margin-left: 4px;
          vertical-align: middle;
        }
        .badge {
          font-weight: 800;
          font-size: 0.8rem;
          padding: 3px 8px;
          border-radius: 8px;
        }
        .badge.ok {
          background: rgba(105, 240, 174, 0.2);
          color: var(--green);
        }
        .badge.ko {
          background: rgba(255, 82, 82, 0.2);
          color: var(--red);
        }
        .marb {
          font-size: 0.85rem;
        }
      `}</style>
    </div>
  );
}
