"use client";
import { useMemo, useState } from "react";
import { useGame, net } from "@/lib/client/net";
import { betMultiplier, clampStake, MIN_STAKE } from "@/lib/shared/betting";
import { CURRENCY_ICON } from "@/lib/shared/constants";
import { characterVariants } from "@/lib/shared/characters";
import { formatPlayerNumber } from "@/lib/shared/util";
import { BlobAvatar } from "./BlobAvatar";
import { audio } from "@/lib/client/audio";

// Shown to an eliminated Hardcore spectator while a round plays out: wager your
// hard-won series Marbles on who'll be the last blob standing. Odds scale with
// the field — call it while the crowd's big and it pays big. Settled at series end.
export function DeadPool() {
  const room = useGame((s) => s.room);
  const youId = useGame((s) => s.youId);
  const [target, setTarget] = useState<string | null>(null);
  const [stake, setStake] = useState(0); // 0 = use the suggested default

  const me = room?.players.find((p) => p.id === youId);
  const contenders = useMemo(() => (room?.players ?? []).filter((p) => p.alive), [room?.players]);
  const variants = useMemo(() => characterVariants(room?.players ?? []), [room?.players]);

  const earnings = me?.marblesEarned ?? 0;
  const myBet = me?.bet;
  const mult = betMultiplier(contenders.length);
  const suggested = Math.min(earnings, Math.max(MIN_STAKE, 50));
  const stakeVal = stake > 0 ? clampStake(stake, earnings) : suggested;
  const canBet = contenders.length >= 2 && earnings >= MIN_STAKE;

  const nameOf = (id: string) => room?.players.find((p) => p.id === id)?.name ?? "someone";

  function quick(frac: number) {
    setStake(Math.max(MIN_STAKE, Math.floor(earnings * frac)));
  }
  function confirm() {
    if (!target) return;
    const s = clampStake(stakeVal, earnings);
    if (s < MIN_STAKE) return;
    net.placeBet(target, s);
    audio.sfx("drum");
    setTarget(null);
    setStake(0);
  }
  function pull() {
    net.cancelBet();
    audio.sfx("blip");
  }

  return (
    <div className="deadpool">
      <div className="dp-head">
        <span className="dp-title">☠️ The Dead Pool</span>
        <span className="dp-bank">
          your purse: <strong>{earnings}</strong> {CURRENCY_ICON}
        </span>
      </div>

      {myBet && (
        <div className="dp-current">
          🎟️ Backing <strong>{nameOf(myBet.targetId)}</strong> · {myBet.stake} {CURRENCY_ICON} @{" "}
          {betMultiplier(myBet.oddsAlive)}× → pays{" "}
          <strong>{myBet.stake * betMultiplier(myBet.oddsAlive)} {CURRENCY_ICON}</strong> if they win
          <button className="dp-pull" onClick={pull}>
            pull
          </button>
        </div>
      )}

      {!canBet ? (
        <div className="dp-none">
          {contenders.length < 2
            ? "The winner's all but decided — no bets left to make. Enjoy the carnage."
            : `Earn at least ${MIN_STAKE} ${CURRENCY_ICON} alive before you can gamble it dead.`}
        </div>
      ) : (
        <>
          <div className="dp-sub">
            Pick who takes it all — {contenders.length} left, so a correct call pays{" "}
            <strong>{mult}×</strong>.
          </div>
          <div className="dp-contenders">
            {contenders.map((p) => (
              <button
                key={p.id}
                className={`dp-cont ${target === p.id ? "sel" : ""}`}
                onClick={() => {
                  audio.sfx("blip");
                  setTarget(p.id);
                }}
              >
                <BlobAvatar characterId={p.characterId} size={40} variant={variants.get(p.id) ?? 0} accessories={p.accessories} />
                <span className="dp-cn">{p.name}</span>
                <span className="dp-num">{formatPlayerNumber(p.number)}</span>
              </button>
            ))}
          </div>

          <div className="dp-stake">
            <span className="dp-stake-lbl">Wager</span>
            <button onClick={() => quick(0.25)}>¼</button>
            <button onClick={() => quick(0.5)}>½</button>
            <button onClick={() => quick(1)}>MAX</button>
            <span className="dp-stake-val">
              {stakeVal} {CURRENCY_ICON}
            </span>
          </div>

          <button className="dp-confirm" disabled={!target || stakeVal < MIN_STAKE} onClick={confirm}>
            {target
              ? `🎲 Wager ${stakeVal} ${CURRENCY_ICON} on ${nameOf(target)} → win ${stakeVal * mult} ${CURRENCY_ICON}`
              : "Pick a blob to back"}
          </button>
        </>
      )}

      <style jsx>{`
        .deadpool {
          position: absolute;
          bottom: 12px;
          left: 12px;
          width: min(380px, 92vw);
          background: rgba(8, 4, 14, 0.82);
          border: 2px solid var(--red);
          border-radius: 16px;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          backdrop-filter: blur(8px);
          pointer-events: auto;
          z-index: 20;
          max-height: 60vh;
          overflow-y: auto;
        }
        .dp-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
        }
        .dp-title {
          font-family: var(--font-display);
          font-weight: 800;
          font-size: 1.1rem;
          color: #ff8fb3;
        }
        .dp-bank {
          font-size: 0.78rem;
          color: var(--ink-dim);
        }
        .dp-bank strong {
          color: var(--yellow);
        }
        .dp-current {
          font-size: 0.8rem;
          background: rgba(255, 213, 79, 0.1);
          border: 1px solid rgba(255, 213, 79, 0.4);
          border-radius: 10px;
          padding: 6px 10px;
          line-height: 1.4;
        }
        .dp-pull {
          margin-left: 8px;
          font-size: 0.7rem;
          font-weight: 800;
          color: var(--red);
          background: rgba(255, 82, 82, 0.16);
          border: 1px solid var(--red);
          border-radius: 8px;
          padding: 1px 8px;
        }
        .dp-sub {
          font-size: 0.8rem;
          color: var(--ink-dim);
          line-height: 1.35;
        }
        .dp-sub strong {
          color: var(--teal);
        }
        .dp-none {
          font-size: 0.82rem;
          color: var(--ink-dim);
          line-height: 1.4;
        }
        .dp-contenders {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .dp-cont {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1px;
          width: 74px;
          padding: 5px 3px;
          background: rgba(255, 255, 255, 0.05);
          border: 2px solid var(--line);
          border-radius: 12px;
          color: var(--ink);
        }
        .dp-cont.sel {
          border-color: var(--yellow);
          background: rgba(255, 213, 79, 0.16);
        }
        .dp-cont:active {
          transform: translateY(2px);
        }
        .dp-cn {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 0.68rem;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .dp-num {
          font-size: 0.56rem;
          letter-spacing: 1px;
          color: var(--ink-dim);
        }
        .dp-stake {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .dp-stake-lbl {
          font-size: 0.72rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--ink-dim);
        }
        .dp-stake button {
          font-family: var(--font-display);
          font-weight: 800;
          font-size: 0.85rem;
          color: var(--ink);
          background: rgba(0, 0, 0, 0.3);
          border: 2px solid var(--line);
          border-radius: 10px;
          padding: 3px 12px;
        }
        .dp-stake button:active {
          transform: translateY(2px);
        }
        .dp-stake-val {
          margin-left: auto;
          font-family: var(--font-display);
          font-weight: 800;
          color: var(--yellow);
        }
        .dp-confirm {
          font-family: var(--font-display);
          font-weight: 800;
          font-size: 0.92rem;
          color: #06241f;
          background: radial-gradient(circle at 30% 25%, #aef5b5, #2bb84d);
          border: none;
          border-radius: 12px;
          padding: 9px 12px;
          box-shadow: 0 5px 0 #157a2e;
        }
        .dp-confirm:disabled {
          filter: grayscale(0.7) brightness(0.8);
          box-shadow: 0 5px 0 #3a3a3a;
        }
        .dp-confirm:active:not(:disabled) {
          transform: translateY(4px);
          box-shadow: 0 1px 0 #157a2e;
        }
      `}</style>
    </div>
  );
}
