import Link from "next/link";
import { CHANGELOG } from "@/lib/shared/legal";

export const metadata = { title: "Patch Notes — Eliminated" };

const TAG_COLOR: Record<string, string> = {
  Launch: "var(--pink, #ff4f9a)",
  Feature: "#6ad1ff",
  Balance: "#ffd166",
  Bugfix: "#7ee787",
  Hotfix: "var(--red, #ff5a5a)",
};

export default function Changelog() {
  return (
    <div className="page">
      <div className="container" style={{ paddingTop: 24, paddingBottom: 50, maxWidth: 760 }}>
        <div className="row" style={{ marginBottom: 18 }}>
          <Link className="btn ghost sm" href="/">
            ← Home
          </Link>
          <div className="spacer" />
          <Link className="pill" href="/how-to-play">
            ❔ How to Play
          </Link>
        </div>

        <h1 className="shadowtext" style={{ fontSize: "2.6rem", marginBottom: 2 }}>
          📓 Patch Notes
        </h1>
        <div
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.95rem",
            fontWeight: 600,
            color: "var(--ink-dim)",
            marginBottom: 16,
          }}
        >
          a running confession of everything we've changed and broken.
        </div>

        <div className="cl">
          {CHANGELOG.map((entry) => (
            <div key={entry.version} className="panel cl-entry">
              <div className="row" style={{ gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span className="cl-tag" style={{ ["--tag" as string]: TAG_COLOR[entry.tag] || "var(--ink-dim)" }}>
                  {entry.tag}
                </span>
                <strong style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem" }}>
                  v{entry.version} — {entry.title}
                </strong>
                <div className="spacer" />
                <span className="tiny dim cl-date">{entry.date}</span>
              </div>
              <ul>
                {entry.notes.map((n, i) => (
                  <li key={i} className="dim">
                    {n}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div style={{ textAlign: "center", marginTop: 28 }}>
          <Link
            className="btn pink big"
            href="/"
            style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", lineHeight: 1.15, gap: 2 }}
          >
            <span>← Back to the Arena</span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: "0.72rem", fontWeight: 600, opacity: 0.85 }}>
              the next patch is always a nerf to you specifically
            </span>
          </Link>
        </div>
      </div>

      <style>{`
        .cl { display: flex; flex-direction: column; gap: 14px; }
        .cl-entry { padding: 18px 20px; }
        .cl-entry ul { margin: 12px 0 0; padding-left: 20px; line-height: 1.65; }
        .cl-entry li { margin-bottom: 6px; }
        .cl-date { white-space: nowrap; }
        .cl-tag {
          font-family: var(--font-body);
          font-size: 0.68rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 1px;
          padding: 3px 9px;
          border-radius: 999px;
          color: var(--tag);
          border: 1px solid var(--tag);
          background: color-mix(in srgb, var(--tag) 12%, transparent);
        }
      `}</style>
    </div>
  );
}
