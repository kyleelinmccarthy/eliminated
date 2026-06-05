"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/client/auth-client";

export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null);
  const [linkError, setLinkError] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error")) setLinkError(true);
    setToken(params.get("token"));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      setErr("This reset link is missing its token. Request a fresh one.");
      return;
    }
    setBusy(true);
    setErr(null);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    setBusy(false);
    if (error) {
      setErr(error.message || "That link is expired or already used. Request a new one.");
      return;
    }
    setDone(true);
  }

  return (
    <div className="page wrap">
      <div className="panel sheet">
        <h2 className="head">Reset password</h2>

        {done ? (
          <>
            <p className="tiny dim">
              Done. Your Marbles are safe and the new password is live.
            </p>
            <Link className="btn pink big" href="/">
              ← Back to the arena
            </Link>
          </>
        ) : linkError || !token ? (
          <>
            <p className="tiny dim">
              This link is expired, used, or malformed. The organizers do not issue refunds, but
              they will issue another link.
            </p>
            <Link className="btn ghost big" href="/">
              ← Back to home
            </Link>
          </>
        ) : (
          <form onSubmit={submit} className="form">
            <p className="tiny dim">Pick a new password (8+ characters).</p>
            <input
              className="input"
              type="password"
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              autoFocus
              autoComplete="new-password"
            />
            <button className="btn pink big" disabled={busy}>
              {busy ? "Saving…" : "Set new password"}
            </button>
            {err && <div className="msg bad">{err}</div>}
          </form>
        )}
      </div>

      <style jsx>{`
        .wrap {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .sheet {
          width: min(380px, 96vw);
          padding: 28px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          text-align: center;
        }
        .head {
          font-family: var(--font-display);
          margin: 0;
        }
        .form {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .msg {
          font-size: 0.82rem;
          font-weight: 600;
        }
        .bad {
          color: var(--red);
        }
      `}</style>
    </div>
  );
}
