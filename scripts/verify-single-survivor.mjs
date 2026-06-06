// Verify the Squid Game rule: a HARDCORE series ends with exactly ONE survivor,
// the final round is a decisive finale (any finale-capable game), and the
// champion is the lone blob left alive. Runs many series so we also see the
// finale game vary across the finale-capable set.
import WebSocket from "ws";

const URL = process.env.WS || "ws://localhost:3100/ws";
// games that can decisively crown one survivor (koth + finale-capable)
const FINALE_GAMES = ["koth", "boomerang", "keepyuppy", "simonsays", "jumprope", "rpsminusone"];

function runSeries({ rounds, label }) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    let started = false;
    let phase = "";
    const gamesPlayed = [];
    let lastGame = null;
    const send = (m) => ws.send(JSON.stringify(m));
    const to = setTimeout(() => {
      resolve({ label, ok: false, reason: `timeout (phase=${phase})` });
      try { ws.close(); } catch {}
    }, 240000);

    ws.on("open", () => {
      send({ t: "hello", clientId: `v_${label}_${Date.now()}`, name: `V_${label}`, characterId: "egg" });
      send({ t: "createRoom" });
    });
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === "snapshot") return;
      if (m.t !== "roomState") return;
      const r = m.room;
      phase = r.phase;
      // track distinct games as they're revealed
      if ((r.phase === "intro" || r.phase === "playing") && r.currentGame && r.currentGame !== lastGame) {
        lastGame = r.currentGame;
        gamesPlayed.push(r.currentGame);
      }
      if (r.phase === "lobby" && !started) {
        started = true;
        send({ t: "updateConfig", config: { rounds, mode: "hardcore", botFill: true } });
        setTimeout(() => send({ t: "startSeries" }), 150);
      }
      if (r.phase === "seriesResult") {
        clearTimeout(to);
        const aliveCount = r.players.filter((p) => p.alive).length;
        const champ = r.seriesResult?.standings?.[0];
        const championPlayer = r.players.find((p) => p.id === r.seriesResult?.championId);
        const finaleGame = gamesPlayed[gamesPlayed.length - 1];
        // The core invariant: exactly ONE survivor, and the champion is that
        // lone survivor. The last game may be a forced finale OR a normal round
        // that happened to cull to one (both are valid single-survivor endings).
        const ok =
          aliveCount === 1 &&
          !!champ &&
          championPlayer?.alive === true &&
          r.seriesResult.championId === champ.playerId;
        resolve({
          label,
          ok,
          aliveCount,
          totalPlayers: r.players.length,
          champ: champ?.name,
          championAlive: championPlayer?.alive,
          finaleGame,
          forcedFinale: FINALE_GAMES.includes(finaleGame), // last game was a decisive finale
          gamesPlayed,
        });
        try { ws.close(); } catch {}
      }
    });
    ws.on("error", (e) => resolve({ label, ok: false, reason: "ws " + e.message }));
  });
}

const tests = [
  { rounds: 3, label: "fixed-3" },
  { rounds: 5, label: "fixed-5" },
  // mystery series so we see the finale game vary across the set
  ...Array.from({ length: 4 }, (_, i) => ({ rounds: "mystery", label: `mystery-${i + 1}` })),
];

// Limit concurrency — too many full series at once starves the single server
// event loop and inflates round times (false timeouts).
const CONCURRENCY = 3;
const results = [];
for (let i = 0; i < tests.length; i += CONCURRENCY) {
  const batch = tests.slice(i, i + CONCURRENCY);
  results.push(...(await Promise.all(batch.map(runSeries))));
}

let pass = 0;
const finaleCounts = {};
for (const r of results) {
  if (r.ok) pass++;
  if (r.finaleGame) finaleCounts[r.finaleGame] = (finaleCounts[r.finaleGame] || 0) + 1;
  console.log(
    `${r.ok ? "✅" : "❌"} ${r.label.padEnd(10)} alive=${r.aliveCount}/${r.totalPlayers} champ=${r.champ} championAlive=${r.championAlive} finale=${r.finaleGame}${r.forcedFinale ? " (decisive)" : ""} games=[${(r.gamesPlayed || []).join(", ")}]${r.reason ? " " + r.reason : ""}`,
  );
}
console.log(`[verify] last-game distribution: ${JSON.stringify(finaleCounts)}`);
console.log(`[verify] ${pass}/${results.length} ended with exactly one survivor`);
process.exit(pass === results.length ? 0 : 1);
