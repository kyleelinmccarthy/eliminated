// Creates/updates Better Auth's tables (user/session/account/verification) in
// the same libSQL DB the game uses. Re-runnable and idempotent. Prefer this over
// `@better-auth/cli migrate`, which relies on a TTY spinner and runs silently in
// some shells (WSL). Run with: npm run migrate:auth
import { getMigrations } from "better-auth/db/migration";
import { auth } from "../lib/server/auth";

const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
const created = toBeCreated.map((t) => t.table);
const altered = toBeAdded.map((t) => t.table);

if (!created.length && !altered.length) {
  console.log("[auth] schema already up to date");
} else {
  await runMigrations();
  console.log("[auth] migrated ✓", { created, altered });
}
process.exit(0);
