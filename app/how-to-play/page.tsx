import Link from "next/link";
import { GamePreview } from "@/components/GamePreview";
import { GAMES, ALL_GAME_IDS } from "@/lib/shared/games";
import { MAPS } from "@/lib/shared/maps";
import { CURRENCY, CURRENCY_ICON } from "@/lib/shared/constants";
import { POWERUPS, ALL_POWERUPS } from "@/lib/shared/powerups";

export const metadata = { title: "How to Play — Eliminated" };

export default function HowToPlay() {
  return (
    <div className="page">
      <div className="container" style={{ paddingTop: 24, paddingBottom: 50, maxWidth: 880 }}>
        <div className="row" style={{ marginBottom: 18 }}>
          <Link className="btn ghost sm" href="/">
            ← Home
          </Link>
          <div className="spacer" />
          <Link className="pill" href="/leaderboard">
            🏆 Leaderboard
          </Link>
        </div>

        <h1 className="shadowtext" style={{ fontSize: "2.6rem", marginBottom: 2 }}>
          ❔ How to Play
        </h1>
        <div
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.95rem",
            fontWeight: 600,
            color: "var(--ink-dim)",
            marginBottom: 12,
          }}
        >
          …and, statistically, how to die.
        </div>
        <p className="dim">
          <strong>Eliminated</strong> is a friendly party game for 2–8 blobs, in the sense that you arrive with friends
          and leave with fewer. The Game Master runs a <em>mystery</em> gauntlet of beloved childhood games, each
          retrofitted with a body count. The goal is brutally simple: <strong>outlast everyone</strong>. Survive a game
          and you move on to the next; lose one and your blob is sealed into a tasteful pink-ribboned box while the
          crowd claps anyway. The last blob standing keeps the {CURRENCY} {CURRENCY_ICON} and the bragging rights —
          everyone else keeps the box.
        </p>

        <div className="panel htp-section">
          <h3>🎪 Getting Started (it's the last easy part)</h3>
          <ol>
            <li>Pick a name and a blob on the home screen. Get attached. It's funnier that way.</li>
            <li>
              <strong>Host the Games</strong> and share the 4-letter code, or <strong>Join</strong> a friend's code and
              their poor decisions.
            </li>
            <li>The host sets the rules. Short on friends, or out of friends? Flip on <strong>bot-fill</strong> and the
              lobby packs with AI blobs who feel nothing.</li>
            <li>Host hits <strong>Start the Gauntlet</strong> and graciously hands control to the Game Master, who has
              never lost sleep.</li>
          </ol>
        </div>

        <div className="panel htp-section">
          <h3>💀 Death Rules</h3>
          <div className="row wrap" style={{ gap: 14 }}>
            <div className="card" style={{ flex: 1, minWidth: 260 }}>
              <strong>Hardcore</strong>
              <p className="dim tiny">
                Get eliminated and your blob is <em>dead for the entire series</em> — you spectate the rest from the
                comfort of the afterlife. Last blob standing is crowned champion. No respawns, no take-backs, no HR.
              </p>
            </div>
            <div className="card" style={{ flex: 1, minWidth: 260 }}>
              <strong>Casual</strong>
              <p className="dim tiny">
                Eliminations only cost you the round — everyone respawns for the next game, briefly forgetting the
                horror. Rack up the most points across the gauntlet to win. The therapy bill is the same.
              </p>
            </div>
          </div>
          <p className="dim tiny" style={{ marginTop: 10 }}>
            The number of games can be a fixed count… or a <strong>Mystery</strong> the Game Master refuses to disclose
            until it's far too late to back out. 😈
          </p>
        </div>

        <div className="panel htp-section">
          <h3>🕹️ The Games ({ALL_GAME_IDS.length})</h3>
          <div className="htp-games">
            {ALL_GAME_IDS.map((id) => {
              const g = GAMES[id];
              return (
                <div key={id} className="card htp-game">
                  <div className="row" style={{ gap: 10 }}>
                    <span style={{ fontSize: "2rem" }}>{g.icon}</span>
                    <strong style={{ fontFamily: "var(--font-game)", fontSize: "1rem", letterSpacing: 0 }}>{g.name}</strong>
                  </div>
                  <GamePreview gameId={id} />
                  <p className="tiny" style={{ margin: "6px 0" }}>{g.rules}</p>
                  <p className="tiny dim" style={{ margin: 0 }}>
                    🎮 {g.controlText}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel htp-section">
          <h3>🗺️ Arenas</h3>
          <p className="dim tiny">Every round is staged in one of {MAPS.length} lovingly themed arenas, picked at random,
            because a little ambiance softens the carnage:</p>
          <div className="row wrap" style={{ gap: 8 }}>
            {MAPS.map((m) => (
              <span key={m.id} className="pill" style={{ borderColor: m.accent }}>
                {m.name}
              </span>
            ))}
          </div>
        </div>

        <div className="panel htp-section">
          <h3>✨ Powerups</h3>
          <p className="dim tiny">
            The movement games scatter glowing orbs, and roughly half of them want you dead. Snatch the good ones,
            avoid the rest, and accept that greed is a personality trait that gets blobs killed. 🔴 red glow = regret.
          </p>
          <div className="htp-games">
            {ALL_POWERUPS.map((k) => {
              const p = POWERUPS[k];
              return (
                <div key={k} className="card" style={{ borderColor: p.good ? undefined : "var(--red)" }}>
                  <strong style={{ fontFamily: "var(--font-display)" }}>
                    {p.icon} {p.label} {p.good ? "✅" : "⚠️"}
                  </strong>
                  <p className="tiny dim" style={{ margin: "4px 0 0" }}>{p.blurb}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel htp-section">
          <h3>🌙 Night Mode &amp; 🏁 The Finale</h3>
          <p className="dim tiny">
            <strong>Night Mode</strong> (a Hardcore extra) drops random rounds into total darkness, so you can fail to
            see what kills you. You navigate by flashlight; grab a 🔦 <strong>Lantern</strong> powerup to extend the
            view, and your suffering.
          </p>
          <p className="dim tiny">
            The Game Master always saves <strong>King of Lava Island</strong> for the grand finale: the floor turns to
            lava, the island shrinks, and the last blob standing is crowned champion of a puddle. 🌋
          </p>
        </div>

        <div className="panel htp-section">
          <h3>🪙 {CURRENCY} & Bragging Rights</h3>
          <p className="dim tiny">
            Survive rounds to earn {CURRENCY} {CURRENCY_ICON} — the only thing here that outlives the players. Win the
            series for a fat champion bonus and a shiny <strong>title</strong> to lord over the deceased. Spend your
            hoard on fancier blobs (it does not improve your odds, only the optics of your demise). Totals are saved and
            ranked forever on the <Link href="/leaderboard">Hall of Blobs</Link>.
          </p>
        </div>

        <div style={{ textAlign: "center", marginTop: 24 }}>
          <Link
            className="btn pink big"
            href="/"
            style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", lineHeight: 1.15, gap: 2 }}
          >
            <span>← Back to the Arena</span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: "0.72rem", fontWeight: 600, opacity: 0.85 }}>
              it's not going anywhere; neither are you
            </span>
          </Link>
        </div>
      </div>

      <style>{`
        .htp-section { padding: 20px; margin-top: 16px; }
        .htp-section h3 { margin-bottom: 10px; }
        .htp-section ol { margin: 0; padding-left: 20px; line-height: 1.7; }
        .htp-games { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
        .htp-game { display: flex; flex-direction: column; }
        .htp-preview { position: relative; margin: 8px 0 2px; }
        .htp-preview canvas {
          width: 100%;
          aspect-ratio: 16 / 9;
          display: block;
          border-radius: 12px;
          border: 2px solid var(--line);
          background: radial-gradient(circle at 50% 38%, #1a1030, #0b0713);
        }
        .htp-preview-badge {
          position: absolute;
          top: 6px;
          right: 6px;
          font-family: var(--font-body);
          font-size: 0.6rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          color: #fff;
          background: rgba(0, 0, 0, 0.55);
          border: 1px solid var(--line-bright);
          border-radius: 999px;
          padding: 2px 8px;
          pointer-events: none;
          backdrop-filter: blur(4px);
        }
        .htp-preview--soon {
          aspect-ratio: 16 / 9;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 0 16px;
          border-radius: 12px;
          border: 2px dashed var(--line);
          background: radial-gradient(circle at 50% 38%, #1a1030, #0b0713);
          color: var(--ink-dim);
          font-family: var(--font-body);
          font-size: 0.74rem;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}
