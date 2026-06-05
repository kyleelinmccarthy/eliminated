# ◖◗ ELIMINATED

**A wholesome party game where everyone dies.** We watched a show about debt and a show about throwing boomerangs, legally distinct'd the whole thing, and replaced the cast with adorable blobs so the carnage would test better. Childhood playground games meet _Squid Game_ stakes and _Boomerang Fu_ chaos. A sinister Game Master runs the gauntlet; your blob runs out of luck. Get eliminated and your blob is neatly boxed up with a little pink bow on top. The last blob standing keeps the **Marbles** ◍ and a fistful of bragging rights that, legally, are worth nothing.

Built with **Next.js + React** on top of an **authoritative WebSocket game server** that has never once felt remorse. Real-time online multiplayer with host-able rooms (join by code), bots to fill the lobby with the willing, persistent currency, and a leaderboard for the survivors to gloat from.

---

## ✨ What's in the box (besides regret)

- **12 deadly minigames**, each with full bot AI so the bodies are never in short supply:
  | Game | Vibe | Controls |
  |---|---|---|
  | 🚦 Red Light, Green Light | Move on green, freeze on red — the Doll does not do warnings | Move |
  | ❄️ Freeze Tag | Two teams: freeze your foes, thaw your friends, sob at the buzzer | Move |
  | 🫂 Mingle | Cram into a room with _exactly_ the right headcount — networking, but lethal | Move |
  | 🪟 Glass Stepping Stones | Pick the tempered tile, or learn to fly | ← / → |
  | 🪢 Tug of War | Mash to pull — the losing team tests gravity | Mash |
  | ✊ RPS Minus One | Throw two hands, drop one, outthink a stranger or die trying | Click |
  | 🤸 Killer Jump Rope | Jump in rhythm — the rope is patient, you are not | Tap / Space |
  | 🪃 Boomerang Brawl | Free-for-all with questionable powerups — last blob standing | Move + aim/throw/dash |
  | 🤾 Dodgeball | Two teams, a tasteful hail of rubber — peg the other side, dash to dodge | Move + aim/throw/dash |
  | 🪑 Musical Chairs | When the music stops, grab a seat — or grab a clue | Move |
  | 🎁 Secret Santa Sabotage | Gifts in the dark; guess your giver or pay for the gesture | Tap |
  | 🌋 King of Lava Island | **The finale** — floor-is-lava + a shrinking island; last blob crowns a puddle | Move |
- **The Game Master** reveals a **mystery** sequence of games — you never know which is next, or (optionally) how many remain. The not-knowing is part of the package.
- **Two death rules:** _Hardcore_ (one elimination = dead for the whole series, spectate the rest from the great beyond) and _Casual_ (respawn each round and pretend it never happened, win on points).
- **Series-aware pacing:** the Game Master opens gently and ramps up — the truly brutal games (and the lava finale) are saved for later, so the first round never wipes the lobby. Even cruelty has standards.
- **🌙 Night Mode** (a Hardcore extra): random rounds plunge into darkness so you can't see what kills you — navigate by flashlight and hunt for 🔦 Lanterns to watch it happen in more detail.
- **16 blob characters** (avocados, foxes, wizards, sushi…), all drawn procedurally on canvas — no art assets, no budget, no apologies. Unlock fancier ones with Marbles; they do not improve your odds, only the optics of your demise.
- **6 themed arenas** picked at random each round (Sakura Courtyard, Neon Sewer Disco, Haunted Playground…), because a little ambiance softens the body count.
- **Powerups** scattered across the movement games — good _and_ bad, à la Boomerang Fu, because greed should be punishable: ⚡ Zoomies, 🛡️ Bubble, 🔻 Shrink, 🔦 Lantern… plus curses like 🌀 **Bamboozled** (reversed controls!), 🐌 Molasses, 🎈 Embiggen, 💫 Dizzy. (The Brawl keeps its own ✨ multishot, 🪃 big-rang, 🧲 magnet too.)
- **Bots** with per-game AI, so you can play solo or fill out a lobby with the kind of friends who never text you back.
- **Juice:** squash-and-stretch animations, particles, confetti, screen shake, and fully **procedural sound effects + music** (Web Audio, no audio files). The screams are free.
- **Persistent profiles, currency & a global leaderboard** (the "Hall of Blobs") — the only thing here that outlives the players.
- Works on desktop (keyboard + mouse) and touch (on-screen joystick + buttons).

