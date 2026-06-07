// Repro for the home-page identity bug: a client changes name/character BEFORE
// hosting (the same order the Landing page sends them in), then creates a room.
// The created player must reflect the changed identity, not the hello-time one.
import WebSocket from "ws";

const URL = process.env.WS || "ws://localhost:3100/ws";
const ws = new WebSocket(URL);
const log = (...a) => console.log("[id]", ...a);
const send = (m) => ws.send(JSON.stringify(m));

const HELLO_NAME = "OldName";
const HELLO_CHAR = "avo";
const NEW_NAME = "NewName";
const NEW_CHAR = "bunny";

let done = false;
function finish(code, why) {
  if (done) return;
  done = true;
  log(why);
  log(code === 0 ? "RESULT: PASS ✅" : "RESULT: FAIL ❌");
  try { ws.close(); } catch {}
  setTimeout(() => process.exit(code), 150);
}
const timeout = setTimeout(() => finish(1, "TIMEOUT — never saw a lobby with us in it"), 8000);

ws.on("open", () => {
  log("connected");
  // 1) hello carries the page-load identity
  send({ t: "hello", clientId: "idtest_" + Date.now(), name: HELLO_NAME, characterId: HELLO_CHAR });
  // 2) user edits name + picks a character on the home page (no room yet)
  send({ t: "setName", name: NEW_NAME });
  send({ t: "setCharacter", characterId: NEW_CHAR });
  // 3) user clicks Host — Landing also re-sends setIdentity right before this
  send({ t: "setName", name: NEW_NAME });
  send({ t: "setCharacter", characterId: NEW_CHAR });
  send({ t: "createRoom" });
});

ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === "roomState") {
    const me = m.room.players.find((p) => !p.isBot);
    if (!me) return;
    clearTimeout(timeout);
    log(`lobby player: name=${me.name} characterId=${me.characterId}`);
    const ok = me.name === NEW_NAME && me.characterId === NEW_CHAR;
    finish(ok ? 0 : 1, ok
      ? "identity persisted into lobby"
      : `expected ${NEW_NAME}/${NEW_CHAR}, got ${me.name}/${me.characterId}`);
  }
  if (m.t === "error") log("server error:", m.message);
});

ws.on("error", (e) => finish(1, "ws error: " + e.message));
