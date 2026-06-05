// Per-game canvas rendering. Arena games interpolate actor positions; discrete
// games draw their own stylized layouts from snapshot.data.
import type { Snapshot, Actor } from "../../shared/types";
import { ARENA_W, ARENA_H, PLAYER_RADIUS } from "../../shared/constants";
import { getMap } from "../../shared/maps";
import { drawArena, drawBlob, drawShadow, drawProp, drawSword } from "./draw";
import type { FxSystem } from "./fx";
import { POWERUP_ICONS, POWERUPS } from "../../shared/powerups";
import { glassChoice } from "../glass";

// Team accent colors (freeze tag / dodgeball)
const TEAM_COLORS = ["#29b6f6", "#ff6f9c"];

export interface RenderCtx {
  youId: string | null;
  time: number;
  fx: FxSystem;
  mapId: string | null;
  numbers?: Map<string, number>; // playerId -> Squid Game number
  deaths?: Map<string, number>; // actorId -> client time (ms) first seen dead, for the coffin drop-in
}

interface Fit {
  s: number;
  ox: number;
  oy: number;
}
function fit(W: number, H: number): Fit {
  const s = Math.min(W / ARENA_W, H / ARENA_H);
  return { s, ox: (W - ARENA_W * s) / 2, oy: (H - ARENA_H * s) / 2 };
}

const ARENA_GAMES = new Set(["redlight", "tag", "mingle", "boomerang", "dodgeball", "musicalchairs", "prophunt", "koth"]);

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function interpActors(cur: Snapshot, prev: Snapshot | null, alpha: number): Actor[] {
  if (!prev || !prev.actors || prev.game !== cur.game) return cur.actors || [];
  const pmap = new Map(prev.actors.map((a) => [a.id, a]));
  return (cur.actors || []).map((a) => {
    const p = pmap.get(a.id);
    if (!p) return a;
    return { ...a, x: lerp(p.x, a.x, alpha), y: lerp(p.y, a.y, alpha), facing: a.facing };
  });
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  cur: Snapshot,
  prev: Snapshot | null,
  alpha: number,
  rc: RenderCtx,
) {
  ctx.clearRect(0, 0, W, H);
  if (ARENA_GAMES.has(cur.game)) {
    renderArena(ctx, W, H, cur, prev, alpha, rc);
  } else if (cur.game === "glassbridge") {
    renderGlass(ctx, W, H, cur, rc);
  } else if (cur.game === "tugofwar") {
    renderTug(ctx, W, H, cur, rc);
  } else if (cur.game === "rpsminusone") {
    renderRps(ctx, W, H, cur, rc);
  } else if (cur.game === "jumprope") {
    renderJump(ctx, W, H, cur, rc);
  } else if (cur.game === "present") {
    renderParlor(ctx, W, H, cur, prev, alpha, rc);
  }
}