## 🚀 Run it locally

```bash
npm install
npm run dev          # http://localhost:3000
```

That's it. `npm run dev` boots a single process that serves **both** the Next.js app and the WebSocket game server on the same port. Open the URL, create a room, and either share the 4-letter code with friends or flip on **bot-fill** and start the proceedings.

Production:

```bash
npm run build
npm start            # serves the built app + WS server
```

### Quick self-test (no browser needed, no witnesses)

With the server running on port 3100 (`PORT=3100 npm start`):

```bash
npm run smoke        # drives a full bot series end-to-end over WS
npm run smoke:all    # runs all 12 games in parallel rooms
```

## 🧱 Architecture

```
server.ts                     Combined Next.js + ws server (one process, one port)
lib/shared/                   Types, protocol, content catalogs (shared client+server)
  characters.ts maps.ts games.ts constants.ts protocol.ts types.ts util.ts
lib/server/
  RoomManager.ts              Connections → rooms; global 20Hz tick loop
  GameRoom.ts                 Series state machine (lobby → intro → play → results)
  Player.ts  db.ts            Player model; libSQL persistence
  games/                      One authoritative module per minigame + bot AI
lib/client/
  net.ts                      WebSocket client + zustand store (snapshots kept out of React)
  audio.ts                    Procedural Web Audio SFX/music
  render/draw.ts fx.ts renderers.ts   Canvas drawing: blobs, arenas, particles, per-game scenes
app/  components/             Next App Router pages + React UI
```

**How the netcode works:** the server is authoritative — it has the final say on who lives, like all good Game Masters. It simulates every game at 20 ticks/sec and broadcasts compact JSON snapshots; clients send inputs (move/aim/tap/choose) and render by interpolating between snapshots. Bots are simulated server-side inside each game's tick, so they're indistinguishable from players on the wire. This prevents cheating and keeps everyone in sync as they go.

## ☁️ Deploying

This is a stateful, WebSocket-based game server, so it wants a **long-running Node host** (not pure serverless functions — death is a persistent state).

**Option A — single service on Railway (simplest):**
Deploy the whole repo to [Railway](https://railway.app). Build command `npm run build`, start command `npm start`. Railway supports WebSockets and long-running processes out of the box. Set `PORT` (Railway provides it). Done — the UI and game server are one service.

**Option B — split (UI on Vercel, server on Railway):**
Vercel doesn't host persistent WebSocket servers, so run `server.ts` on Railway as the game server, deploy the Next UI to Vercel, and point the client at the server with:

```
NEXT_PUBLIC_WS_URL=wss://your-game-server.up.railway.app/ws
```

### Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Server port |
| `NEXT_PUBLIC_WS_URL` | _(same origin)_ | Override the client's WS endpoint (for split deploys) |
| `DATABASE_URL` | `file:./data/eliminated.db` | libSQL/Turso URL. Local SQLite file by default |
| `DATABASE_AUTH_TOKEN` | – | Turso auth token (if using Turso) |

Persistence uses [libSQL](https://github.com/tursodatabase/libsql), so it runs on a **local SQLite file with zero config** and upgrades to **Turso** just by setting `DATABASE_URL`. If the DB can't be opened, the game falls back to an in-memory store and still runs — the show must go on.

## 🎮 Controls

- **Move:** `WASD` / Arrow keys, or the on-screen joystick (bottom-left on touch).
- **Boomerang Brawl / Dodgeball:** aim with the mouse, **click** or `Space` to throw, `Shift` to dash.
- **Glass Bridge:** `←` / `→` or the big tile buttons. Choose wisely.
- **Tug of War / Jump Rope:** mash `Space` or the giant button until your thumbs file a complaint.
- **RPS Minus One:** click your two throws, then click the one to keep.
- **Secret Santa Sabotage:** if you got a gift, tap the blob you think gave it. Trust no one.

Have fun, and try not to die. (You will die.) 🪦
