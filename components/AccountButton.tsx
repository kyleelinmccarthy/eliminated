"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { authClient } from "@/lib/client/auth-client";
import { useGame, net } from "@/lib/client/net";
import { audio } from "@/lib/client/audio";

type View = "signin" | "signup" | "forgot";

// `variant` decides the framing of the entry point:
//   "login" (default, used in the home topbar) — a neutral "Log In" button that
//           opens straight to sign-in (most home visitors are returning players).
//   "save"  (used in higher-intent spots: post-series, leaderboard) — a benefit-led
//           "Save Progress" upsell that opens to sign-up, and hides once signed in.
export function AccountButton({
  variant = "login",
  label,
}: {
  variant?: "login" | "save";
  label?: string;
} = {}) {
  const { data: session, isPending } = authClient.useSession();
  const gameName = useGame((s) => s.name);

  const defaultView: View = variant === "save" ? "signup" : "signin";
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>(defaultView);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState(gameName);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [googleOn, setGoogleOn] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Portal target (document.body) only exists on the client.
  useEffect(() => setMounted(true), []);

  // Is "Continue with Google" configured on the server?
  useEffect(() => {
    fetch("/api/auth-config")
      .then((r) => r.json())
      .then((c) => setGoogleOn(!!c.google))
      .catch(() => {});
  }, []);

  // After returning from a Google redirect, fold guest progress into the new
  // account exactly once (the WS is already account-keyed post-reload).
  useEffect(() => {
    if (isPending || !session?.user) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.get("just_linked")) return;
    net.afterLogin();
    params.delete("just_linked");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? "?" + qs : ""));
  }, [isPending, session?.user?.id]);

  function reset() {
    setErr(null);
    setNotice(null);
    setBusy(false);
  }
  function openWith(v: View) {
    reset();
    setView(v);
    setName(gameName);
    setOpen(true);
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    reset();
    // Sign-up only: enforce the same 12-char floor the server uses (lib/server/auth.ts
    // minPasswordLength), and make you type it twice so a typo doesn't lock you out of
    // your own Marbles. The server also rejects breached passwords (haveIBeenPwned).
    if (view === "signup") {
      if (password.length < 12) {
        audio.sfx("bad");
        setErr("Password needs at least 12 characters. House rules.");
        return;
      }
      if (password !== confirm) {
        audio.sfx("bad");
        setErr("Those passwords don't match. Even you can't agree with yourself.");
        return;
      }
    }
    setBusy(true);
    try {
      const { error } =
        view === "signup"
          ? await authClient.signUp.email({ email, password, name: name.slice(0, 16) || "Blob" })
          : await authClient.signIn.email({ email, password });
      if (error) {
        audio.sfx("bad");
        setErr(error.message || "That didn't work. The organizers are unmoved.");
        return;
      }
      audio.sfx("good");
      await net.afterLogin();
      setOpen(false);
    } catch {
      setErr("Something broke. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleGoogle() {
    authClient.signIn.social({
      provider: "google",
      callbackURL: window.location.origin + "/?just_linked=1",
    });
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    reset();
    setBusy(true);
    try {
      const { error } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
      if (error) {
        setErr(error.message || "Couldn't send that.");
        return;
      }
      setNotice("If that address has an account, a reset link is on its way.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    await authClient.signOut();
    net.reauth(); // reconnect as a guest
  }

  async function resendVerify() {
    if (!session?.user?.email) return;
    reset();
    try {
      await authClient.sendVerificationEmail({ email: session.user.email, callbackURL: "/" });
      setNotice("Verification email sent.");
    } catch {
      setErr("Couldn't send right now.");
    }
  }

  // --- Logged in: account chip ---
  if (session?.user) {
    // A "save progress" upsell is pointless once you have an account — hide it.
    if (variant === "save") return null;
    const u = session.user;
    return (
      <div className="acct">
        {!u.emailVerified && (
          <button className="pill warn" onClick={resendVerify} title="Resend verification email">
            ⚠️ Verify
          </button>
        )}
        <span className="pill chip" title={u.email}>
          💾 {u.name || u.email}
        </span>
        <button className="pill" onClick={handleSignOut}>
          Sign out
        </button>
        {notice && <span className="tiny good float">{notice}</span>}
        <style jsx>{`
          .acct {
            display: flex;
            align-items: center;
            gap: 6px;
            position: relative;
          }
          .chip {
            max-width: 160px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            cursor: default;
          }
          .warn {
            color: var(--yellow);
            border-color: var(--yellow);
          }
          .float {
            position: absolute;
            top: 110%;
            right: 0;
            white-space: nowrap;
          }
          .good {
            color: var(--teal);
          }
        `}</style>
      </div>
    );
  }

  // --- Logged out: the upsell + modal ---
  return (
    <>
      <button
        className={variant === "save" ? "pill save-pill" : "pill login-pill"}
        onClick={() => openWith(defaultView)}
        disabled={isPending}
      >
        {variant === "save" ? (label ?? "💾 Save Progress") : (label ?? "Log In")}
      </button>

      {open && mounted &&
        createPortal(
          <div className="backdrop" onClick={() => setOpen(false)}>
          <div className="panel sheet" onClick={(e) => e.stopPropagation()}>
            <button className="x" onClick={() => setOpen(false)} aria-label="Close">
              ✕
            </button>

            <h3 className="head">
              {view === "forgot"
                ? "Reset password"
                : view === "signup"
                  ? "Save your Marbles"
                  : "Welcome back"}
            </h3>
            <p className="blurb tiny dim">
              {view === "forgot"
                ? "We'll email you a link to set a new one."
                : view === "signup"
                  ? "Keep your Marbles, crowns, and unlocked blobs across every device. Guests lose it all when the browser forgets them — like the organizers forget names."
                  : "Sign in to sync your progress back."}
            </p>

            {googleOn && view !== "forgot" && (
              <>
                <button className="btn ghost big gbtn" onClick={handleGoogle}>
                  <span className="g">G</span> Continue with Google
                </button>
                <div className="or tiny dim">or with email</div>
              </>
            )}

            {view === "forgot" ? (
              <form onSubmit={handleForgot} className="form">
                <input
                  className="input"
                  type="email"
                  placeholder="you@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
                <button className="btn pink big" disabled={busy}>
                  {busy ? "Sending…" : "Email me a reset link"}
                </button>
                <button type="button" className="link" onClick={() => openWith("signin")}>
                  ← Back to sign in
                </button>
              </form>
            ) : (
              <form onSubmit={handleEmail} className="form">
                {view === "signup" && (
                  <input
                    className="input"
                    placeholder="Display name"
                    value={name}
                    maxLength={16}
                    onChange={(e) => setName(e.target.value)}
                  />
                )}
                <input
                  className="input"
                  type="email"
                  placeholder="you@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
                <input
                  className="input"
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  // 12 for new accounts; sign-in keeps the old floor so returning
                  // players with shorter passwords aren't locked out at the input.
                  minLength={view === "signup" ? 12 : 8}
                  autoComplete={view === "signup" ? "new-password" : "current-password"}
                />
                {view === "signup" && (
                  <>
                    <input
                      className="input"
                      type="password"
                      placeholder="Confirm password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                      minLength={12}
                      autoComplete="new-password"
                    />
                    <p className="hint tiny dim">
                      At least 12 characters, and not one that's been leaked in a breach.
                      Make it harder to crack than your strategy.
                    </p>
                  </>
                )}
                <button className="btn pink big" disabled={busy}>
                  {busy ? "…" : view === "signup" ? "Create account" : "Sign in"}
                </button>
              </form>
            )}

            {err && <div className="msg bad">{err}</div>}
            {notice && <div className="msg good">{notice}</div>}

            {view !== "forgot" && (
              <div className="foot tiny dim">
                {view === "signup" ? (
                  <>
                    Already signed something?{" "}
                    <button className="link" onClick={() => openWith("signin")}>
                      Sign in
                    </button>
                  </>
                ) : (
                  <>
                    <button className="link" onClick={() => openWith("signup")}>
                      Create an account
                    </button>
                    <span> · </span>
                    <button className="link" onClick={() => openWith("forgot")}>
                      Forgot password?
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          </div>,
          document.body,
        )}

      <style jsx>{`
        /* Accent lives in the tint/border; text stays white so it never sits
           color-on-color (matches .pink / .gold in globals.css). Save Progress
           keeps the teal "go" accent; the home Log In is pink to match the brand. */
        .save-pill {
          background: rgba(25, 211, 189, 0.14);
          border-color: var(--teal);
          color: var(--ink);
        }
        .login-pill {
          background: rgba(255, 46, 136, 0.16);
          border-color: var(--line-bright);
          color: var(--ink);
        }
        .backdrop {
          position: fixed;
          inset: 0;
          background: rgba(8, 4, 18, 0.74);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 200;
          padding: 16px;
          animation: fade 0.15s ease both;
        }
        .sheet {
          position: relative;
          width: min(380px, 96vw);
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          text-align: center;
          animation: pop 0.18s ease both;
        }
        .x {
          position: absolute;
          top: 10px;
          right: 12px;
          background: none;
          border: none;
          color: var(--ink-dim);
          font-size: 1rem;
          cursor: pointer;
        }
        .head {
          font-family: var(--font-display);
          margin: 0;
        }
        .blurb {
          margin: -4px 0 4px;
          line-height: 1.4;
        }
        .form {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .hint {
          margin: -4px 2px 0;
          text-align: left;
          line-height: 1.3;
        }
        .gbtn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .g {
          font-family: var(--font-display);
          font-weight: 800;
          color: #4285f4;
        }
        .or {
          position: relative;
          margin: 2px 0;
        }
        .msg {
          font-size: 0.82rem;
          font-weight: 600;
        }
        .bad {
          color: var(--red);
        }
        .good {
          color: var(--teal);
        }
        .foot {
          margin-top: 2px;
        }
        .link {
          background: none;
          border: none;
          color: var(--teal);
          cursor: pointer;
          font: inherit;
          padding: 0;
          text-decoration: underline;
        }
        @keyframes fade {
          from {
            opacity: 0;
          }
        }
        @keyframes pop {
          from {
            transform: scale(0.96);
            opacity: 0;
          }
        }
      `}</style>
    </>
  );
}
