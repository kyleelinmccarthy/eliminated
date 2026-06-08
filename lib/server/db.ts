// Persistence for profiles, currency, and the leaderboard. Uses libSQL: a local
// SQLite file by default (./data/eliminated.db), or Turso if DATABASE_URL is set.
// Falls back to an in-memory store if the DB can't be opened, so the game always
// runs.
import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "node:fs";
import type { ProfileSummary } from "../shared/types";
import { FREE_CHARACTERS } from "../shared/characters";

let client: Client | null = null;
let ready = false;
let initPromise: Promise<void> | null = null;

// Idempotent — safe to call from the custom server boot AND lazily from any
// API route / server component that touches the DB.
export function initDb(): Promise<void> {
  if (!initPromise) initPromise = doInit();
  return initPromise;
}

interface Row {
  clientId: string;
  // Account rows carry the Better Auth user id (and use clientId = "acct_"+userId
  // as their anchor). Guest rows leave this null.
  userId: string | null;
  // Set on a guest row once its progress has been folded into an account — the
  // idempotency guard that stops a second merge from double-counting.
  mergedInto: string | null;
  name: string;
  marbles: number;
  wins: number;
  gamesPlayed: number;
  roundsSurvived: number;
  bestTitle: string;
  unlocked: string;
}

const memory = new Map<string, Row>();
// In-memory fallback store for feedback when no DB is configured (local dev / CI).
const feedbackMemory: StoredFeedback[] = [];

// The effective storage key for a connection/session: an authenticated user is
// keyed by their account (which the server trusts), a guest by their clientId.
export function profileKey(userId: string | null | undefined, clientId: string): string {
  return userId ? "acct_" + userId : clientId;
}

function defaultRow(key: string, name: string): Row {
  return {
    clientId: key,
    userId: key.startsWith("acct_") ? key.slice(5) : null,
    mergedInto: null,
    name,
    marbles: 0,
    wins: 0,
    gamesPlayed: 0,
    roundsSurvived: 0,
    bestTitle: "Fresh Blob",
    unlocked: JSON.stringify(FREE_CHARACTERS),
  };
}

async function doInit(): Promise<void> {
  try {
    const url = process.env.DATABASE_URL;
    if (url) {
      client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
    } else {
      mkdirSync("./data", { recursive: true });
      client = createClient({ url: "file:./data/eliminated.db" });
    }
    await client.execute(`
      CREATE TABLE IF NOT EXISTS profiles (
        clientId TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        marbles INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        gamesPlayed INTEGER NOT NULL DEFAULT 0,
        roundsSurvived INTEGER NOT NULL DEFAULT 0,
        bestTitle TEXT NOT NULL DEFAULT 'Fresh Blob',
        unlocked TEXT NOT NULL DEFAULT '[]'
      )
    `);
    // Optional-accounts columns, added in place (no migration framework here, so
    // ALTER ... ADD COLUMN is wrapped per-column — SQLite throws on re-add).
    await addColumn("userId", "TEXT");
    await addColumn("mergedInto", "TEXT");
    await client.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_userId ON profiles(userId) WHERE userId IS NOT NULL",
    );
    // Player feedback — separate table; never touches profiles.
    await client.execute(`
      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        createdAt TEXT NOT NULL,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        email TEXT,
        context TEXT,
        clientId TEXT
      )
    `);
    ready = true;
    console.log("[db] ready", url ? "(turso)" : "(local sqlite)");
  } catch (err) {
    console.warn("[db] could not open database, using in-memory store:", (err as Error).message);
    client = null;
    ready = false;
  }
}

// Idempotent ADD COLUMN: SQLite has no "IF NOT EXISTS" for columns, so re-runs
// throw "duplicate column name" — which we swallow.
async function addColumn(name: string, type: string): Promise<void> {
  if (!client) return;
  try {
    await client.execute(`ALTER TABLE profiles ADD COLUMN ${name} ${type}`);
  } catch (err) {
    if (!/duplicate column/i.test((err as Error).message)) throw err;
  }
}

function rowToSummary(r: Row): ProfileSummary {
  let unlocked: string[] = FREE_CHARACTERS.slice();
  try {
    const parsed = JSON.parse(r.unlocked);
    if (Array.isArray(parsed)) unlocked = Array.from(new Set([...FREE_CHARACTERS, ...parsed]));
  } catch {}
  return {
    clientId: r.clientId,
    name: r.name,
    marbles: r.marbles,
    wins: r.wins,
    gamesPlayed: r.gamesPlayed,
    roundsSurvived: r.roundsSurvived,
    bestTitle: r.bestTitle,
    unlocked,
  };
}

async function loadRow(clientId: string): Promise<Row | null> {
  if (client) {
    const res = await client.execute({
      sql: "SELECT * FROM profiles WHERE clientId = ?",
      args: [clientId],
    });
    if (res.rows.length === 0) return null;
    const r = res.rows[0] as any;
    return {
      clientId: r.clientId,
      userId: r.userId ?? null,
      mergedInto: r.mergedInto ?? null,
      name: r.name,
      marbles: Number(r.marbles),
      wins: Number(r.wins),
      gamesPlayed: Number(r.gamesPlayed),
      roundsSurvived: Number(r.roundsSurvived),
      bestTitle: r.bestTitle,
      unlocked: r.unlocked,
    };
  }
  return memory.get(clientId) ?? null;
}

