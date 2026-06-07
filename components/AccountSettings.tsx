"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { authClient } from "@/lib/client/auth-client";
import { net } from "@/lib/client/net";
import { audio } from "@/lib/client/audio";

// Account Settings modal for signed-in players. Opened from the profile dropdown
// in AccountButton. Three things you can do once you have an account:
//   • rename yourself (updates the chip AND the leaderboard profile),
//   • change your password (email/password accounts only),
//   • delete your account — which also wipes your game progress server-side
//     (Better Auth deleteUser.beforeDelete → deleteAccountData).
export function AccountSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: session } = authClient.useSession();
  const u = session?.user;

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Does this account sign in with a password (vs Google-only)? Decides whether
  // we show the change-password section and ask for a password before deleting.
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  useEffect(() => {
    if (!open) return;
    authClient
      .listAccounts()
      .then((res) => {
        const accounts = (res?.data ?? res) as Array<{ providerId?: string }> | undefined;
        setHasPassword(
          Array.isArray(accounts) && accounts.some((a) => a.providerId === "credential"),
        );
      })
      .catch(() => setHasPassword(null));
  }, [open]);

  // --- Display name ---
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [nameErr, setNameErr] = useState<string | null>(null);
  useEffect(() => {
    if (open && u) setName(u.name || "");
  }, [open, u?.id]);

  // --- Change password ---
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);

  // --- Delete account ---
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deletePw, setDeletePw] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  // Reset transient state every time the sheet opens/closes.
  useEffect(() => {
    if (open) return;
    setNameMsg(null);
    setNameErr(null);
    setCurPw("");
    setNewPw("");
    setConfirmPw("");
    setPwMsg(null);
    setPwErr(null);
    setConfirmingDelete(false);
    setDeleteText("");
    setDeletePw("");
    setDeleteErr(null);
  }, [open]);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setNameMsg(null);
    setNameErr(null);
    const clean = name.trim().slice(0, 16);
    if (!clean) {
      audio.sfx("bad");
      setNameErr("A blob needs a name. Even a bad one.");
      return;
    }
    setSavingName(true);
    try {
      const { error } = await authClient.updateUser({ name: clean });
      if (error) {
        audio.sfx("bad");
        setNameErr(error.message || "Couldn't save that name.");
        return;
      }
      // Push the new name to the live socket so the leaderboard profile + any
      // in-progress lobby pick it up too, not just the account chip.
      net.setName(clean);
      audio.sfx("good");
      setNameMsg("Saved. The organizers have updated their files.");
    } finally {
      setSavingName(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwErr(null);
    setPwMsg(null);
    if (newPw.length < 12) {
      audio.sfx("bad");
      setPwErr("New password needs at least 12 characters. House rules.");
      return;
    }
    if (newPw !== confirmPw) {
      audio.sfx("bad");
      setPwErr("Those passwords don't match. Try agreeing with yourself.");
      return;
    }
    setSavingPw(true);
    try {
      const { error } = await authClient.changePassword({
        currentPassword: curPw,
        newPassword: newPw,
        revokeOtherSessions: true, // sign out everywhere else after a password change
      });
      if (error) {
        audio.sfx("bad");
        setPwErr(error.message || "Couldn't change it. Check your current password.");
        return;
      }
      audio.sfx("good");
      setPwMsg("Password changed. Other sessions have been booted.");
      setCurPw("");
      setNewPw("");
      setConfirmPw("");
    } finally {
      setSavingPw(false);
    }
  }

  async function deleteAccount() {
    setDeleteErr(null);
    setDeleting(true);
    try {
      const { error } = await authClient.deleteUser(
        hasPassword ? { password: deletePw } : {},
      );
      if (error) {
        audio.sfx("bad");
        // Google-only accounts need a recent (fresh) session to self-delete.
        const stale = /fresh|session/i.test(error.message || "");
        setDeleteErr(
          stale
            ? "For your safety, sign out and back in, then delete."
            : error.message || "Couldn't delete the account.",
        );
        return;
      }
      // Gone. Drop the modal and re-key the live socket back to a guest.
      onClose();
      net.reauth();
    } finally {
      setDeleting(false);
    }
  }

  if (!open || !mounted || !u) return null;

  const canDelete =
    deleteText.trim().toUpperCase() === "DELETE" && (!hasPassword || deletePw.length > 0);

  return createPortal(
    <div className="backdrop" onClick={onClose}>
      <div
        className="panel sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Account settings"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <button className="x" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <h3 className="head">Account settings</h3>
        <p className="who tiny dim" title={u.email}>
          Signed in as {u.email}
        </p>

        {/* Display name */}
        <form onSubmit={saveName} className="sect">
          <label className="lbl tiny dim">Display name</label>
          <div className="row">
            <input
              className="input"
              value={name}
              maxLength={16}
              onChange={(e) => setName(e.target.value)}
              placeholder="Blob"
            />
            <button className="btn pink" disabled={savingName}>
              {savingName ? "…" : "Save"}
            </button>
          </div>
          {nameErr && <div className="msg bad">{nameErr}</div>}
          {nameMsg && <div className="msg good">{nameMsg}</div>}
        </form>

        {/* Change password — email/password accounts only */}
        {hasPassword && (
          <form onSubmit={changePassword} className="sect">
            <label className="lbl tiny dim">Change password</label>
            <input
              className="input"
              type="password"
              placeholder="Current password"
              value={curPw}
              onChange={(e) => setCurPw(e.target.value)}
              autoComplete="current-password"
              required
            />
            <input
              className="input"
              type="password"
              placeholder="New password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              minLength={12}
              autoComplete="new-password"
              required
            />
            <input
              className="input"
              type="password"
              placeholder="Confirm new password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              minLength={12}
              autoComplete="new-password"
              required
            />
            <button className="btn pink" disabled={savingPw}>
              {savingPw ? "…" : "Update password"}
            </button>
            {pwErr && <div className="msg bad">{pwErr}</div>}
            {pwMsg && <div className="msg good">{pwMsg}</div>}
          </form>
        )}

        {/* Danger zone */}
        <div className="sect danger">
          <label className="lbl tiny">⚠️ Delete account</label>
          {!confirmingDelete ? (
            <>
              <p className="tiny dim warn-copy">
                Wipes your account and everything you've earned — Marbles, crowns,
                unlocked blobs. No refunds, no appeals. The organizers don't keep
                records of the eliminated.
              </p>
              <button className="btn outline-red" onClick={() => setConfirmingDelete(true)}>
                Delete my account
              </button>
            </>
          ) : (
            <>
              <p className="tiny dim warn-copy">
                Type <b>DELETE</b> to confirm{hasPassword ? " and enter your password" : ""}.
                This can't be undone.
              </p>
              <input
                className="input"
                value={deleteText}
                onChange={(e) => setDeleteText(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
              />
              {hasPassword && (
                <input
                  className="input"
                  type="password"
                  placeholder="Your password"
                  value={deletePw}
                  onChange={(e) => setDeletePw(e.target.value)}
                  autoComplete="current-password"
                />
              )}
              <div className="row">
                <button
                  className="btn ghost"
                  onClick={() => {
                    setConfirmingDelete(false);
                    setDeleteText("");
                    setDeletePw("");
                    setDeleteErr(null);
                  }}
                  disabled={deleting}
                >
                  Keep it
                </button>
                <button className="btn del" onClick={deleteAccount} disabled={!canDelete || deleting}>
                  {deleting ? "Deleting…" : "Delete forever"}
                </button>
              </div>
              {deleteErr && <div className="msg bad">{deleteErr}</div>}
            </>
          )}
        </div>
      </div>

      <style jsx>{`
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
          width: min(400px, 96vw);
          max-height: 90vh;
          overflow-y: auto;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 14px;
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
        .who {
          margin: -8px 0 2px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sect {
          display: flex;
          flex-direction: column;
          gap: 8px;
          text-align: left;
          padding-top: 12px;
          border-top: 1px solid var(--line);
        }
        .lbl {
          font-weight: 600;
        }
        .row {
          display: flex;
          gap: 8px;
        }
        .row .input {
          flex: 1;
        }
        .danger .lbl {
          color: var(--red);
        }
        .warn-copy {
          margin: 0;
          line-height: 1.4;
        }
        .msg {
          font-size: 0.8rem;
          font-weight: 600;
        }
        .bad {
          color: var(--red);
        }
        .good {
          color: var(--teal);
        }
        .del {
          --c: var(--red);
        }
        .outline-red {
          background: transparent;
          border: 2px solid var(--red);
          box-shadow: none;
          color: var(--ink);
        }
        .outline-red:hover {
          background: rgba(255, 90, 77, 0.12);
        }
        .outline-red:active {
          top: 0;
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
    </div>,
    document.body,
  );
}
