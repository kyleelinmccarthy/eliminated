// Better Auth server instance. Runs on the SAME libSQL database as the game
// (lib/server/db.ts) via a Kysely libSQL dialect, so accounts and profiles live
// in one file/Turso db. Optional accounts only — guests never touch any of this.
//
// Env (all optional in dev; the feature degrades gracefully without them):
//   BETTER_AUTH_SECRET   - signing secret (openssl rand -base64 32)
//   BETTER_AUTH_URL      - public base URL, must match the browser origin
//   GOOGLE_CLIENT_ID/SECRET - enables "Continue with Google" when both are set
//   RESEND_API_KEY       - enables verification + password-reset email
//   EMAIL_FROM           - verified Resend sender, e.g. "Eliminated <no-reply@…>"
import { betterAuth } from "better-auth";
import { haveIBeenPwned } from "better-auth/plugins";
import { LibsqlDialect } from "@libsql/kysely-libsql";
import { mkdirSync } from "node:fs";
import { sendEmail } from "./email";
import { deleteAccountData } from "./db";

const url = process.env.DATABASE_URL ?? "file:./data/eliminated.db";
// Local file needs its parent dir to exist before libSQL opens it (mirrors db.ts).
if (!process.env.DATABASE_URL) mkdirSync("./data", { recursive: true });

const dialect = new LibsqlDialect({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

const googleEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const auth = betterAuth({
  database: { dialect, type: "sqlite" },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    // 12-char floor (default is 8). Length is the strongest lever; we deliberately
    // skip composition rules — see the haveIBeenPwned plugin below for the real
    // defense (credential stuffing). Keep this in sync with the client minLength.
    minPasswordLength: 12,
    // Let unverified blobs play immediately — the account is the upsell, not a gate.
    requireEmailVerification: false,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Reset your Eliminated password",
        html: `<p>Forgot it already? Happens to the best blobs.</p>
         <p><a href="${url}">Set a new password</a> before someone else claims your Marbles.</p>
         <p>Didn't ask for this? Ignore it — your account stays locked, like the doors.</p>`,
      });
    },
  },
  user: {
    deleteUser: {
      // Lets a signed-in player delete their own account from Account Settings.
      // Verification: email/password users must re-enter their password; social
      // (Google) users rely on a fresh session (Better Auth's default freshAge).
      enabled: true,
      // Run BEFORE the auth row is removed so account deletion also wipes the
      // player's game profile (marbles, wins, unlocks) — nothing left behind.
      beforeDelete: async (user) => {
        await deleteAccountData(user.id);
      },
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Verify your Eliminated account",
        html: `<p>Confirm you're a real, breathing blob.</p>
         <p><a href="${url}">Verify your email</a> to lock in your Marbles across every device.</p>
         <p>The organizers appreciate your cooperation.</p>`,
      });
    },
  },
  ...(googleEnabled
    ? {
        socialProviders: {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID as string,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
          },
        },
      }
    : {}),
  plugins: [
    // Rejects passwords found in known breach corpora (sign-up / change / reset).
    // Uses k-anonymity: only a SHA-1 prefix is sent to the HIBP range API, never
    // the password itself. This is the actual defense against credential stuffing.
    haveIBeenPwned({
      customPasswordCompromisedMessage:
        "That password's turned up in a data breach. Pick one the organizers haven't seen.",
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;

// Idempotent: creates Better Auth's tables (user/session/account/verification)
// in the shared libSQL DB when missing, and adds any newly-introduced columns.
// Better Auth never creates its schema at runtime, so without this the first
// sign-in (email OR social) 500s with "no such table: verification". Run on every
// boot (server.ts) so a fresh deploy self-heals — a no-op once the schema is
// current. The migrate:auth script calls the same path for manual/CI use.
export async function ensureAuthSchema(): Promise<void> {
  // Lazy import: keeps the migration toolchain out of the request hot path
  // (this module is also imported by the /api/auth/* route handler).
  const { getMigrations } = await import("better-auth/db/migration");
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
  if (!toBeCreated.length && !toBeAdded.length) {
    console.log("[auth] schema already up to date");
    return;
  }
  await runMigrations();
  console.log("[auth] schema migrated ✓", {
    created: toBeCreated.map((t) => t.table),
    altered: toBeAdded.map((t) => t.table),
  });
}

// Surfaced to the client (via /api/auth-config) so the UI can hide the Google
// button when it isn't configured, rather than offering a dead end.
export const authCapabilities = { google: googleEnabled };
