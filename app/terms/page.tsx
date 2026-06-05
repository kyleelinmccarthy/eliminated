import Link from "next/link";
import { SITE_NAME, CONTACT_EMAIL, LEGAL_LAST_UPDATED } from "@/lib/shared/legal";
import { CURRENCY } from "@/lib/shared/constants";

export const metadata = { title: "Terms of Service — Eliminated" };

export default function Terms() {
  return (
    <div className="page">
      <div className="container legal" style={{ paddingTop: 24, paddingBottom: 50, maxWidth: 760 }}>
        <div className="row" style={{ marginBottom: 18 }}>
          <Link className="btn ghost sm" href="/">
            ← Home
          </Link>
          <div className="spacer" />
          <Link className="pill" href="/privacy">
            🔒 Privacy
          </Link>
        </div>

        <h1 className="shadowtext" style={{ fontSize: "2.6rem", marginBottom: 2 }}>
          📜 Terms of Service
        </h1>
        <div className="tiny dim" style={{ marginBottom: 16 }}>
          Last updated {LEGAL_LAST_UPDATED}
        </div>

        <div className="panel legal-tldr">
          <strong>The short version</strong>
          <p className="dim tiny" style={{ margin: "6px 0 0" }}>
            It's a free browser game about cartoon blobs. Be 13+, don't be a jerk to other players, don't break the
            game on purpose, and understand that {CURRENCY} aren't real money. We can ban bad actors. The game is
            provided "as is." {SITE_NAME} is a parody and isn't affiliated with anyone you might be thinking of.
          </p>
        </div>

        <section className="legal-sec">
          <h3>1. The deal</h3>
          <p className="dim">
            By playing {SITE_NAME}, you agree to these Terms and to our{" "}
            <Link href="/privacy">Privacy Policy</Link>. If you don't agree, that's allowed — just don't play. These are
            the rules of the gauntlet; entering means accepting them.
          </p>
        </section>

        <section className="legal-sec">
          <h3>2. Who can play</h3>
          <p className="dim">
            You must be <strong>at least 13 years old</strong> to play. If you're under the age of majority where you
            live, make sure a parent or guardian is fine with it. It's cartoon violence, but it's still about getting
            eliminated.
          </p>
        </section>

        <section className="legal-sec">
          <h3>3. Behave yourself</h3>
          <p className="dim">When you play, you agree not to:</p>
          <ul>
            <li>
              Choose a display name that's hateful, harassing, threatening, sexual, impersonating someone, or otherwise
              the kind of thing that gets a blob removed. Names appear publicly on the leaderboard.
            </li>
            <li>Harass, threaten, or grief other players beyond the friendly betrayal the game is built around.</li>
            <li>Cheat, exploit bugs, script, automate, or otherwise tamper with the game, the server, or other players.</li>
            <li>Attempt to break, overload, reverse-engineer, or gain unauthorized access to {SITE_NAME}'s systems.</li>
          </ul>
          <p className="dim">
            We may remove offensive names, reset stats, or block access — temporarily or permanently — if you break
            these rules. We don't owe you a warning, an explanation, or a heartfelt goodbye.
          </p>
        </section>

        <section className="legal-sec">
          <h3>4. Your blob and your data</h3>
          <p className="dim">
            How we handle the little data we keep is described in the <Link href="/privacy">Privacy Policy</Link>. You're
            responsible for the name you pick and anything you do under it. {CURRENCY}, characters, titles, and stats are
            in-game cosmetics with no real-world value — they can't be bought, sold, cashed out, or inherited, and we may
            adjust or reset them as part of running the game.
          </p>
        </section>

        <section className="legal-sec">
          <h3>5. It's a parody (the important disclaimer)</h3>
          <p className="dim">
            {SITE_NAME} is an original parody game inspired by playground games and the broader "deadly children's games"
            genre. It is <strong>not affiliated with, endorsed by, or sponsored by</strong> Netflix, the makers of{" "}
            <em>Squid Game</em>, the makers of <em>Boomerang Fu</em>, or any other show, studio, or game. All
            trademarks, characters, and properties referenced or evoked belong to their respective owners. Any
            resemblance is commentary and homage, not affiliation.
          </p>
        </section>

        <section className="legal-sec">
          <h3>6. No warranty</h3>
          <p className="dim">
            {SITE_NAME} is provided <strong>"as is" and "as available,"</strong> with no warranties of any kind. It's a
            free game made for fun. It may go down, lose your stats, change without notice, or stop existing entirely. We
            don't promise it will be uninterrupted, bug-free, or eternally available. Marbles are not a financial
            instrument and your portfolio manager should not be consulted.
          </p>
        </section>

        <section className="legal-sec">
          <h3>7. Limitation of liability</h3>
          <p className="dim">
            To the fullest extent allowed by law, {SITE_NAME} and its creators aren't liable for any indirect,
            incidental, or consequential damages arising from your use of the game — including lost stats, lost
            friendships, or wounded pride. The game is free; our total liability to you is, realistically, the price you
            paid to play it.
          </p>
        </section>

        <section className="legal-sec">
          <h3>8. Changes &amp; ending things</h3>
          <p className="dim">
            We may update these Terms; when we do, we'll change the date at the top, and continuing to play means you
            accept the new version. We may also change, suspend, or shut down the game (or your access to it) at any
            time. You can stop playing whenever you like — clearing your browser data and walking away is always an
            option.
          </p>
        </section>

        <section className="legal-sec">
          <h3>9. Contact</h3>
          <p className="dim">
            Questions about these Terms? <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>
        </section>

        <div style={{ textAlign: "center", marginTop: 28 }}>
          <Link className="btn pink big" href="/">
            ← Back to the Arena
          </Link>
        </div>
      </div>

      <style>{`
        .legal-tldr { padding: 16px 20px; margin-bottom: 8px; }
        .legal-sec { margin-top: 22px; }
        .legal-sec h3 { margin-bottom: 8px; }
        .legal-sec ul { margin: 8px 0 0; padding-left: 20px; line-height: 1.7; }
        .legal-sec li { margin-bottom: 8px; color: var(--ink-dim); }
        .legal p { line-height: 1.7; }
        .legal a { color: var(--pink, #ff4f9a); }
      `}</style>
    </div>
  );
}
