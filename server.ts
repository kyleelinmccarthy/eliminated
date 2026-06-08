// Combined Next.js + WebSocket game server. One process, one port — deployable
// to Railway as a single service. (For a split deploy, point NEXT_PUBLIC_WS_URL
// at this server and host the Next build separately.)
//
// MUST be first: loads .env into process.env before db.ts/auth.ts (which read
// DATABASE_URL at boot) evaluate, so this context uses the same DB as Next does.
import "./lib/server/load-env";
import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { WebSocketServer, type WebSocket } from "ws";
import { roomManager } from "./lib/server/RoomManager";
import { initDb } from "./lib/server/db";
import { WS_PATH } from "./lib/shared/protocol";
import { auth, ensureAuthSchema } from "./lib/server/auth";
import { fromNodeHeaders } from "better-auth/node";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
const hostname = process.env.HOST || "0.0.0.0";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

interface Beating extends WebSocket {
  isAlive?: boolean;
}

async function main() {
  await initDb();
  // Self-heal Better Auth's tables on boot so a fresh deploy doesn't 500 on the
  // first sign-in. Non-fatal: accounts are optional, so the game still runs even
  // if this can't reach the DB.
  await ensureAuthSchema().catch((err) =>
    console.warn("[auth] schema migration skipped:", (err as Error).message),
  );
  await app.prepare();
  const upgradeHandler = app.getUpgradeHandler();

  const server = createServer((req, res) => {
    handle(req, res, parse(req.url || "", true));
  });

  const wss = new WebSocketServer({ noServer: true });

  // Carries the verified account id from the upgrade (where the cookie lives) to
  // the `connection` handler (where the ws first exists). WeakMap → no leaks.
  const pendingUser = new WeakMap<object, string | null>();

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url || "");
    if (pathname === WS_PATH) {
      const complete = (userId: string | null) =>
        wss.handleUpgrade(req, socket, head, (ws) => {
          pendingUser.set(ws, userId);
          wss.emit("connection", ws, req);
        });
      // Resolve the optional session from the handshake cookies before finishing
      // the upgrade, so the socket is trusted from its first tick. Any auth
      // failure falls through to an anonymous (guest) upgrade — guests never break.
      auth.api
        .getSession({ headers: fromNodeHeaders(req.headers) })
        .then((session) => complete(session?.user?.id ?? null))
        .catch(() => complete(null));
    } else {
      // Next.js dev HMR + any other upgrades
      upgradeHandler(req, socket, head);
    }
  });

  wss.on("connection", (ws: Beating) => {
    const userId = pendingUser.get(ws) ?? null;
    pendingUser.delete(ws);
    ws.isAlive = true;
    ws.on("pong", () => (ws.isAlive = true));
    roomManager.onConnect(ws, userId);
    ws.on("message", (data) => {
      try {
        roomManager.onMessage(ws, data.toString());
      } catch (e) {
        console.error("[ws] message error", e);
      }
    });
    ws.on("close", () => roomManager.onClose(ws));
    ws.on("error", () => roomManager.onClose(ws));
  });

  // terminate dead sockets
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients as Set<Beating>) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }
  }, 30000);

  roomManager.start();

  server.listen(port, hostname, () => {
    console.log(`\n  💀  Eliminated is live → http://localhost:${port}\n`);
  });

  const shutdown = () => {
    clearInterval(heartbeat);
    roomManager.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
