import Link from "next/link";
import { leaderboard } from "@/lib/server/db";
import { CURRENCY, CURRENCY_ICON } from "@/lib/shared/constants";
import { AuthEntry } from "@/components/AuthEntry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  let rows: Awaited<ReturnType<typeof leaderboard>> = [];
  try {
    rows = await leaderboard(50);
  } catch {
    rows = [];
  }

  return (
    <div className="page">
      <div className="container" style={{ paddingTop: 24, paddingBottom: 40 }}>
        <div className="row" style={{ marginBottom: 18 }}>
          <Link className="btn ghost sm" href="/">
            ← Home
          </Link>
          <div className="spacer" />
          <Link className="pill" href="/how-to-play">
            ❔ How to Play
          </Link>
          <AuthEntry variant="save" label="💾 Save Your Spot" />
        </div>

        <h1 className="shadowtext" style={{ fontSize: "2.6rem" }}>
          🏆 Wall of Survivors
        </h1>
        <p className="dim" style={{ marginBottom: 18 }}>
          The richest, most ruthless survivors — ranked by total {CURRENCY} {CURRENCY_ICON} hoarded off the backs of the
          fallen. The fallen are not ranked. The fallen are compost.
        </p>

        <div className="panel" style={{ padding: 18 }}>
          {rows.length === 0 ? (
            <div className="dim" style={{ padding: 30, textAlign: "center" }}>
              No champions yet. The board is as empty as the organizers' consciences. Be the first to survive!
            </div>
          ) : (
            <div className="lb">
              <div className="lb-row head">
                <span className="r">#</span>
                <span className="n">Blob</span>
                <span className="t">Title</span>
                <span className="w">Crowns</span>
                <span className="g">Games</span>
                <span className="m">{CURRENCY}</span>
              </div>
              {rows.map((r, i) => (
                <div key={i} className={`lb-row ${i < 3 ? "top" : ""}`}>
                  <span className="r">{["🥇", "🥈", "🥉"][i] || i + 1}</span>
                  <span className="n">{r.name}</span>
                  <span className="t dim">{r.bestTitle}</span>
                  <span className="w">{r.wins}</span>
                  <span className="g">{r.gamesPlayed}</span>
                  <span className="m marbles">
                    {r.marbles} {CURRENCY_ICON}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .lb { display: flex; flex-direction: column; gap: 4px; }
        .lb-row {
          display: grid;
          grid-template-columns: 50px 1.6fr 1.6fr 90px 80px 120px;
          align-items: center;
          padding: 10px 12px;
          border-radius: 12px;
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--line);
          font-weight: 700;
        }
        .lb-row.head {
          background: transparent;
          border: none;
          color: var(--ink-dim);
          font-size: 0.78rem;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .lb-row.top { border-color: var(--line-bright); background: rgba(255,79,154,0.08); }
        .lb-row .r { font-size: 1.1rem; }
        .lb-row .n { font-family: var(--font-display); }
        .lb-row .m { text-align: right; }
        @media (max-width: 640px) {
          .lb-row { grid-template-columns: 40px 1.4fr 70px 110px; }
          .lb-row .t, .lb-row .g, .head .t, .head .g { display: none; }
        }
      `}</style>
    </div>
  );
}
