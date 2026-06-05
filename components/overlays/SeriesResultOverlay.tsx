"use client";
import { useEffect } from "react";
import { useGame, net } from "@/lib/client/net";
import { audio } from "@/lib/client/audio";
import { CURRENCY, CURRENCY_ICON } from "@/lib/shared/constants";
import { formatPlayerNumber } from "@/lib/shared/util";
import { BlobAvatar } from "../BlobAvatar";
import { AuthEntry } from "../AuthEntry";

const CONFETTI = Array.from({ length: 60 });

export function SeriesResultOverlay() {
  const room = useGame((s) => s.room)!;
  const youId = useGame((s) => s.youId);
  const result = room.seriesResult;
  const isHost = youId === room.hostId;

  useEffect(() => {
    audio.sfx("win");
    audio.startMusic?.();
    return () => audio.stopMusic?.();
  }, []);

  if (!result) return null;
  const podium = result.standings.slice(0, 3);
  const order = [1, 0, 2]; // visual: 2nd, 1st, 3rd
  const me = result.standings.find((s) => s.playerId === youId);

  return (
    <div className="sr">
      <div className="confetti" aria-hidden>
        {CONFETTI.map((_, i) => (
          <span
            key={i}
            style={{
              left: `${(i * 37) % 100}%`,
              animationDelay: `${(i % 10) * 0.25}s`,
              background: ["#ff2e88", "#ffce3a", "#19d3bd", "#2bb39a", "#4cd9a0"][i % 5],
            }}
          />
        ))}
      </div>

      <div className="champ">👑 CHAMPION 👑</div>
      <div className="podium">
        {order.map((idx) => {
          const s = podium[idx];
          if (!s) return <div key={idx} className="slot empty" />;
          const heights = [150, 110, 86];
          const rank = s.placement;
          return (
            <div key={s.playerId} className={`slot rank${rank} ${s.playerId === youId ? "me" : ""}`}>
              <div className="pblob">
                <BlobAvatar characterId={s.characterId} size={rank === 1 ? 96 : 72} animate anim="cheer" />
              </div>
              <div className="pname">{s.name}</div>
              <div className="ptitle">{s.title}</div>
              <div className="pillar" style={{ height: heights[rank - 1] }}>
                <span className="medal">{["🥇", "🥈", "🥉"][rank - 1]}</span>
                <span className="pmar marbles">
                  {s.marbles} {CURRENCY_ICON}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {me && (
        <div className="youline">
          You finished <strong>#{me.placement}</strong> — “{me.title}” · earned{" "}
          <span className="marbles">
            {me.marbles} {CURRENCY_ICON}
          </span>
        </div>
      )}

      <details className="full">
        <summary>Full standings ({result.standings.length})</summary>
        <div className="scroll fulllist">
          {result.standings.map((s) => (
            <div key={s.playerId} className={`frow ${s.playerId === youId ? "me" : ""}`}>
              <span className="fplace">#{s.placement}</span>
              <BlobAvatar characterId={s.characterId} size={30} />
              <span className="fnum" title="Player number">{formatPlayerNumber(s.number)}</span>
              <span className="fname">
                {s.name}
                {s.isBot && <span className="bt">BOT</span>}
              </span>
              <span className="spacer" />
              <span className="ftitle dim tiny">{s.title}</span>
              <span className="marbles">
                {s.marbles} {CURRENCY_ICON}
              </span>
            </div>
          ))}
        </div>
      </details>

      {me && me.marbles > 0 && (
        <AuthEntry variant="save" label={`💾 Save your ${me.marbles} ${CURRENCY}`} />
      )}

      <div className="actions">
        {isHost ? (
          <button className="btn pink big" onClick={() => (audio.sfx("good"), net.returnToLobby())}>
            ↺ Round Up More Volunteers
          </button>
        ) : (
          <div className="dim">The organizers are mopping up. Back to the lobby shortly…</div>
        )}
        <button className="btn ghost" onClick={() => net.leaveRoom()}>
          Cash Out &amp; Leave
        </button>
      </div>

      <style jsx>{`
        .sr {
          position: absolute;
          inset: 0;
          background: radial-gradient(900px 700px at 50% 10%, rgba(255, 79, 154, 0.25), transparent), rgba(8, 4, 18, 0.94);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 14px;
          z-index: 25;
          padding: 20px;
          overflow: hidden;
        }
        .champ {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 1.8rem;
          color: var(--yellow);
          letter-spacing: 2px;
          animation: pop 0.4s ease both;
        }
        .podium {
          display: flex;
          align-items: flex-end;
          gap: 18px;
        }
        .slot {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          width: 130px;
        }
        .slot.empty {
          opacity: 0;
        }
        .pname {
          font-family: var(--font-display);
          font-weight: 700;
        }
        .slot.rank1 .pname {
          color: var(--yellow);
          font-size: 1.2rem;
        }
        .ptitle {
          font-size: 0.72rem;
          color: var(--ink-dim);
          text-align: center;
          min-height: 18px;
        }
        .pillar {
          width: 100%;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.05));
          border: 2px solid var(--line);
          border-bottom: none;
          border-radius: 12px 12px 0 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          padding-top: 8px;
          gap: 2px;
        }
        .slot.me .pillar {
          border-color: var(--yellow);
        }
        .medal {
          font-size: 1.6rem;
        }
        .pmar {
          font-size: 0.85rem;
        }
        .youline {
          font-family: var(--font-display);
          font-weight: 700;
        }
        .full {
          width: min(560px, 94vw);
        }
        .full summary {
          cursor: pointer;
          color: var(--teal);
          font-family: var(--font-display);
          text-align: center;
        }
        .fulllist {
          max-height: 30vh;
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-top: 8px;
        }
        .frow {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--line);
          border-radius: 10px;
          padding: 4px 10px;
        }
        .frow.me {
          border-color: var(--yellow);
        }
        .fplace {
          width: 30px;
          font-weight: 700;
          color: var(--ink-dim);
        }
        .fnum {
          font-family: var(--font-display);
          font-weight: 800;
          font-size: 0.66rem;
          letter-spacing: 1px;
          color: #16201d;
          background: rgba(245, 247, 244, 0.92);
          border-radius: 6px;
          padding: 1px 5px;
        }
        .fname {
          font-weight: 700;
          font-family: var(--font-display);
        }
        .bt {
          font-size: 0.55rem;
          background: var(--accent);
          border-radius: 5px;
          padding: 1px 4px;
          margin-left: 4px;
        }
        .actions {
          display: flex;
          gap: 12px;
          align-items: center;
          margin-top: 6px;
        }
        .confetti {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
        }
        .confetti span {
          position: absolute;
          top: -10px;
          width: 10px;
          height: 16px;
          border-radius: 2px;
          animation: fall 3.5s linear infinite;
        }
        @keyframes fall {
          to {
            transform: translateY(110vh) rotate(540deg);
          }
        }
      `}</style>
    </div>
  );
}
