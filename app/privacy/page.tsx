import Link from "next/link";
import { SITE_NAME, CONTACT_EMAIL, LEGAL_LAST_UPDATED } from "@/lib/shared/legal";

export const metadata = { title: "Privacy Policy — Eliminated" };

export default function Privacy() {
  return (
    <div className="page">
      <div className="container legal" style={{ paddingTop: 24, paddingBottom: 50, maxWidth: 760 }}>
        <div className="row" style={{ marginBottom: 18 }}>
          <Link className="btn ghost sm" href="/">
            ← Home
          </Link>
          <div className="spacer" />
          <Link className="pill" href="/terms">
            📜 Terms
          </Link>
        </div>

        <h1 className="shadowtext" style={{ fontSize: "2.6rem", marginBottom: 2 }}>
          🔒 Privacy Policy
        </h1>
        <div className="tiny dim" style={{ marginBottom: 16 }}>
          Last updated {LEGAL_LAST_UPDATED}
        </div>

        <div className="panel legal-tldr">
          <strong>The short version</strong>
          <p className="dim tiny" style={{ margin: "6px 0 0" }}>
            {SITE_NAME} keeps a random ID, the display name you pick, and your game stats. No email, no password, no
            real-name requirement, no ads, no trackers, and we never sell anything about you. Your name and stats show up
            on a public leaderboard, so don't name your blob after your social security number.
          </p>
        </div>

        <section className="legal-sec">
          <h3>What we collect</h3>
          <ul>
            <li>
              <strong>A random player ID.</strong> Generated in your browser the first time you play and stored there.
              It's how we recognize your blob between sessions. It isn't tied to your identity unless you go out of your
              way to make it so.
            </li>
            <li>
              <strong>The display name you choose.</strong> Whatever you type into the name box. If you type your real
              name, that's on you — see the leaderboard note below.
            </li>
            <li>
              <strong>Game stats.</strong> Marbles, wins, games played, rounds survived, your best title, and which
              characters you've unlocked. The numbers that prove you were here.
            </li>
            <li>
              <strong>Local preferences.</strong> Your chosen character and whether you've muted the sound, saved in your
              browser so you don't have to set them every time.
            </li>
          </ul>
        </section>

        <section className="legal-sec">
          <h3>What we don't collect</h3>
          <p className="dim">
            No email address, no password, no account, no phone number, no payment details, no advertising or
            third-party tracking pixels, and no shadow profile of your soul. We don't run analytics that follow you
            around the internet, and we don't sell or rent your data to anyone. There's no money in blobs.
          </p>
        </section>

        <section className="legal-sec">
          <h3>Where your data lives</h3>
          <p className="dim">
            Two places: your <strong>browser's local storage</strong> (the random ID, name, character, and mute setting)
            and our <strong>game database</strong>, which holds your profile and stats so the leaderboard works across
            devices. Our database is hosted by a third-party infrastructure provider that stores the data on our behalf
            and isn't allowed to use it for anything else.
          </p>
        </section>

        <section className="legal-sec">
          <h3>The public leaderboard</h3>
          <p className="dim">
            The Wall of Survivors publicly shows your <strong>display name, title, and stats</strong> to anyone who visits.
            That's the whole point of bragging rights. Because it's public, <strong>please don't use your legal name</strong>{" "}
            or anything you'd mind a stranger seeing. Pick something fun. Pick something you can defend in court.
          </p>
        </section>

        <section className="legal-sec">
          <h3>Cookies &amp; local storage</h3>
          <p className="dim">
            We don't use advertising cookies. The only thing we keep in your browser is the handful of values listed
            above, and they exist purely to make the game work. Clear your browser storage and they're gone.
          </p>
        </section>

        <section className="legal-sec">
          <h3>Your choices &amp; deleting your blob</h3>
          <p className="dim">
            To wipe your local data, clear this site's storage in your browser (or use your browser's "clear site data"
            tool). To delete your server-side profile and remove yourself from the leaderboard, email us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with your display name and we'll erase it. Depending
            on where you live (e.g. the EU/UK or California), you may have additional rights to access or delete your
            data — the same email gets you all of them.
          </p>
        </section>

        <section className="legal-sec">
          <h3>Kids</h3>
          <p className="dim">
            {SITE_NAME} is meant for players <strong>13 and older</strong>. It's cartoon blobs in cartoon peril, but it's
            still a game about elimination with dark humor. We don't knowingly collect data from children under 13. If
            you believe a younger child has played and given us data, email us and we'll remove it.
          </p>
        </section>

        <section className="legal-sec">
          <h3>Changes to this policy</h3>
          <p className="dim">
            If we change what we collect, we'll update this page and bump the date at the top. Continuing to play after a
            change means you're okay with the new version. We'll try not to make it weird.
          </p>
        </section>

        <section className="legal-sec">
          <h3>Contact</h3>
          <p className="dim">
            Questions, deletion requests, or existential complaints: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
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
        .legal-sec ul { margin: 0; padding-left: 20px; line-height: 1.7; }
        .legal-sec li { margin-bottom: 8px; color: var(--ink-dim); }
        .legal p { line-height: 1.7; }
        .legal a { color: var(--pink, #ff4f9a); }
      `}</style>
    </div>
  );
}