// =================== ARENA (redlight / tag / mingle / boomerang) ===================
function renderArena(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  cur: Snapshot,
  prev: Snapshot | null,
  alpha: number,
  rc: RenderCtx,
) {
  const f = fit(W, H);
  const shake = rc.fx.shake;
  const sx = shake ? (Math.random() - 0.5) * shake : 0;
  const sy = shake ? (Math.random() - 0.5) * shake : 0;
  ctx.save();
  ctx.translate(f.ox + sx, f.oy + sy);
  ctx.scale(f.s, f.s);

  const map = getMap(rc.mapId);
  drawArena(ctx, map, ARENA_W, ARENA_H, rc.time);

  const d = cur.data || {};

  // --- game-specific ground layer (under the blobs) ---
  if (cur.game === "redlight") drawRedlightGround(ctx, d, rc.time);
  if (cur.game === "mingle") drawMingleGround(ctx, d, rc.time);
  if (cur.game === "koth") drawLava(ctx, d, rc.time);
  if (cur.game === "dodgeball") drawDodgeballFloor(ctx, d);
  if (cur.game === "musicalchairs") drawChairs(ctx, d, rc.time);
  if (d.pickups && d.pickups.length) drawPickups(ctx, d, rc.time);

  // --- actors ---
  const actors = interpActors(cur, prev, alpha);
  if (cur.game === "prophunt") {
    // props + disguised hiders + seeker, all depth-sorted together so a still
    // hider can't be told from the furniture by draw order
    drawProphuntField(ctx, d, actors, rc);
  } else {
    actors.sort((a, b) => a.y - b.y);
    for (const a of actors) {
      // eliminated blobs are boxed up Squid Game-style instead of lying around
      if (!a.alive) {
        drawCoffin(ctx, a.x, a.y, a.scale ?? 1, rc.time, coffinAge(rc, a.id));
        continue;
      }
      // team accent ring under the blob (freeze tag / dodgeball)
      if ((cur.game === "tag" || cur.game === "dodgeball") && a.team != null) {
        drawTeamRing(ctx, a.x, a.y, a.scale ?? 1, TEAM_COLORS[a.team] || "#fff");
      }
      drawBlob(ctx, a.characterId, a.x, a.y, {
        r: PLAYER_RADIUS,
        facing: a.facing,
        anim: a.anim || "idle",
        scale: a.scale ?? 1,
        it: a.it,
        shield: a.shield,
        ghost: a.ghost,
        flash: a.flash,
        time: rc.time,
        name: a.name,
        number: rc.numbers?.get(a.id),
        you: a.id === rc.youId,
      });
      if (a.burning) drawFlames(ctx, a.x, a.y, a.scale ?? 1, rc.time);
      if (a.frozen) drawFrozen(ctx, a.x, a.y, a.scale ?? 1, rc.time);
      if (cur.game === "koth" && a.id === d.kingId) drawCrown(ctx, a.x, a.y, a.scale ?? 1, rc.time);
    }

    // --- boomerangs ---
    if (cur.game === "boomerang" && d.rangs) {
      for (const r of d.rangs) drawRang(ctx, r.x, r.y, r.spin, r.big);
    }
    // --- dodgeballs (over the blobs) ---
    if (cur.game === "dodgeball" && d.balls) {
      for (const b of d.balls) drawBall(ctx, b.x, b.y, b.state);
    }
  }

  // fx in arena space
  rc.fx.draw(ctx);

  ctx.restore();

  // night mode: darkness with a flashlight cone around you
  if (d.night) drawNight(ctx, W, H, f, actors, rc);

  // prop hunt: the Seeker's screen is blacked out while hiders disguise
  if (cur.game === "prophunt") drawProphuntSeekerView(ctx, W, H, d, actors, rc);

  // red flash overlay for lethal red light
  if (cur.game === "redlight" && d.lethal) {
    ctx.save();
    ctx.fillStyle = `rgba(255,0,30,${0.12 + 0.06 * Math.sin(rc.time * 0.02)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

// =================== PROP HUNT (deadly hide & seek) ===================
function drawProphuntField(ctx: CanvasRenderingContext2D, d: any, actors: Actor[], rc: RenderCtx) {
  const phase = d.phase;
  const seekerId = d.seekerId;
  const hunting = phase === "hunt";
  type Ent = { y: number; draw: () => void };
  const ents: Ent[] = [];

  // decoys — identical to a disguised, motionless hider
  for (const dc of d.decoys || []) {
    ents.push({ y: dc.y, draw: () => drawProp(ctx, dc.kind, dc.x, dc.y, { time: rc.time }) });
  }

  for (const a of actors) {
    if (!a.alive) {
      ents.push({ y: a.y, draw: () => drawCoffin(ctx, a.x, a.y, a.scale ?? 1, rc.time, coffinAge(rc, a.id)) });
      continue;
    }
    const youAreThis = a.id === rc.youId;
    if (a.id === seekerId) {
      ents.push({
        y: a.y,
        draw: () => {
          drawBlob(ctx, a.characterId, a.x, a.y, {
            r: PLAYER_RADIUS,
            facing: a.facing,
            anim: a.anim || "idle",
            scale: a.scale ?? 1,
            it: true,
            time: rc.time,
            name: a.name,
            number: rc.numbers?.get(a.id),
            you: youAreThis,
          });
          drawSword(ctx, a.x, a.y, a.facing ?? 0, a.scale ?? 1, a.progress ?? 0);
        },
      });
    } else if (hunting && a.carrying) {
      // disguised hider: drawn exactly like a decoy. The only tell is the
      // twitch from moving (wobble scales with current speed).
      const speed = Math.hypot(a.vx ?? 0, a.vy ?? 0);
      const wobble = Math.min(1, speed / 110);
      const kind = a.carrying;
      ents.push({ y: a.y, draw: () => drawProp(ctx, kind, a.x, a.y, { time: rc.time, wobble, you: youAreThis }) });
    } else {
      // hide phase: a visible blob scurrying for cover
      ents.push({
        y: a.y,
        draw: () =>
          drawBlob(ctx, a.characterId, a.x, a.y, {
            r: PLAYER_RADIUS,
            facing: a.facing,
            anim: a.anim || "idle",
            scale: a.scale ?? 1,
            time: rc.time,
            name: a.name,
            number: rc.numbers?.get(a.id),
            you: youAreThis,
          }),
      });
    }
  }

  ents.sort((p, q) => p.y - q.y);
  for (const e of ents) e.draw();

  // in-world phase banner
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = "800 40px 'Baloo 2', sans-serif";
  if (!hunting) {
    ctx.fillStyle = "#69f0ae";
    ctx.fillText(`🫥 DISGUISE!  ${Math.ceil(d.timeLeft || 0)}`, ARENA_W / 2, 64);
  } else {
    ctx.fillStyle = "#ff5252";
    ctx.fillText("🗡️ THE HUNT", ARENA_W / 2, 64);
  }
  ctx.restore();
}

// The Seeker doesn't get to watch where everyone hides — black out their screen
// during the disguise phase (everyone else sees the blobs scurry).
function drawProphuntSeekerView(ctx: CanvasRenderingContext2D, W: number, H: number, d: any, actors: Actor[], rc: RenderCtx) {
  if (d.phase !== "hide") return;
  const me = actors.find((a) => a.id === rc.youId);
  if (!me || me.id !== d.seekerId) return;
  ctx.save();
  ctx.fillStyle = "rgba(4,4,10,0.95)";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffd54f";
  ctx.font = "800 44px 'Baloo 2', sans-serif";
  ctx.fillText("🙈 No peeking, Seeker.", W / 2, H / 2 - 26);
  ctx.font = "800 72px 'Baloo 2', sans-serif";
  ctx.fillStyle = "#fff";
  ctx.fillText(String(Math.ceil(d.timeLeft || 0)), W / 2, H / 2 + 52);
  ctx.font = "700 20px 'Baloo 2', sans-serif";
  ctx.fillStyle = "#b9a7d6";
  ctx.fillText("Sharpening the blade…", W / 2, H / 2 + 96);
  ctx.restore();
}

function drawRedlightGround(ctx: CanvasRenderingContext2D, d: any, t: number) {
  const fx = d.finishX ?? ARENA_W - 120;
  // finish zone (right strip — blobs race left→right toward it)
  ctx.save();
  ctx.fillStyle = "rgba(105,240,174,0.18)";
  ctx.fillRect(fx, 0, ARENA_W - fx, ARENA_H);
  ctx.strokeStyle = "#69f0ae";
  ctx.setLineDash([18, 14]);
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(fx, 0);
  ctx.lineTo(fx, ARENA_H);
  ctx.stroke();
  ctx.setLineDash([]);
  // FINISH label runs up the line
  ctx.save();
  ctx.translate(fx - 20, ARENA_H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = "800 30px 'Baloo 2', sans-serif";
  ctx.fillStyle = "#69f0ae";
  ctx.textAlign = "center";
  ctx.fillText("🏁 FINISH", 0, 0);
  ctx.restore();

  // the doll — stationed past the line, watching the racers
  const red = d.light === "red";
  const dollX = fx + (ARENA_W - fx) / 2;
  const dollY = ARENA_H / 2 - 10;
  ctx.translate(dollX, dollY);
  // body
  ctx.fillStyle = "#ffb74d";
  ctx.beginPath();
  ctx.moveTo(-34, 60);
  ctx.lineTo(34, 60);
  ctx.lineTo(22, -10);
  ctx.lineTo(-22, -10);
  ctx.closePath();
  ctx.fill();
  // head
  ctx.fillStyle = "#ffe0b2";
  ctx.beginPath();
  ctx.arc(0, -30, 26, 0, Math.PI * 2);
  ctx.fill();
  // hair
  ctx.fillStyle = "#4e342e";
  ctx.beginPath();
  ctx.arc(0, -36, 27, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(-30, -36, 12, 40);
  ctx.fillRect(18, -36, 12, 40);
  // eyes — glowing on red
  if (red) {
    ctx.fillStyle = "#ff1744";
    ctx.shadowColor = "#ff1744";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(-10, -30, 5, 0, Math.PI * 2);
    ctx.arc(10, -30, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  } else {
    ctx.fillStyle = "#241a33";
    ctx.beginPath();
    ctx.arc(-10, -34, 4, 0, Math.PI * 2);
    ctx.arc(10, -34, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawMingleGround(ctx: CanvasRenderingContext2D, d: any, t: number) {
  if (!d.rooms) return;
  for (const r of d.rooms) {
    const active = d.phase === "mingle" || d.phase === "flash";
    ctx.save();
    ctx.lineWidth = 6;
    ctx.strokeStyle = active ? (r.ok ? "#69f0ae" : "#ff5252") : "rgba(255,255,255,0.4)";
    ctx.fillStyle = active ? (r.ok ? "rgba(105,240,174,0.14)" : "rgba(255,82,82,0.10)") : "rgba(255,255,255,0.05)";
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (active) {
      ctx.font = "800 34px 'Baloo 2', sans-serif";
      ctx.fillStyle = r.ok ? "#69f0ae" : "#fff";
      ctx.textAlign = "center";
      ctx.fillText(`${r.count}`, r.x, r.y - r.r + 36);
    }
    ctx.restore();
  }
}

// boomerang-only kinds layered on top of the shared catalog icons
const PICKUP_ICONS: Record<string, string> = { ...POWERUP_ICONS, bigrang: "🪃", multishot: "✨", magnet: "🧲" };

function drawPickups(ctx: CanvasRenderingContext2D, d: any, t: number) {
  if (!d.pickups) return;
  for (const p of d.pickups) {
    const bad = POWERUPS[p.kind as keyof typeof POWERUPS]?.good === false;
    const bob = Math.sin(p.bob) * 6;
    ctx.save();
    ctx.translate(p.x, p.y + bob);
    ctx.fillStyle = bad ? "rgba(255,82,82,0.14)" : "rgba(255,255,255,0.14)";
    ctx.strokeStyle = bad ? "#ff5252" : "#ffd54f";
    ctx.lineWidth = 3;
    ctx.shadowColor = bad ? "#ff5252" : "#ffd54f";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.font = "24px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(PICKUP_ICONS[p.kind] || "?", 0, 1);
    ctx.restore();
  }
  ctx.textBaseline = "alphabetic";
}

function drawRang(ctx: CanvasRenderingContext2D, x: number, y: number, spin: number, big: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);
  const r = big ? 26 : 17;
  ctx.fillStyle = "#8d5524";
  ctx.strokeStyle = "#5d3a13";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, r, Math.PI * 0.15, Math.PI * 1.15);
  ctx.arc(0, 0, r * 0.55, Math.PI * 1.15, Math.PI * 0.15, true);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // motion blur arc
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = "#ffd54f";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, r + 6, 0, Math.PI * 1.6);
  ctx.stroke();
  ctx.restore();
}

// =================== GLASS BRIDGE ===================
// Client-side animation state for the local player's crossing. The server only
// reports row + stun; everything below — the climbing camera, the step onto the
// chosen tile, the shatter — is interpolated here so the choice actually reads.
const glass = {
  cam: 0, // smoothly interpolated camera row (float)
  stepX: 0, // eased lateral lean toward the picked tile, -1 (L) .. 1 (R)
  prevRow: 0,
  prevStun: false,
  shatterAt: -1, // rc.time of the last crack, drives the shatter overlay
  shatterSide: 1 as -1 | 1,
  landAt: -1, // rc.time of the last successful step (releases the lean)
  lastT: 0,
  inited: false,
};
const GLASS_ROW_H = 92;

function drawShatteredTile(ctx: CanvasRenderingContext2D, tx: number, yy: number, tileW: number, scale: number, age: number) {
  const fall = Math.min(1, age / 480); // 0 → just cracked, 1 → gone
  ctx.save();
  // crack lines flash first, then the shards drop away
  if (fall < 0.55) {
    ctx.globalAlpha = (1 - fall / 0.55) * 0.95;
    ctx.strokeStyle = "#cdefff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      ctx.moveTo(tx, yy);
      ctx.lineTo(tx + Math.cos(a) * tileW * 0.46, yy + Math.sin(a) * 22 * scale);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = (1 - fall) * 0.8;
  ctx.fillStyle = "rgba(180,235,255,0.5)";
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + i;
    const dx = Math.cos(a) * tileW * 0.3;
    const dy = Math.sin(a) * 12 * scale + fall * 70; // shards rain into the chasm
    ctx.beginPath();
    ctx.moveTo(tx + dx, yy + dy);
    ctx.lineTo(tx + dx + 8 * scale, yy + dy + 11 * scale);
    ctx.lineTo(tx + dx - 6 * scale, yy + dy + 13 * scale);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function renderGlass(ctx: CanvasRenderingContext2D, W: number, H: number, cur: Snapshot, rc: RenderCtx) {
  const d = cur.data || {};
  const rows: number = d.rows || 8;
  // backdrop chasm
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#1a1030");
  g.addColorStop(1, "#06040f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const you = (d.walkers || []).find((w: any) => w.id === rc.youId);

  // ----- left rail: everyone's progress -----
  ctx.save();
  ctx.font = "700 14px 'Baloo 2', sans-serif";
  ctx.fillStyle = "#b9a7d6";
  ctx.textAlign = "left";
  ctx.fillText("CLIMBERS", 24, 34);
  const railH = H - 90;
  (d.walkers || []).forEach((w: any, i: number) => {
    const yy = 60 + (i % 12) * (railH / 12);
    const xx = 24 + Math.floor(i / 12) * 120;
    const prog = w.finished ? 1 : w.row / rows;
    ctx.fillStyle = w.alive ? (w.finished ? "#69f0ae" : "#fff") : "#6b5a86";
    drawBlob(ctx, w.characterId, xx + 14, yy, { r: 12, time: rc.time, anim: w.alive ? "idle" : "dead" });
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(xx + 34, yy - 4, 70, 8);
    ctx.fillStyle = w.finished ? "#69f0ae" : w.alive ? "#ff8fb3" : "#6b5a86";
    ctx.fillRect(xx + 34, yy - 4, 70 * prog, 8);
  });
  ctx.restore();

  // ----- center: your bridge -----
  const cx = W / 2;
  if (!you || !you.alive) {
    glass.inited = false; // so the next round's crossing starts from row 0
    ctx.font = "800 40px 'Baloo 2', sans-serif";
    ctx.fillStyle = you && !you.alive ? "#ff5252" : "#b9a7d6";
    ctx.textAlign = "center";
    ctx.fillText(you ? "💥 You fell!" : "Spectating…", cx, H / 2);
    return;
  }
  if (you.finished) {
    glass.inited = false;
    ctx.font = "800 44px 'Baloo 2', sans-serif";
    ctx.fillStyle = "#69f0ae";
    ctx.textAlign = "center";
    ctx.fillText("🏁 You made it across!", cx, H / 2);
    drawBlob(ctx, you.characterId, cx, H / 2 + 70, { r: 40, time: rc.time, anim: "cheer", name: you.name, number: rc.numbers?.get(you.id), you: true });
    return;
  }

  // --- advance the local animation clock ---
  const dt = glass.lastT ? Math.min(0.05, Math.max(0, (rc.time - glass.lastT) / 1000)) : 0;
  glass.lastT = rc.time;
  // (re)initialise on first frame or a fresh bridge (row jumped back to the start)
  if (!glass.inited || you.row + 1 < Math.floor(glass.cam)) {
    glass.cam = you.row;
    glass.stepX = 0;
    glass.prevRow = you.row;
    glass.prevStun = you.stun;
    glass.shatterAt = -1;
    glass.landAt = -1;
    glass.inited = true;
  }
  // react to what the server just told us: a step cleared, or a tile cracked
  if (you.row > glass.prevRow) glass.landAt = rc.time;
  if (you.stun && !glass.prevStun) {
    glass.shatterAt = rc.time;
    glass.shatterSide = glassChoice.at > 0 ? glassChoice.side : 1;
  }
  glass.prevRow = you.row;
  glass.prevStun = you.stun;

  // camera climbs toward your current row → real sense of crossing
  glass.cam += (you.row - glass.cam) * Math.min(1, dt * 9);
  // lean onto the tile you just picked, until the server resolves it
  const choosing =
    !you.stun &&
    glassChoice.at > glass.landAt &&
    glassChoice.at > glass.shatterAt &&
    rc.time - glassChoice.at < 600;
  const recoiling = rc.time - glass.shatterAt < 240;
  let leanTarget = 0;
  if (choosing) leanTarget = glassChoice.side;
  else if (recoiling) leanTarget = glass.shatterSide * 0.7;
  glass.stepX += (leanTarget - glass.stepX) * Math.min(1, dt * 16);

  const cam = glass.cam;
  const baseY = H - 110;
  const topY = 86;
  // perspective rows receding up the bridge
  for (let r = Math.max(0, Math.floor(cam) - 1); r < rows; r++) {
    const depth = r - cam;
    const yy = baseY - depth * GLASS_ROW_H;
    if (yy < topY - 60) break;
    if (yy > H + 60) continue;
    const scale = Math.max(0.34, 1 - Math.max(0, depth) * 0.12);
    const tileW = 110 * scale;
    const gap = 40 * scale;
    const isChoice = r === you.row;
    for (const side of [-1, 1]) {
      const tx = cx + side * (gap / 2 + tileW / 2);
      const broken = isChoice && side === glass.shatterSide && rc.time - glass.shatterAt < 480;
      ctx.save();
      ctx.globalAlpha = isChoice ? 1 : Math.max(0.18, 0.6 - Math.max(0, depth) * 0.05);
      if (broken) {
        drawShatteredTile(ctx, tx, yy, tileW, scale, rc.time - glass.shatterAt);
      } else {
        const grad = ctx.createLinearGradient(tx, yy - 30, tx, yy + 30);
        grad.addColorStop(0, "rgba(180,235,255,0.55)");
        grad.addColorStop(1, "rgba(120,200,255,0.22)");
        ctx.fillStyle = grad;
        const leaning = isChoice && Math.sign(glass.stepX) === side && Math.abs(glass.stepX) > 0.25;
        ctx.strokeStyle = isChoice ? (leaning ? "#b9f6ff" : "#80d8ff") : "rgba(180,235,255,0.45)";
        ctx.lineWidth = isChoice ? (leaning ? 5 : 3) : 2;
        roundRect(ctx, tx - tileW / 2, yy - 26 * scale, tileW, 52 * scale, 10);
        ctx.fill();
        ctx.stroke();
        if (isChoice) {
          ctx.fillStyle = leaning ? "#fff" : "rgba(255,255,255,0.85)";
          ctx.font = `800 ${26 * scale}px 'Baloo 2', sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(side < 0 ? "◀" : "▶", tx, yy + 9 * scale);
        }
      }
      ctx.restore();
    }
  }

  // your blob — stands in front of the choice tiles and steps onto your pick
  const choiceDepth = you.row - cam;
  const choiceY = baseY - choiceDepth * GLASS_ROW_H;
  const cScale = Math.max(0.5, 1 - Math.max(0, choiceDepth) * 0.12);
  const tileW = 110 * cScale;
  const gap = 40 * cScale;
  const standX = cx + glass.stepX * (gap / 2 + tileW / 2);
  const standY = choiceY + 34 * cScale - Math.abs(glass.stepX) * 12; // little hop as you step over
  drawBlob(ctx, you.characterId, standX, standY, {
    r: 34,
    time: rc.time,
    anim: you.stun ? "fall" : "idle",
    name: you.name,
    number: rc.numbers?.get(you.id),
    you: true,
    flash: you.stun ? 0.6 : 0,
  });

  // header / prompt
  ctx.textAlign = "center";
  ctx.font = "800 22px 'Baloo 2', sans-serif";
  ctx.fillStyle = "#fff";
  ctx.fillText(`Row ${Math.min(you.row + 1, rows)} / ${rows}`, cx, topY - 26);
  if (you.stun) {
    ctx.fillStyle = "#ff5252";
    ctx.font = "800 24px 'Baloo 2', sans-serif";
    ctx.fillText("CRACK! — steady…", cx, topY + 4);
  } else {
    ctx.fillStyle = "#b9a7d6";
    ctx.font = "700 15px 'Baloo 2', sans-serif";
    ctx.fillText("pick a tile — one holds, one shatters", cx, topY + 2);
  }
}

