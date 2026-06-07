import Link from "next/link";
import { HowToGames } from "@/components/HowToGames";
import { ALL_GAME_IDS } from "@/lib/shared/games";
import { MAPS } from "@/lib/shared/maps";
import { CURRENCY, CURRENCY_ICON } from "@/lib/shared/constants";
import { POWERUPS, ALL_POWERUPS } from "@/lib/shared/powerups";
import { ACCESSORIES, ACCESSORY_SLOTS } from "@/lib/shared/accessories";

const SLOT_NAME: Record<string, string> = {
  head: "🎩 Hats",
  eyes: "🕶️ Eyewear",
  neck: "🧣 Neckwear",
  ear: "🌸 Behind the Ear",
};

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
          <h3>🎟️ Getting Started (it's the last easy part)</h3>
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
          <p className="dim tiny" style={{ marginTop: -4, marginBottom: 12 }}>
            Tap any game to read its rules and exact controls — the previews are live bot matches, not videos.
          </p>
          <HowToGames />
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
            The movement games scatter glowing orbs — and every one is an identical, unmarked <strong>❓ mystery</strong>.
            You won't know if it's a blessing or a curse until you grab it. Roughly half want you dead. Greed is a
            personality trait that gets blobs killed. Here's the full menu of what could be inside:
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
            The last round is always a <strong>decisive finale</strong> — a game that can crown a single survivor.
            Sometimes it's <strong>King of Lava Island</strong> (the floor turns to lava, the islands sink, last blob
            not-on-fire wins 🌋), but it might just as easily be a one-blob-left brawl, a final jump-rope, a
            sudden-death Simon Says, or a rock-paper-scissors bracket. Whatever it is, exactly one blob walks away.
          </p>
        </div>

        <div className="panel htp-section">
          <h3>🪙 {CURRENCY} & Bragging Rights</h3>
          <p className="dim tiny">
            Survive rounds to earn {CURRENCY} {CURRENCY_ICON} — the only thing here that outlives the players. Win the
            series for a fat champion bonus and a shiny <strong>title</strong> to lord over the deceased. Spend your
            hoard on fancier blobs and accessories (it does not improve your odds, only the optics of your demise).
            Totals are saved and ranked forever on the <Link href="/leaderboard">Wall of Survivors</Link>.
          </p>
        </div>

        <div className="panel htp-section">
          <h3>👒 Dress to Die (Accessories)</h3>
          <p className="dim tiny">
            Blow your {CURRENCY} {CURRENCY_ICON} on cosmetics that ride over <em>any</em> blob — bought in the lobby
            under <strong>“Dress your blob.”</strong> You can wear <strong>one item per slot at once</strong>, so a hat,
            shades, a bandana and a little something behind the ear all stack into one magnificent ensemble that
            everyone sees in every game. It is purely decorative. You will look fantastic and die anyway.
          </p>
          <div className="htp-games">
            {ACCESSORY_SLOTS.map((slot) => (
              <div key={slot} className="card">
                <strong style={{ fontFamily: "var(--font-display)" }}>{SLOT_NAME[slot]}</strong>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.5 }}>
                  {ACCESSORIES.filter((a) => a.slot === slot).map((a) => (
                    <li key={a.id} className="tiny">
                      <strong>{a.name}</strong> — {a.price} {CURRENCY_ICON}
                      <span className="dim"> · {a.catchphrase}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="panel htp-section">
          <h3>☠️ The Dead Pool (Hardcore betting)</h3>
          <p className="dim tiny">
            Eliminated in Hardcore? Death is no longer a spectator sport. While the survivors fight it out, open the{" "}
            <strong>Dead Pool</strong> and wager the {CURRENCY} {CURRENCY_ICON} you earned <em>this run</em> on who'll be
            the last blob standing — so you keep earning from beyond the grave.
          </p>
          <ul className="dim tiny" style={{ margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.6 }}>
            <li>
              <strong>Odds scale with the field.</strong> Call the winner while five blobs remain and it pays{" "}
              <strong>5×</strong>; hold out for the 1v1 final and it's even money. Bold early calls pay the most — and
              risk the most.
            </li>
            <li>
              <strong>Your horse can die.</strong> If your pick gets boxed up, you're warned to re-bet before the finale.
              Ignore it and your wager dies with them.
            </li>
            <li>
              <strong>Settled at the crowning.</strong> Win and the payout lands on your series total; lose and the stake
              is gone. Either way, the leaderboard remembers.
            </li>
            <li>It's Hardcore-only — Casual blobs respawn, so there's no afterlife to bet from.</li>
          </ul>
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
      `}</style>
    </div>
  );
}
