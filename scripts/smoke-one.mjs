// Run a single game in one room and report the full result, with verbose phase
// logging. Usage: node smoke-one.mjs <gameId>
import WebSocket from "ws";
const URL = process.env.WS || "ws://localhost:3100/ws";
const game = process.argv[2] || "prophunt";
const ws = new WebSocket(URL);
let started = false, phase = "", snaps = 0, errored = null;
let lastData = null;
const send = (m) => ws.send(JSON.stringify(m));
const to = setTimeout(() => { console.log(`TIMEOUT phase=${phase} snaps=${snaps}`); process.exit(1); }, 90000);

ws.on("open", () => {
  send({ t: "hello", clientId: `one_${game}_${Date.now()}`, name: `T_${game}`, characterId: "egg" });
  send({ t: "createRoom" });
});
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === "snapshot") {
    snaps++;
    if (m.snap?.game === game) lastData = m.snap.data;
    return;
  }
  if (m.t === "error") { errored = m.message; console.log("SERVER ERROR:", m.message); }
  if (m.t === "roomState") {
    const r = m.room;
    if (r.phase !== phase) {
      phase = r.phase;
      console.log(`phase -> ${phase}${r.currentGame ? " (" + r.currentGame + ")" : ""}`);
    }
    if (r.phase === "lobby" && !started) {
      started = true;
      send({ t: "updateConfig", config: { rounds: 1, mode: "hardcore", botFill: true, allowedGames: [game] } });
      setTimeout(() => send({ t: "startSeries" }), 150);
    }
    if (r.phase === "roundResult" && r.lastResult) {
      console.log("ROUND RESULT:", JSON.stringify(r.lastResult.entries.map((e) => ({ p: e.placement, surv: e.survived, note: e.note })), null, 0));
      console.log("survivors:", r.lastResult.survivorIds.length, "of", r.lastResult.entries.length);
      console.log("last prophunt data:", JSON.stringify(lastData));
    }
    if (r.phase === "seriesResult") {
      clearTimeout(to);
      const champ = r.seriesResult?.standings?.[0];
      console.log(`DONE ok=${!!champ && !errored} champ=${champ?.name} snaps=${snaps}`);
      process.exit(!!champ && !errored ? 0 : 1);
    }
  }
});
ws.on("error", (e) => { console.log("WS ERROR", e.message); process.exit(1); });
