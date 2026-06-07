"use client";
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useGame, net } from "@/lib/client/net";
import { audio } from "@/lib/client/audio";
import { CURRENCY, CURRENCY_ICON } from "@/lib/shared/constants";
import { CHARACTERS } from "@/lib/shared/characters";
import { GAMES, ALL_GAME_IDS } from "@/lib/shared/games";
import { CharacterPicker } from "./CharacterPicker";
import { AccessoryPicker } from "./AccessoryPicker";
import { BlobAvatar } from "./BlobAvatar";
import { GamePreview } from "./GamePreview";
import { GameIcon } from "./GameIcon";
import { ControlsReveal } from "./ControlsReveal";
import { MuteButton } from "./MuteButton";
import { FeedbackButton } from "./FeedbackButton";

// Client-only: better-auth's authClient.useSession() isn't SSR-safe (it crashes
// resolving useRef during server render), and the account UI is pure interactive
// chrome that gains nothing from SSR. Rendering it client-side sidesteps the
// crash with zero functional change.
const AccountButton = dynamic(() => import("./AccountButton").then((m) => m.AccountButton), {
  ssr: false,
});

type Floater = { key: string; id: string; left: number; top: number; size: number; delay: number; dur: number };

export function Landing() {
  const name = useGame((s) => s.name);
  const characterId = useGame((s) => s.characterId);
  const accessories = useGame((s) => s.accessories);
  const profile = useGame((s) => s.profile);
  const status = useGame((s) => s.status);
  const [localName, setLocalName] = useState(name);
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"menu" | "join">("menu");
  const [shopTab, setShopTab] = useState<"blob" | "acc">("blob");
  const [floaters, setFloaters] = useState<Floater[]>([]);

  useEffect(() => setLocalName(name), [name]);

  // Scatter a fresh, random cast of background blobs on each load. Built
  // client-side (decorative) so there's no SSR hydration mismatch.
  useEffect(() => {
    const pool = [...CHARACTERS];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const count = Math.min(14, pool.length);
    setFloaters(
      pool.slice(0, count).map((ch, i) => {
        // alternate sides and keep the middle column clear for the title/panel
        const edge = 1 + Math.random() * 26; // 1..27% in from the edge
        const left = i % 2 === 0 ? edge : 100 - edge - 6;
        const top = 1 + (i / count) * 88 + (Math.random() * 6 - 3);
        return {
          key: `${ch.id}-${i}`,
          id: ch.id,
          left,
          top,
          size: 42 + Math.round(Math.random() * 52), // 42..94px
          delay: +(Math.random() * 4).toFixed(2),
          dur: +(4.5 + Math.random() * 3).toFixed(2),
        };
      }),
    );
  }, []);

  function commitName(n: string) {
    const clean = n.slice(0, 16);
    setLocalName(clean);
    net.setName(clean || "Blob");
  }

  function create() {
    audio.sfx("good");
    net.setIdentity(localName || "Blob", characterId);
    net.createRoom();
  }
  function join() {
    if (code.trim().length < 3) return;
    audio.sfx("click");
    net.setIdentity(localName || "Blob", characterId);
    net.joinRoom(code.trim().toUpperCase());
  }

  return (
    <div className="page">
      <div className="hero-blobs" aria-hidden>
        {floaters.map((f) => (
          <div
            key={f.key}
            className="floaty"
            style={{ top: `${f.top}%`, left: `${f.left}%`, animationDelay: `${f.delay}s`, animationDuration: `${f.dur}s` }}
          >
            <BlobAvatar characterId={f.id} size={f.size} />
          </div>
        ))}
      </div>

      <div className="topbar container">
        <div className="row" style={{ gap: 10 }}>
          <svg className="logo-mark" viewBox="0 0 64 64" width="30" height="30" aria-hidden focusable="false">
            <path
              d="M32 9 C 18.5 9 9 19.5 9 32 C 9 41 11.5 48 15.5 52.5 C 19 56 22.5 53.2 26.5 54.2 C 29.7 55 34.3 55 37.5 54.2 C 41.5 53.2 45 56 48.5 52.5 C 52.5 48 55 41 55 32 C 55 19.5 45.5 9 32 9 Z"
              fill="var(--pink)"
            />
            <g stroke="var(--bg-0)" strokeWidth="3.6" strokeLinecap="round">
              <path d="M19 26 L27 34 M27 26 L19 34" />
              <path d="M37 26 L45 34 M45 26 L37 34" />
            </g>
            <ellipse cx="32" cy="45" rx="2.8" ry="3.2" fill="var(--bg-0)" />
          </svg>
          <strong style={{ fontFamily: "var(--font-title)", fontSize: "1.1rem", letterSpacing: "0.5px" }}>ELIMINATED</strong>
        </div>
        <div className="spacer" />
        <Link className="pill gold" href="/leaderboard">
          🏆 Leaderboard
        </Link>
        <Link className="pill" href="/how-to-play">
          ❔ How to Play
        </Link>
        <Link className="pill" href="/changelog">
          📓 Patch Notes
        </Link>
        <AccountButton />
        <MuteButton />
      </div>

      <div className="hero container">
        <div className="hero-main">
          <h1 className="title">
            <span className="wm">
              <span className="wm-text">ELIMINATED</span>
              <span className="period-blob" aria-hidden>
                <svg viewBox="0 0 64 64" focusable="false">
                  <path
                    d="M32 9 C 18.5 9 9 19.5 9 32 C 9 41 11.5 48 15.5 52.5 C 19 56 22.5 53.2 26.5 54.2 C 29.7 55 34.3 55 37.5 54.2 C 41.5 53.2 45 56 48.5 52.5 C 52.5 48 55 41 55 32 C 55 19.5 45.5 9 32 9 Z"
                    fill="var(--pink)"
                    stroke="var(--bg-0)"
                    strokeWidth="3.5"
                  />
                  <g stroke="var(--bg-0)" strokeWidth="4.2" strokeLinecap="round">
                    <path d="M19 26 L27 34 M27 26 L19 34" />
                    <path d="M37 26 L45 34 M45 26 L37 34" />
                  </g>
                  <ellipse cx="32" cy="45" rx="2.8" ry="3.2" fill="var(--bg-0)" />
                </svg>
              </span>
            </span>
          </h1>
          <p className="subtitle">
            Wholesome childhood games. <span style={{ color: "var(--red)" }}>Catastrophic</span> stakes. Adorable little blobs
            who, frankly, signed something they didn't read. Outlast the Game Master's mystery gauntlet and walk off with the{" "}
            <span style={{ color: "var(--yellow)" }}>{CURRENCY}</span>. Everyone else is processed, boxed, and ribboned at no extra charge.
          </p>

          <div className="panel setup pop">
            <div className="setup-grid">
              <div className="col" style={{ gap: 10 }}>
                <label className="tag">Your blob</label>
                <div className="row" style={{ gap: 14 }}>
                  <div className="card" style={{ padding: 10 }}>
                    <BlobAvatar characterId={characterId} size={96} animate anim="idle" accessories={accessories} />
                  </div>
                  <div className="col" style={{ gap: 8, flex: 1 }}>
                    <label className="tag">Name</label>
                    <input
                      className="input"
                      value={localName}
                      maxLength={16}
                      onChange={(e) => commitName(e.target.value)}
                      placeholder="Player 456"
                    />
                    <div className="row tiny dim" style={{ gap: 8 }}>
                      <span className="marbles">
                        {CURRENCY_ICON} {profile?.marbles ?? 0}
                      </span>
                      <span>·</span>
                      <span>{profile?.wins ?? 0} crowns</span>
                      <span>·</span>
                      <span className="nowrap">{profile?.bestTitle ?? "Fresh Meat"}</span>
                    </div>
                  </div>
                </div>
                <div className="shop">
                  <div className="shop-tabs" role="tablist" aria-label="Cosmetics shop">
                    <button
                      role="tab"
                      aria-selected={shopTab === "blob"}
                      className={`shop-tab ${shopTab === "blob" ? "active" : ""}`}
                      onClick={() => {
                        audio.sfx("blip");
                        setShopTab("blob");
                      }}
                    >
                      🧍 Blobs
                    </button>
                    <button
                      role="tab"
                      aria-selected={shopTab === "acc"}
                      className={`shop-tab acc ${shopTab === "acc" ? "active" : ""}`}
                      onClick={() => {
                        audio.sfx("blip");
                        setShopTab("acc");
                      }}
                    >
                      💅 Accessories
                    </button>
                  </div>
                  <p className="shop-note tiny dim">
                    {CURRENCY_ICON} Marbles buy both — blobs <em>and</em> accessories. Every unlock is permanent and follows you into
                    every game, so spend however you like.
                  </p>
                  {shopTab === "blob" ? (
                    <CharacterPicker value={characterId} onPick={(id) => net.setCharacter(id)} />
                  ) : (
                    <AccessoryPicker />
                  )}
                </div>
              </div>

              <div className="col joinbox">
                {mode === "menu" ? (
                  <>
                    <button className="btn pink big" onClick={create} disabled={status !== "open"}>
                      🎭 Host the Games
                    </button>
                    <button className="btn ghost big" onClick={() => setMode("join")}>
                      🚪 Join with Code
                    </button>
                    <div className="tiny dim center" style={{ textAlign: "center" }}>
                      {status === "open" ? "Connected. The organizers are watching." : status === "connecting" ? "Locating the arena…" : "Reconnecting… don't panic…"}
                    </div>
                  </>
                ) : (
                  <>
                    <label className="tag">Room code</label>
                    <input
                      className="input mono"
                      style={{ fontSize: "1.8rem", letterSpacing: "8px", textAlign: "center" }}
                      value={code}
                      maxLength={6}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === "Enter" && join()}
                      placeholder="ABCD"
                      autoFocus
                    />
                    <button className="btn teal big" onClick={join} disabled={status !== "open"}>
                      Enter the Arena →
                    </button>
                    <button className="btn ghost sm" onClick={() => setMode("menu")}>
                      ← Back
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container games-preview">
        <h3 style={{ marginBottom: 12 }}>The Games {CURRENCY_ICON}</h3>
        <div className="htp-games">
          {ALL_GAME_IDS.map((id) => {
            const g = GAMES[id];
            return (
              <div key={id} className="card htp-game rise">
                <div className="row" style={{ gap: 10 }}>
                  <GameIcon id={id} style={{ fontSize: "2rem" }} />
                  <strong className="game-name">{g.name}</strong>
                </div>
                <GamePreview gameId={id} />
                <p className="tiny" style={{ margin: "6px 0" }}>{g.rules}</p>
                <ControlsReveal text={g.controlText} />
              </div>
            );
          })}
        </div>
        <div className="footer-note dim tiny">
          Real-time online multiplayer. No install, no mercy. Bring friends to betray — or fill the lobby with bots to blame.
          <nav className="footer-links">
            <Link href="/how-to-play">How to Play</Link>
            <span aria-hidden>·</span>
            <Link href="/leaderboard">Leaderboard</Link>
            <span aria-hidden>·</span>
            <Link href="/changelog">Patch Notes</Link>
            <span aria-hidden>·</span>
            <Link href="/privacy">Privacy</Link>
            <span aria-hidden>·</span>
            <Link href="/terms">Terms</Link>
            <span aria-hidden>·</span>
            <FeedbackButton variant="link" label="Feedback" />
          </nav>
          <p className="footer-copy">
            © {new Date().getFullYear()} Eliminated. All rights reserved. No
            contestants were harmed — only eliminated.
          </p>
        </div>
      </div>

      <style jsx>{`
        /* Set the nav off from the page with its own divider line so it reads as
           dedicated chrome rather than floating over the hero. */
        .topbar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding-top: 18px;
          padding-bottom: 14px;
          margin-bottom: 6px;
          border-bottom: 1px solid rgba(236, 240, 245, 0.2);
          position: relative;
          /* Above the hero (also z-index:1) so the account dropdown, which drops
             down past the navbar into the hero region, paints over page content
             instead of being covered by it. Stays below toasts (100)/modals (200). */
          z-index: 60;
        }
        .logo-mark {
          display: block;
          flex: 0 0 auto;
        }
        .hero {
          position: relative;
          padding-top: 12px;
          z-index: 1;
        }
        /* Decorative blob layer spans the whole page (sits behind all content). */
        .hero-blobs {
          position: absolute;
          inset: 0;
          pointer-events: none;
          opacity: 0.42;
          overflow: hidden;
          z-index: 0;
        }
        .hero-blobs > div {
          position: absolute;
        }
        .hero-main {
          position: relative;
          text-align: center;
          z-index: 1;
        }
        .title {
          font-size: clamp(2.6rem, 9vw, 5.6rem);
          font-family: var(--font-title);
          font-weight: 400;
          letter-spacing: 1px;
          line-height: 0.95;
        }
        /* Wrapper hugs the text width so the blob can be placed by % across the word. */
        .wm {
          position: relative;
          display: inline-block;
        }
        .wm-text {
          background: linear-gradient(180deg, #ffffff 0%, #ffd9ec 55%, var(--pink) 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          filter: drop-shadow(0 4px 0 var(--pink-deep)) drop-shadow(0 9px 16px rgba(0, 0, 0, 0.5));
        }
        /* The eliminated-blob standing in as the period at the end of the wordmark. */
        .period-blob {
          display: inline-block;
          width: 0.42em;
          height: 0.42em;
          margin-left: 0.08em;
          vertical-align: -0.1em;
          pointer-events: none;
        }
        .period-blob svg {
          display: block;
          width: 100%;
          height: 100%;
          filter: drop-shadow(0 2px 0 var(--pink-deep)) drop-shadow(0 4px 6px rgba(0, 0, 0, 0.45));
        }
        .subtitle {
          max-width: 640px;
          margin: 12px auto 20px;
          color: var(--ink-dim);
          font-size: 1.05rem;
          font-weight: 400;
        }
        .setup {
          padding: 20px;
          max-width: 880px;
          margin: 0 auto;
          text-align: left;
        }
        .setup-grid {
          display: grid;
          grid-template-columns: 1fr 280px;
          gap: 22px;
        }
        /* Let both columns shrink so the character strip scrolls horizontally
           instead of blowing out the grid and shoving the join box off-screen. */
        .setup-grid > * {
          min-width: 0;
        }
        /* Segmented control that swaps the blob shop and the accessory shop in
           place, so both spends live on the home page instead of accessories
           being a lobby-only surprise. Active tab borrows each picker's accent
           (pink for blobs, teal for accessories) so the color foreshadows the
           strip it reveals. */
        .shop-tabs {
          display: flex;
          gap: 6px;
          margin-bottom: 2px;
        }
        .shop-tab {
          flex: 1;
          padding: 7px 10px;
          border-radius: 12px;
          border: 2px solid var(--line);
          background: rgba(0, 0, 0, 0.25);
          color: var(--ink-dim);
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 0.86rem;
          cursor: pointer;
          transition: transform 0.1s, border-color 0.1s, color 0.1s, background 0.1s;
        }
        .shop-tab:hover {
          transform: translateY(-1px);
        }
        .shop-tab.active {
          color: var(--ink);
          border-color: var(--pink);
          background: rgba(255, 79, 154, 0.16);
        }
        .shop-tab.acc.active {
          border-color: var(--teal);
          background: rgba(31, 227, 194, 0.16);
        }
        .shop-note {
          margin: 6px 2px 2px;
          line-height: 1.3;
        }
        .joinbox {
          gap: 12px;
          justify-content: center;
          border-left: 2px solid var(--line);
          padding-left: 22px;
        }
        .games-preview {
          margin-top: 40px;
          padding-bottom: 50px;
          position: relative;
          z-index: 1;
        }
        .footer-note {
          margin-top: 26px;
          text-align: center;
        }
        .footer-links {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          align-items: center;
          gap: 8px;
          margin-top: 10px;
        }
        .footer-links :global(a) {
          color: var(--ink-dim);
          text-decoration: none;
          font-weight: 600;
        }
        .footer-links :global(a:hover) {
          color: var(--pink, #ff4f9a);
        }
        .footer-copy {
          margin-top: 12px;
          margin-bottom: 0;
          opacity: 0.7;
        }
        @media (max-width: 760px) {
          .setup-grid {
            grid-template-columns: 1fr;
          }
          .joinbox {
            border-left: none;
            border-top: 2px solid var(--line);
            padding-left: 0;
            padding-top: 16px;
          }
        }
      `}</style>
    </div>
  );
}