async function saveRow(r: Row): Promise<void> {
  if (client) {
    await client.execute({
      sql: `INSERT INTO profiles (clientId, userId, mergedInto, name, marbles, wins, gamesPlayed, roundsSurvived, bestTitle, unlocked)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(clientId) DO UPDATE SET
              userId=excluded.userId, mergedInto=excluded.mergedInto,
              name=excluded.name, marbles=excluded.marbles, wins=excluded.wins,
              gamesPlayed=excluded.gamesPlayed, roundsSurvived=excluded.roundsSurvived,
              bestTitle=excluded.bestTitle, unlocked=excluded.unlocked`,
      args: [r.clientId, r.userId, r.mergedInto, r.name, r.marbles, r.wins, r.gamesPlayed, r.roundsSurvived, r.bestTitle, r.unlocked],
    });
  } else {
    memory.set(r.clientId, r);
  }
}

export async function getOrCreateProfile(clientId: string, name: string): Promise<ProfileSummary> {
  await initDb();
  let row = await loadRow(clientId);
  if (!row) {
    row = defaultRow(clientId, name);
    await saveRow(row);
  } else if (name && row.name !== name) {
    row.name = name;
    await saveRow(row);
  }
  return rowToSummary(row);
}

export async function setProfileName(clientId: string, name: string): Promise<void> {
  await initDb();
  const row = (await loadRow(clientId)) ?? defaultRow(clientId, name);
  row.name = name;
  await saveRow(row);
}

// Hard-delete a player's game profile (marbles, wins, unlocks — everything) when
// their account is deleted. Called from Better Auth's deleteUser.beforeDelete
// hook so account removal also wipes progress, leaving nothing behind. Keyed by
// the account profile key (acct_<userId>); matches on either the key or the
// userId column to catch any stray rows. Idempotent — a no-op if nothing exists.
export async function deleteAccountData(userId: string): Promise<void> {
  await initDb();
  const key = "acct_" + userId;
  if (client) {
    await client.execute({
      sql: "DELETE FROM profiles WHERE clientId = ? OR userId = ?",
      args: [key, userId],
    });
  } else {
    memory.delete(key);
    for (const [k, v] of memory) if (v.userId === userId) memory.delete(k);
  }
}

