// Creates/updates Better Auth's tables (user/session/account/verification) in
// the same libSQL DB the game uses. Re-runnable and idempotent. Prefer this over
// `@better-auth/cli migrate`, which relies on a TTY spinner and runs silently in
// some shells (WSL). Run with: npm run migrate:auth
//
// The server also runs this on boot (lib/server/auth.ts → ensureAuthSchema), so
// this script is for migrating a remote DB (e.g. Turso) ahead of a deploy, or CI.
import { ensureAuthSchema } from "../lib/server/auth";

await ensureAuthSchema();
process.exit(0);
