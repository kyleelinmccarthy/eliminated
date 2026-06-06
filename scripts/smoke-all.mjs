// Force each game in its own room (in parallel) and confirm each one runs
// start-to-finish without error. Also confirms multiple concurrent rooms.
import WebSocket from "ws";

const URL = process.env.WS || "ws://localhost:3100/ws";
const GAMES = ["redlight", "tag", "mingle", "glassbridge", "tugofwar", "rpsminusone", "jumprope", "boomerang", "dodgeball", "musicalchairs", "present", "prophunt", "chutesladders", "simonsays", "keepyuppy", "koth"];
const results = {};
let remaining = GAMES.length;

function runGame(game) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    let started = false;
    let phase = "";
    let snaps = 0;
    let errored = null;
    const send = (m) => ws.send(JSON.stringify(m));
    const to = setTimeout(() => {
      results[game] = { ok: false, reason: `timeout (phase=${phase}, snaps=${snaps})` };
      try { ws.close(); } catch {}
      resolve();
    }, 100000);

    ws.on("open", () => {
      send({ t: "hello", clientId: `s_${game}_${Date.now()}`, name: `T_${game}`, characterId: "egg" });
      send({ t: "createRoom" });
    });
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === "snapshot") { snaps++; return; }
      if (m.t === "error") errored = m.message;
      if (m.t === "roomState") {
        const r = m.room;
        phase = r.phase;
        if (r.phase === "lobby" && !started) {
          started = true;
          // Casual so the round runs the TARGET game in isolation. In hardcore a
          // 1-round series' only round is the forced King-of-the-Hill finale, so
          // every room would test koth instead of its assigned game.
          send({ t: "updateConfig", config: { rounds: 1, mode: "casual", botFill: true, allowedGames: [game] } });
          setTimeout(() => send({ t: "startSeries" }), 150);
        }
        if (r.phase === "seriesResult") {
          clearTimeout(to);
          const champ = r.seriesResult?.standings?.[0];
          results[game] = {
            ok: !!champ && !errored,
            snaps,
            champ: champ?.name,
            playedRight: r.lastResult ? true : true,
            err: errored,
          };
          try { ws.close(); } catch {}
          resolve();
        }
      }
    });
    ws.on("error", (e) => {
      results[game] = { ok: false, reason: "ws " + e.message };
      clearTimeout(to);
      resolve();
    });
  });
}

console.log("[smoke-all] launching", GAMES.length, "parallel rooms…");
await Promise.all(GAMES.map(runGame));

let pass = 0;
for (const g of GAMES) {
  const r = results[g] || { ok: false, reason: "no result" };
  if (r.ok) pass++;
  console.log(`  ${r.ok ? "✅" : "❌"} ${g.padEnd(12)} ${r.ok ? `champ=${r.champ} snaps=${r.snaps}` : "FAIL: " + (r.reason || r.err || "?")}`);
}
console.log(`[smoke-all] ${pass}/${GAMES.length} games passed`);
process.exit(pass === GAMES.length ? 0 : 1);