function parseList(s: string): string[] {
  try {
    const v = JSON.parse(s || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// One-time fold of a guest profile into an account. Idempotent: a guest row is
// stamped `mergedInto` once consumed, so repeat logins never double-count.
export async function mergeGuestIntoAccount(
  userId: string,
  guestClientId: string,
  name: string,
): Promise<ProfileSummary> {
  await initDb();
  const acctKey = "acct_" + userId;
  const acct = (await loadRow(acctKey)) ?? defaultRow(acctKey, name);

  const guest =
    guestClientId && guestClientId !== acctKey ? await loadRow(guestClientId) : null;

  // Fold only a fresh, unspent guest row. Otherwise this is a clean no-op.
  if (guest && !guest.mergedInto) {
    const acctHadWins = acct.wins > 0;
    acct.marbles += guest.marbles;
    acct.wins += guest.wins;
    acct.gamesPlayed += guest.gamesPlayed;
    acct.roundsSurvived += guest.roundsSurvived;
    acct.unlocked = JSON.stringify([
      ...new Set([...parseList(acct.unlocked), ...parseList(guest.unlocked)]),
    ]);
    // Inherit the guest's earned title only if the account hasn't won anything yet.
    if (!acctHadWins && guest.wins > 0) acct.bestTitle = guest.bestTitle;

    // Spend the guest row: stamp the guard AND zero its transferable progress so
    // the value lives only on the account (no double-count, and the guest reverts
    // to a clean slate on sign-out).
    guest.mergedInto = acctKey;
    guest.marbles = 0;
    guest.wins = 0;
    guest.gamesPlayed = 0;
    guest.roundsSurvived = 0;
    guest.bestTitle = "Fresh Blob";
    guest.unlocked = JSON.stringify(FREE_CHARACTERS);
    await saveRow(guest);
  }

  if (name) acct.name = name;
  await saveRow(acct);
  return rowToSummary(acct);
}

export interface SeriesReward {
  clientId: string;
  name: string;
  marbles: number; // contestants: earned this series; spectators: net wager swing (signed)
  won: boolean;
  roundsSurvived: number;
  title: string;
  // A gallery spectator: only their Marble swing is banked. They didn't compete,
  // so this never bumps gamesPlayed / wins / roundsSurvived / title.
  spectator?: boolean;
}

export async function recordSeries(rewards: SeriesReward[]): Promise<void> {
  await initDb();
  for (const rw of rewards) {
    const row = (await loadRow(rw.clientId)) ?? defaultRow(rw.clientId, rw.name);
    row.name = rw.name || row.name;
    // Marbles always apply (a spectator's swing can be negative); never let a
    // string of bad bets drive the bank below zero.
    row.marbles = Math.max(0, row.marbles + rw.marbles);
    if (!rw.spectator) {
      row.wins += rw.won ? 1 : 0;
      row.gamesPlayed += 1;
      row.roundsSurvived += rw.roundsSurvived;
      if (rw.won) row.bestTitle = rw.title;
    }
    // auto-unlock characters as marbles cross thresholds is handled client-side
    await saveRow(row);
  }
}

// Buy any cosmetic (a character OR an accessory — ownership is one shared list of
// ids). Idempotent: re-buying something already owned is a no-op, never a second
// charge. Generic by design so the single /api/unlock endpoint prices both.
export async function unlockCosmetic(clientId: string, cosmeticId: string, cost: number): Promise<ProfileSummary | { error: string }> {
  await initDb();
  const row = (await loadRow(clientId)) ?? defaultRow(clientId, "Blob");
  const unlocked = JSON.parse(row.unlocked || "[]");
  if (unlocked.includes(cosmeticId)) return rowToSummary(row);
  if (row.marbles < cost) return { error: "Not enough Marbles. Survive more, die less." };
  row.marbles -= cost;
  unlocked.push(cosmeticId);
  row.unlocked = JSON.stringify(unlocked);
  await saveRow(row);
  return rowToSummary(row);
}

export interface LeaderRow {
  name: string;
  marbles: number;
  wins: number;
  gamesPlayed: number;
  bestTitle: string;
}

// ---- Player feedback ----------------------------------------------------
export interface StoredFeedback {
  createdAt: string; // ISO timestamp
  category: string;
  message: string;
  email: string | null;
  context: string | null;
  clientId: string | null;
}

export async function saveFeedback(fb: StoredFeedback): Promise<void> {
  await initDb();
  if (client) {
    await client.execute({
      sql: "INSERT INTO feedback (createdAt, category, message, email, context, clientId) VALUES (?, ?, ?, ?, ?, ?)",
      args: [fb.createdAt, fb.category, fb.message, fb.email, fb.context, fb.clientId],
    });
  } else {
    feedbackMemory.push(fb);
  }
}

// Most-recent feedback first. Reads from the DB when configured, else the
// in-memory fallback — so callers (and tests) don't care which store is active.
export async function recentFeedback(limit = 20): Promise<StoredFeedback[]> {
  await initDb();
  if (client) {
    const res = await client.execute({
      sql: "SELECT createdAt, category, message, email, context, clientId FROM feedback ORDER BY id DESC LIMIT ?",
      args: [limit],
    });
    return res.rows.map((r: any) => ({
      createdAt: r.createdAt,
      category: r.category,
      message: r.message,
      email: r.email ?? null,
      context: r.context ?? null,
      clientId: r.clientId ?? null,
    }));
  }
  return [...feedbackMemory].slice(-limit).reverse();
}

// Only real players belong on the board: accounts (clientId "acct_…") and browser
// guests (clientId "c_…", minted in lib/client/net.ts). Everything else is a
// non-player row — bots ("botc_…") and simulation/smoke-test fixtures ("s_…",
// "v_…", "smoke_…", etc.) — and must never be ranked. recordSeries already skips
// bots at write time; this is the read-side guard that also keeps any stray
// synthetic rows out of the standings.
function isRealPlayerKey(clientId: string): boolean {
  return clientId.startsWith("acct_") || clientId.startsWith("c_");
}

export async function leaderboard(limit = 25): Promise<LeaderRow[]> {
  await initDb();
  if (client) {
    const res = await client.execute({
      // Skip guest rows whose progress was merged into an account (their marbles
      // now live on the account row — counting both would double-list a player),
      // and keep only real-player keys (escaped LIKE so "_" stays literal).
      sql: `SELECT name, marbles, wins, gamesPlayed, bestTitle FROM profiles
            WHERE mergedInto IS NULL
              AND (clientId LIKE 'acct\\_%' ESCAPE '\\' OR clientId LIKE 'c\\_%' ESCAPE '\\')
            ORDER BY marbles DESC, wins DESC LIMIT ?`,
      args: [limit],
    });
    return res.rows.map((r: any) => ({
      name: r.name,
      marbles: Number(r.marbles),
      wins: Number(r.wins),
      gamesPlayed: Number(r.gamesPlayed),
      bestTitle: r.bestTitle,
    }));
  }
  return [...memory.values()]
    .filter((r) => !r.mergedInto && isRealPlayerKey(r.clientId))
    .sort((a, b) => b.marbles - a.marbles || b.wins - a.wins)
    .slice(0, limit)
    .map((r) => ({ name: r.name, marbles: r.marbles, wins: r.wins, gamesPlayed: r.gamesPlayed, bestTitle: r.bestTitle }));
}
