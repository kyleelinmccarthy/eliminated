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
import { LibsqlDialect } from "@libsql/kysely-libsql";
import { mkdirSync } from "node:fs";
import { sendEmail } from "./email";

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
});

export type Session = typeof auth.$Infer.Session;

// Surfaced to the client (via /api/auth-config) so the UI can hide the Google
// button when it isn't configured, rather than offering a dead end.
export const authCapabilities = { google: googleEnabled };
