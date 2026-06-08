// Loads .env files into process.env for the CUSTOM SERVER context, and does so
// BEFORE any module that reads env at import/boot time (auth.ts, db.ts) runs.
//
// Why this has to exist: the app boots via `tsx server.ts`, and tsx/Node do NOT
// auto-load .env. Next.js DOES load it — but only inside app.prepare(), which
// runs AFTER server.ts has already called initDb() and imported auth.ts. On top
// of that, Next bundles lib/server/{db,auth}.ts as a SEPARATE module instance
// from the one the custom server imports. The result: the WebSocket server's db
// (where recordSeries persists marbles) falls back to local sqlite because it
// never saw DATABASE_URL, while the Next-bundled db (where /leaderboard reads)
// sees the env Next loaded and uses Turso. Two databases, so gameplay writes and
// the leaderboard read never sync.
//
// Importing this module FIRST in server.ts (for its side effect) populates the
// env before the db/auth module bodies evaluate, so the custom-server context
// connects to the same database as the Next context. @next/env is the exact
// loader Next uses, so both contexts read identical values. loadEnvConfig does
// not override variables already present in process.env, so Railway-injected
// production vars still win.
//
// @next/env is a CommonJS package and this project is "type": "module", so a
// static `import { loadEnvConfig }` makes Node's ESM loader try to detect named
// exports via cjs-module-lexer — which fails in some prod Node runtimes
// ("does not provide an export named 'loadEnvConfig'"). createRequire loads the
// CJS module directly, sidestepping named-export detection entirely.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
