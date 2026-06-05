// End-to-end smoke test: connect over WS, create a room, run a full series with
// bots, and assert the whole loop advances through games to a champion.
import WebSocket from "ws";

const URL = process.env.WS || "ws://localhost:3100/ws";
const ws = new WebSocket(URL);
const log = (...a) => console.log("[smoke]", ...a);

let phase = "";
let gamesSeen = new Set();
let snapCount = 0;
let lastGame = null;
let done = false;

function send(m) {
  ws.send(JSON.stringify(m));
}

const timeout = setTimeout(() => {
  console.error("[smoke] TIMEOUT — did not finish series in time");
  finish(1);
}, 180000);

function finish(code) {
  if (done) return;
  done = true;
  clearTimeout(timeout);
  log(`games played: ${[...gamesSeen].join(", ")}`);
  log(`snapshots received: ${snapCount}`);
  try { ws.close(); } catch {}
  setTimeout(() => process.exit(code), 200);
}

ws.on("open", () => {
  log("connected");
  send({ t: "hello", clientId: "smoke_" + Date.now(), name: "Tester", characterId: "avo" });
  send({ t: "createRoom" });
});

ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === "snapshot") {
    snapCount++;
    if (m.snap?.game) gamesSeen.add(m.snap.game);
    return;
  }
  if (m.t === "roomState") {
    const r = m.room;
    if (r.phase !== phase) {
      phase = r.phase;
      log(`phase -> ${phase}${r.currentGame ? " (" + r.currentGame + ")" : ""} aliveKnown=${r.totalRoundsKnown} round=${r.roundIndex + 1}`);
    }
    // configure + start once
    if (r.phase === "lobby" && r.hostId && !r._started) {
      r._started = true;
      if (!global._started) {
        global._started = true;
        send({ t: "updateConfig", config: { rounds: 3, mode: "hardcore", botFill: true } });
        setTimeout(() => send({ t: "startSeries" }), 200);
        log("started series (3 games, hardcore, bot-fill)");
      }
    }
    if (r.phase === "seriesResult" && r.seriesResult) {
      const champ = r.seriesResult.standings[0];
      log(`🏆 CHAMPION: ${champ.name} (${champ.title}) with ${champ.marbles} marbles`);
      log(`standings: ${r.seriesResult.standings.length} blobs ranked`);
      const ok = gamesSeen.size >= 1 && r.seriesResult.standings.length >= 2;
      log(ok ? "RESULT: PASS ✅" : "RESULT: FAIL ❌");
      finish(ok ? 0 : 1);
    }
  }
  if (m.t === "error") log("server error:", m.message);
});

ws.on("error", (e) => {
  console.error("[smoke] ws error", e.message);
  finish(1);
});