// =================== TUG OF WAR ===================
function renderTug(ctx: CanvasRenderingContext2D, W: number, H: number, cur: Snapshot, rc: RenderCtx) {
  const d = cur.data || {};
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#143029");
  g.addColorStop(1, "#08110f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const midY = H * 0.52;
  // pits
  for (const side of [-1, 1]) {
    const px = side < 0 ? 0 : W - 110;
    const pg = ctx.createLinearGradient(px, 0, px + 110 * (side < 0 ? 1 : -1) + (side < 0 ? 0 : 110), 0);
    pg.addColorStop(0, "rgba(255,23,68,0.5)");
    pg.addColorStop(1, "rgba(255,23,68,0)");
    ctx.fillStyle = side < 0 ? pg : pg;
    ctx.fillRect(side < 0 ? 0 : W - 110, 0, 110, H);
  }
  ctx.font = "800 18px 'Baloo 2', sans-serif";
  ctx.fillStyle = "#ff5252";
  ctx.textAlign = "center";
  ctx.save();
  ctx.translate(40, H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("THE PIT", 0, 0);
  ctx.restore();
  ctx.save();
  ctx.translate(W - 40, H / 2);
  ctx.rotate(Math.PI / 2);
  ctx.fillText("THE PIT", 0, 0);
  ctx.restore();

  const ropePos = d.ropePos || 0; // -1..1
  const centerX = W / 2 + ropePos * (W * 0.34);

  // rope
  ctx.strokeStyle = "#c8a25a";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(120, midY);
  ctx.lineTo(W - 120, midY);
  ctx.stroke();
  // center marker / flag
  ctx.fillStyle = ropePos > 0.4 ? "#ff5252" : ropePos < -0.4 ? "#ff5252" : "#ffd54f";
  ctx.fillRect(centerX - 4, midY - 60, 8, 120);
  ctx.beginPath();
  ctx.moveTo(centerX, midY - 60);
  ctx.lineTo(centerX + 34, midY - 48);
  ctx.lineTo(centerX, midY - 36);
  ctx.fill();

  // teams
  const t0 = (d.pullers || []).filter((p: any) => p.team === 0);
  const t1 = (d.pullers || []).filter((p: any) => p.team === 1);
  const drawTeam = (team: any[], dir: number) => {
    team.forEach((p: any, i: number) => {
      const along = 0.5 + i * 0.5;
      const bx = centerX - dir * (120 + i * 64);
      const by = midY + (i % 2 === 0 ? -34 : 30);
      const pull = Math.sin(rc.time * 0.02 + i) * 6;
      drawBlob(ctx, p.characterId, bx - dir * pull, by, {
        r: 30,
        time: rc.time,
        anim: "run",
        facing: dir < 0 ? 0 : Math.PI,
        name: p.name,
        number: rc.numbers?.get(p.id),
        you: p.id === rc.youId,
      });
    });
  };
  drawTeam(t0, 1); // team 0 pulls left (toward -1)? ropePos>0 means team0 wins (rope toward +). We'll say team0 on left.
  drawTeam(t1, -1);

  // labels
  ctx.font = "800 22px 'Baloo 2', sans-serif";
  ctx.fillStyle = "#1fe3c2";
  ctx.textAlign = "left";
  ctx.fillText(`🟦 Team 1  (${t0.length})`, 130, 50);
  ctx.fillStyle = "#ff8fb3";
  ctx.textAlign = "right";
  ctx.fillText(`Team 2 🟥  (${t1.length})`, W - 130, 50);

  rc.fx.draw(ctx);
}

// =================== RPS MINUS ONE ===================
const HAND: Record<string, string> = { R: "✊", P: "✋", S: "✌️" };
function renderRps(ctx: CanvasRenderingContext2D, W: number, H: number, cur: Snapshot, rc: RenderCtx) {
  const d = cur.data || {};
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#241248");
  g.addColorStop(1, "#0e0720");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // find your duel, else spectate first active
  const duels = d.duels || [];
  let duel = duels.find((x: any) => x.a === rc.youId || x.b === rc.youId);
  let youAreA = duel ? duel.a === rc.youId : true;
  if (!duel) duel = duels.find((x: any) => x.status !== "done") || duels[0];

  ctx.textAlign = "center";
  if (!duel) {
    ctx.font = "800 36px 'Baloo 2', sans-serif";
    ctx.fillStyle = "#b9a7d6";
    ctx.fillText("Awaiting duel…", W / 2, H / 2);
    return;
  }

  const meName = youAreA ? duel.aName : duel.bName;
  const meChar = youAreA ? duel.aChar : duel.bChar;
  const oppName = youAreA ? duel.bName : duel.aName;
  const oppChar = youAreA ? duel.bChar : duel.aChar;
  const meThrows = youAreA ? duel.aThrows : duel.bThrows;
  const oppThrows = youAreA ? duel.bThrows : duel.aThrows;
  const meKeep = youAreA ? duel.aKeep : duel.bKeep;
  const oppKeep = youAreA ? duel.bKeep : duel.aKeep;

  const meId = youAreA ? duel.a : duel.b;
  const oppId = youAreA ? duel.b : duel.a;

  // opponent (top)
  if (oppChar) {
    drawBlob(ctx, oppChar, W / 2, H * 0.26, { r: 56, time: rc.time, anim: "idle", name: oppName, number: rc.numbers?.get(oppId), facing: Math.PI / 2 });
    drawHands(ctx, W / 2, H * 0.26 + 80, oppThrows, oppKeep, duel.status);
  } else {
    ctx.font = "800 26px 'Baloo 2', sans-serif";
    ctx.fillStyle = "#69f0ae";
    ctx.fillText("BYE — free pass!", W / 2, H * 0.3);
  }

  // VS
  ctx.font = "900 40px 'Baloo 2', sans-serif";
  ctx.fillStyle = "#ff4f9a";
  ctx.fillText("VS", W / 2, H * 0.5);
  ctx.font = "700 18px 'Baloo 2', sans-serif";
  ctx.fillStyle = "#ffd54f";
  const phaseLabel = duel.status === "done" ? (duel.winner === (youAreA ? duel.a : duel.b) ? "YOU WIN!" : "Eliminated") : d.phase === "pick" ? "Pick TWO" : d.phase === "drop" ? "Drop ONE" : "Reveal!";
  ctx.fillText(phaseLabel, W / 2, H * 0.5 + 28);

  // you (bottom)
  if (meChar) {
    drawBlob(ctx, meChar, W / 2, H * 0.74, { r: 60, time: rc.time, anim: duel.status === "done" && duel.winner === (youAreA ? duel.a : duel.b) ? "cheer" : "idle", name: meName, number: rc.numbers?.get(meId), you: true, facing: -Math.PI / 2 });
    drawHands(ctx, W / 2, H * 0.74 - 90, meThrows, meKeep, duel.status);
  }
}

function drawHands(ctx: CanvasRenderingContext2D, cx: number, cy: number, throws: string[], keep: string | null, status: string) {
  if (!throws || throws.length === 0) {
    ctx.font = "700 16px 'Baloo 2', sans-serif";
    ctx.fillStyle = "#6b5a86";
    ctx.fillText("…", cx, cy);
    return;
  }
  const shown = keep ? [keep] : throws;
  const spread = shown.length > 1 ? 60 : 0;
  shown.forEach((th, i) => {
    const x = cx + (i - (shown.length - 1) / 2) * spread;
    ctx.font = "44px serif";
    ctx.textAlign = "center";
    ctx.globalAlpha = 1;
    ctx.fillText(HAND[th] || "?", x, cy);
  });
  ctx.globalAlpha = 1;
}

// =================== JUMP ROPE ===================
function renderJump(ctx: CanvasRenderingContext2D, W: number, H: number, cur: Snapshot, rc: RenderCtx) {
  const d = cur.data || {};
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#3a1a52");
  g.addColorStop(1, "#08110f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const groundY = H * 0.72;
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(0, groundY, W, H - groundY);
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(W, groundY);
  ctx.stroke();

  // turners (hands) at sides
  const phase = d.phase || 0; // 0..1
  // rope is at ground when phase ~ 0; arcs over top at phase 0.5
  const ropeY = groundY - Math.sin(phase * Math.PI) * (H * 0.55);
  const atGround = phase < 0.1 || phase > 0.9;
  ctx.strokeStyle = atGround ? "#ff5252" : "#ffd54f";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(60, groundY - 10);
  ctx.quadraticCurveTo(W / 2, ropeY - (groundY - ropeY) * 0.4, W - 60, groundY - 10);
  ctx.stroke();
  // turner hands
  ctx.font = "40px serif";
  ctx.textAlign = "center";
  ctx.fillText("🤚", 50, groundY - 6);
  ctx.fillText("🤚", W - 50, groundY - 6);

  // jumpers in a row
  const jumpers = d.jumpers || [];
  const n = jumpers.length;
  jumpers.forEach((j: any, i: number) => {
    const x = W / 2 + (i - (n - 1) / 2) * Math.min(90, (W - 220) / Math.max(1, n));
    if (!j.alive) {
      drawCoffin(ctx, x, groundY - 30, 26 / PLAYER_RADIUS, rc.time, coffinAge(rc, j.id));
      return;
    }
    const lift = j.airborne ? Math.sin(Math.min(1, 1) * Math.PI) * 60 : 0;
    const y = groundY - 30 - lift - (j.airborne ? 20 : 0);
    drawBlob(ctx, j.characterId, x, y, {
      r: 26,
      time: rc.time,
      anim: j.airborne ? "cheer" : "idle",
      name: j.name,
      number: rc.numbers?.get(j.id),
      you: j.id === rc.youId,
    });
  });

  // beat indicator
  const timeToGround = ((1 - phase) * (d.period || 1));
  ctx.font = "800 22px 'Baloo 2', sans-serif";
  ctx.fillStyle = atGround ? "#ff5252" : "#69f0ae";
  ctx.textAlign = "center";
  ctx.fillText(`Swing ${d.swing || 0}`, W / 2, 50);
  // approaching ring
  const r = 30 + timeToGround * 120;
  ctx.strokeStyle = `rgba(255,213,79,${Math.max(0, 1 - timeToGround)})`;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(W / 2, 90, r, 0, Math.PI * 2);
  ctx.stroke();

  rc.fx.draw(ctx);
}

// =================== shared field-game adornments ===================
function drawTeamRing(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, color: string) {
  const r = PLAYER_RADIUS * scale;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.86, r * 0.98, r * 0.42, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawFrozen(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, t: number) {
  const r = PLAYER_RADIUS * scale;
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = "#bbe9ff";
  ctx.beginPath();
  ctx.ellipse(x, y, r * 1.05, r * 1.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = "#e1f5fe";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.font = `${Math.round(22 * scale)}px serif`;
  ctx.textAlign = "center";
  ctx.fillText("❄️", x, y - r * 1.5 + Math.sin(t * 0.005) * 2);
  ctx.restore();
}

function drawFlames(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, t: number) {
  const r = PLAYER_RADIUS * scale;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + t * 0.01;
    const fx = x + Math.cos(a) * r * 0.6;
    const fy = y + r * 0.5 - (0.5 + 0.5 * Math.sin(t * 0.02 + i)) * r * 0.9;
    const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, r * 0.55);
    g.addColorStop(0, "rgba(255,200,80,0.7)");
    g.addColorStop(1, "rgba(255,80,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(fx, fy, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCrown(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, t: number) {
  const r = PLAYER_RADIUS * scale;
  ctx.save();
  ctx.font = `${Math.round(26 * scale)}px serif`;
  ctx.textAlign = "center";
  ctx.fillText("👑", x, y - r * 1.95 + Math.sin(t * 0.006) * 3);
  ctx.restore();
}

// Seconds since this actor was first seen dead (drives the coffin drop-in), or
// null if we never witnessed the moment (e.g. a spectator who joined late).
function coffinAge(rc: RenderCtx, id: string): number | null {
  const da = rc.deaths?.get(id);
  return da != null ? (rc.time - da) / 1000 : null;
}

// Squid Game-style elimination: the fallen blob is sealed into a black gift
// "coffin" wrapped in a hot-pink ribbon and bow. `age` (seconds since death)
// drives a little drop-from-above with a squash-bounce on landing.
function drawCoffin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  t: number,
  age: number | null,
) {
  const r = PLAYER_RADIUS * scale;
  let dropY = 0;
  let sX = 1;
  let sY = 1;
  if (age != null) {
    if (age < 0.3) {
      const p = age / 0.3;
      dropY = -((1 - p) * (1 - p)) * r * 6; // fall in from above
    } else if (age < 0.5) {
      const b = Math.sin(((age - 0.3) / 0.2) * Math.PI); // squash-bounce on landing
      sX = 1 + b * 0.18;
      sY = 1 - b * 0.18;
    }
  }
  const boxW = r * 2.0 * sX;
  const boxH = r * 1.45 * sY;
  const lidH = r * 0.4 * sY;
  const lidW = boxW * 1.08;
  const ribW = r * 0.36 * sX;
  const baseY = y + r * 0.95;
  const topY = baseY - boxH + dropY;
  const lidTop = topY - lidH * 1.1;

  // ground shadow (fades while the box is still falling)
  ctx.save();
  ctx.globalAlpha = 0.22 * (1 - Math.min(0.6, -dropY / (r * 6)));
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(x, baseY + r * 0.04, boxW * 0.5, r * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  // box body
  const bg = ctx.createLinearGradient(0, topY, 0, baseY + dropY);
  bg.addColorStop(0, "#24242c");
  bg.addColorStop(1, "#0c0c11");
  ctx.fillStyle = bg;
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = Math.max(1, r * 0.05);
  roundRect(ctx, x - boxW / 2, topY, boxW, boxH, r * 0.16);
  ctx.fill();
  ctx.stroke();

  // ribbon cross on the body
  ctx.fillStyle = "#ff2e88";
  ctx.fillRect(x - boxW / 2, topY + boxH * 0.5 - ribW / 2, boxW, ribW); // horizontal
  ctx.fillRect(x - ribW / 2, topY, ribW, boxH); // vertical

  // lid
  const lg = ctx.createLinearGradient(0, lidTop, 0, lidTop + lidH * 2);
  lg.addColorStop(0, "#34343f");
  lg.addColorStop(1, "#191920");
  ctx.fillStyle = lg;
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  roundRect(ctx, x - lidW / 2, lidTop, lidW, lidH * 2, r * 0.14);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ff2e88";
  ctx.fillRect(x - ribW / 2, lidTop, ribW, lidH * 2); // ribbon over the lid

  // sheen down the vertical ribbon
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(x - ribW / 2, topY, ribW * 0.34, boxH);

  // bow on top
  drawBow(ctx, x, lidTop, r * 0.5);
  ctx.restore();
}

function drawBow(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save();
  ctx.translate(x, y);
  // trailing ribbon tails
  ctx.strokeStyle = "#ff2e88";
  ctx.lineWidth = s * 0.34;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, s * 0.1);
  ctx.lineTo(-s * 0.5, s * 0.95);
  ctx.moveTo(0, s * 0.1);
  ctx.lineTo(s * 0.5, s * 0.95);
  ctx.stroke();
  // two loops
  ctx.strokeStyle = "#c80f5e";
  ctx.lineWidth = Math.max(1, s * 0.1);
  for (const dir of [-1, 1]) {
    ctx.fillStyle = "#ff2e88";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(dir * s * 1.2, -s * 0.8, dir * s * 1.05, -s * 0.05);
    ctx.quadraticCurveTo(dir * s * 1.2, s * 0.6, 0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // center knot
  ctx.fillStyle = "#ff5aa6";
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// =================== KING OF THE HILL (lava floor + safe hill) ===================
function drawLava(ctx: CanvasRenderingContext2D, d: any, t: number) {
  const cx = d.cx ?? ARENA_W / 2;
  const cy = d.cy ?? ARENA_H / 2;
  const R = d.safeR ?? 200;
  const lg = ctx.createLinearGradient(0, 0, 0, ARENA_H);
  lg.addColorStop(0, "#3a0b02");
  lg.addColorStop(1, "#180400");
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 26; i++) {
    const x = (i * 173.3 + Math.sin(t * 0.001 + i) * 30 + ARENA_W) % ARENA_W;
    const y = (i * 121.7 + Math.cos(t * 0.0013 + i) * 30 + ARENA_H) % ARENA_H;
    const rr = 40 + (i % 4) * 22;
    const pulse = 0.4 + 0.3 * Math.sin(t * 0.003 + i);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
    g.addColorStop(0, `rgba(255,120,20,${0.35 * pulse})`);
    g.addColorStop(1, "rgba(255,60,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // safe hill
  ctx.save();
  const hg = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R);
  hg.addColorStop(0, "#5d8a3a");
  hg.addColorStop(1, "#37521f");
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = `rgba(255,${120 + Math.floor(60 * Math.sin(t * 0.01))},40,0.95)`;
  ctx.shadowColor = "#ff6d00";
  ctx.shadowBlur = 26;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();
}

// =================== DODGEBALL (floor + balls) ===================
function drawDodgeballFloor(ctx: CanvasRenderingContext2D, d: any) {
  const mid = d.mid ?? ARENA_W / 2;
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = TEAM_COLORS[0];
  ctx.fillRect(0, 0, mid, ARENA_H);
  ctx.fillStyle = TEAM_COLORS[1];
  ctx.fillRect(mid, 0, ARENA_W - mid, ARENA_H);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 5;
  ctx.setLineDash([20, 16]);
  ctx.beginPath();
  ctx.moveTo(mid, 0);
  ctx.lineTo(mid, ARENA_H);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, state: string) {
  ctx.save();
  ctx.translate(x, y);
  const r = 14;
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 2, 0, 0, r);
  g.addColorStop(0, state === "flight" ? "#fff1a8" : "#ffe08a");
  g.addColorStop(1, state === "flight" ? "#ff8f00" : "#e0a020");
  ctx.fillStyle = g;
  if (state === "flight") {
    ctx.shadowColor = "#ffb300";
    ctx.shadowBlur = 12;
  }
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.6, Math.PI * 0.1, Math.PI * 0.9);
  ctx.stroke();
  ctx.restore();
}

// =================== MUSICAL CHAIRS ===================
function drawChairs(ctx: CanvasRenderingContext2D, d: any, t: number) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = "800 42px 'Baloo 2', sans-serif";
  if (d.phase === "music" && d.fake) {
    // a fake-out: looks like a stop, but it's bait — freeze now and you're toast
    ctx.fillStyle = "#ff5252";
    ctx.fillText("🛑 STOP!", ARENA_W / 2, 70);
    ctx.font = "700 20px 'Baloo 2', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText("…don't you dare stand still", ARENA_W / 2, 96);
  } else if (d.phase === "music") {
    ctx.fillStyle = "#69f0ae";
    ctx.fillText("🎵 keep moving — or you're out!", ARENA_W / 2, 70);
  } else if (d.phase === "scramble") {
    ctx.fillStyle = "#ff5252";
    ctx.fillText("🪑 GRAB A CHAIR!", ARENA_W / 2, 70);
  }
  ctx.restore();
  for (const c of d.chairs || []) drawStool(ctx, c.x, c.y, c.claimed, d.phase);
}

function drawStool(ctx: CanvasRenderingContext2D, x: number, y: number, claimed: boolean, phase: string) {
  ctx.save();
  ctx.translate(x, y);
  if (phase === "scramble" && !claimed) {
    ctx.strokeStyle = "rgba(255,213,79,0.8)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 42, 0, Math.PI * 2);
    ctx.stroke();
  }
  const col = claimed ? "#69f0ae" : "#d9a05b";
  ctx.fillStyle = col;
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 3;
  roundRect(ctx, -22, -16, 44, 18, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillRect(-22, -46, 8, 34);
  ctx.fillRect(14, -46, 8, 34);
  ctx.fillRect(-20, 2, 6, 20);
  ctx.fillRect(14, 2, 6, 20);
  if (claimed) {
    ctx.font = "20px serif";
    ctx.textAlign = "center";
    ctx.fillText("✅", 0, -24);
  }
  ctx.restore();
}

// =================== NIGHT MODE FLASHLIGHT ===================
function drawNight(ctx: CanvasRenderingContext2D, W: number, H: number, f: Fit, actors: Actor[], rc: RenderCtx) {
  const me = actors.find((a) => a.id === rc.youId);
  ctx.save();
  if (me && me.alive) {
    const px = f.ox + me.x * f.s;
    const py = f.oy + me.y * f.s;
    const vis = (me.vision ?? 250) * f.s;
    const g = ctx.createRadialGradient(px, py, vis * 0.25, px, py, vis);
    g.addColorStop(0, "rgba(4,6,16,0)");
    g.addColorStop(0.72, "rgba(4,6,16,0.6)");
    g.addColorStop(1, "rgba(2,3,10,0.96)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    const warm = ctx.createRadialGradient(px, py, 0, px, py, vis * 0.6);
    warm.addColorStop(0, "rgba(255,224,150,0.10)");
    warm.addColorStop(1, "rgba(255,224,150,0)");
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = "rgba(2,3,10,0.86)";
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

// =================== PRESENT / SECRET SANTA (parlor) ===================
function renderParlor(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  cur: Snapshot,
  prev: Snapshot | null,
  alpha: number,
  rc: RenderCtx,
) {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#1a1230");
  bg.addColorStop(1, "#0a0714");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const f = fit(W, H);
  ctx.save();
  ctx.translate(f.ox, f.oy);
  ctx.scale(f.s, f.s);
  const d = cur.data || {};
  const actors = interpActors(cur, prev, alpha);
  const evs: any[] = d.events || [];
  const receiverSet = new Set(evs.map((e) => e.receiverId));

  if (d.phase === "reveal") {
    for (const e of evs) {
      const g = actors.find((a) => a.id === e.giverId);
      const r = actors.find((a) => a.id === e.receiverId);
      if (g && r) {
        ctx.strokeStyle = e.correct ? "rgba(105,240,174,0.8)" : "rgba(255,82,82,0.7)";
        ctx.lineWidth = 4;
        ctx.setLineDash([12, 8]);
        ctx.beginPath();
        ctx.moveTo(g.x, g.y);
        ctx.lineTo(r.x, r.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  actors.sort((a, b) => a.y - b.y);
  for (const a of actors) {
    if (!a.alive) {
      drawCoffin(ctx, a.x, a.y, 1, rc.time, coffinAge(rc, a.id));
      continue;
    }
    drawBlob(ctx, a.characterId, a.x, a.y, {
      r: PLAYER_RADIUS,
      time: rc.time,
      anim: "idle",
      name: a.name,
      number: rc.numbers?.get(a.id),
      you: a.id === rc.youId,
    });
    if (receiverSet.has(a.id)) {
      ctx.font = "30px serif";
      ctx.textAlign = "center";
      ctx.fillText("🎁", a.x, a.y - PLAYER_RADIUS * 1.9 + Math.sin(rc.time * 0.006) * 3);
    }
  }

  if (d.phase === "reveal") {
    ctx.textAlign = "center";
    for (const e of evs) {
      const victimId = e.correct ? e.giverId : e.receiverId;
      const v = actors.find((a) => a.id === victimId);
      if (v) {
        ctx.font = "800 22px 'Baloo 2', sans-serif";
        ctx.fillStyle = e.correct ? "#69f0ae" : "#ff5252";
        ctx.fillText(e.correct ? "CAUGHT!" : "FOOLED!", v.x, v.y - 54);
      }
    }
  }
  ctx.restore();

  if (d.phase === "dark") {
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#cbb6ff";
    ctx.textAlign = "center";
    ctx.font = "800 32px 'Baloo 2', sans-serif";
    ctx.fillText("🌑 A gift is being placed in the dark…", W / 2, H / 2);
  }

  ctx.textAlign = "center";
  ctx.font = "800 26px 'Baloo 2', sans-serif";
  if (d.phase === "guess") {
    const mine = evs.find((e) => e.receiverId === rc.youId);
    ctx.fillStyle = mine ? "#ffd54f" : "#b9a7d6";
    ctx.fillText(mine ? "🎁 Who gave you this gift? Tap a suspect below!" : "Someone's guessing in the parlor…", W / 2, 56);
  } else if (d.phase === "reveal") {
    ctx.fillStyle = "#b9a7d6";
    ctx.fillText("The truth comes out…", W / 2, 56);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
