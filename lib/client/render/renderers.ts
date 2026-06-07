// Per-game canvas rendering. Arena games interpolate actor positions; discrete
// games draw their own stylized layouts from snapshot.data.
import type { Snapshot, Actor } from "../../shared/types";
import { ARENA_W, ARENA_H, PLAYER_RADIUS } from "../../shared/constants";
import { getMap } from "../../shared/maps";
import { pullerStandX } from "../../shared/tug";
import { mashFx } from "../mashFx";
import { drawArena, drawBlob, drawShadow, drawProp, drawSword } from "./draw";
import type { FxSystem } from "./fx";
import { simonEmoji, simonByKey } from "../../shared/simon";

// Team accent colors (freeze tag / dodgeball)
const TEAM_COLORS = ["#29b6f6", "#ff6f9c"];

export interface RenderCtx {
  youId: string | null;
  time: number;
  fx: FxSystem;
  mapId: string | null;
  numbers?: Map<string, number>; // playerId -> Squid Game number
  variants?: Map<string, number>; // playerId -> duplicate-icon accent slot (0 = unique)
  accessories?: Map<string, string[]>; // playerId -> equipped cosmetic ids
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

const ARENA_GAMES = new Set(["redlight", "tag", "mingle", "boomerang", "dodgeball", "musicalchairs", "prophunt", "keepyuppy", "koth"]);

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
  } else if (cur.game === "chutesladders") {
    renderBoard(ctx, W, H, cur, rc);
  } else if (cur.game === "simonsays") {
    renderSimon(ctx, W, H, cur, rc);
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
        variant: rc.variants?.get(a.id), accessories: rc.accessories?.get(a.id),
        you: a.id === rc.youId,
      });
      if (a.burning) drawFlames(ctx, a.x, a.y, a.scale ?? 1, rc.time);
      if (a.frozen) drawFrozen(ctx, a.x, a.y, a.scale ?? 1, rc.time);
      if (cur.game === "koth" && a.id === d.kingId) drawCrown(ctx, a.x, a.y, a.scale ?? 1, rc.time);
      // keepy uppy: a pin juts out while the spike is "out" (its touch pops balloons)
      if (cur.game === "keepyuppy" && a.progress) drawSpikePin(ctx, a.x, a.y, a.facing ?? 0, a.scale ?? 1, a.progress);
    }

    // --- boomerangs ---
    if (cur.game === "boomerang" && d.rangs) {
      for (const r of d.rangs) drawRang(ctx, r.x, r.y, r.spin, r.big);
    }
    // --- dodgeballs (over the blobs) ---
    if (cur.game === "dodgeball" && d.balls) {
      for (const b of d.balls) drawBall(ctx, b.x, b.y, b.state);
    }
    // --- keepy uppy balloons (float above everything) ---
    if (cur.game === "keepyuppy" && d.balloons) {
      for (const b of d.balloons) drawBalloon(ctx, b, b.owner === rc.youId, rc.time);
    }
  }

  // musical chairs: a "MOVE!" countdown over anyone who's stopped dancing (and a
  // loud banner when it's you) so nobody's eliminated without a clear heads-up
  if (cur.game === "musicalchairs") drawChairsWarn(ctx, d, actors, rc);

  // freeze tag: a constant role banner so it's obvious to EVERYONE who freezes
  // and who runs (the per-player hint coaches you; this reminds the whole table)
  if (cur.game === "tag") drawTagBanner(ctx, d);

  // mingle: the called number printed BIG at the top of the arena, well clear of
  // the platform (where the crowd of blobs would otherwise bury it)
  if (cur.game === "mingle") drawMingleBanner(ctx, d, rc.time);

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
            variant: rc.variants?.get(a.id), accessories: rc.accessories?.get(a.id),
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
            variant: rc.variants?.get(a.id), accessories: rc.accessories?.get(a.id),
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

function drawMinglePlatform(ctx: CanvasRenderingContext2D, p: any, phase: string, n: number, t: number) {
  ctx.save();
  ctx.translate(p.x, p.y);
  // base disc
  const g = ctx.createRadialGradient(0, -p.r * 0.3, p.r * 0.2, 0, 0, p.r);
  g.addColorStop(0, "#3a2b5e");
  g.addColorStop(1, "#221836");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, p.r, 0, Math.PI * 2);
  ctx.fill();
  // rotating carousel wedges (the platform spins while the music plays)
  ctx.save();
  ctx.rotate(p.spin || 0);
  const spokes = 8;
  for (let i = 0; i < spokes; i++) {
    ctx.fillStyle = i % 2 === 0 ? "rgba(255,213,79,0.16)" : "rgba(255,79,154,0.14)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, p.r, (i / spokes) * Math.PI * 2, ((i + 1) / spokes) * Math.PI * 2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // rim
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.arc(0, 0, p.r, 0, Math.PI * 2);
  ctx.stroke();
  // center: the music note while playing; the CALLED NUMBER once it stops
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if ((phase === "mingle" || phase === "flash") && n) {
    ctx.fillStyle = "#ffd54f";
    ctx.font = "800 22px 'Baloo 2', sans-serif";
    ctx.fillText("GROUP OF", 0, -p.r * 0.46);
    ctx.fillStyle = "#fff";
    ctx.font = `900 ${Math.round(p.r * 0.95)}px 'Baloo 2', sans-serif`;
    ctx.fillText(String(n), 0, p.r * 0.08);
  } else {
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 0.006);
    ctx.font = `${Math.round(p.r * 0.5)}px serif`;
    ctx.fillText("🎵", 0, 0);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  ctx.textBaseline = "alphabetic";
}

function drawMingleGround(ctx: CanvasRenderingContext2D, d: any, t: number) {
  if (!d.rooms) return;
  if (d.platform) drawMinglePlatform(ctx, d.platform, d.phase, d.n, t);
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
      // count badge on the room's LOWER rim — keeps the top room's number clear
      // of the big "GROUP OF N" banner across the top of the arena
      ctx.font = "800 34px 'Baloo 2', sans-serif";
      ctx.fillStyle = r.ok ? "#69f0ae" : "#fff";
      ctx.textAlign = "center";
      ctx.fillText(`${r.count}`, r.x, r.y + r.r - 12);
    }
    ctx.restore();
  }
}

// Mingle banner — the called group size, shown HUGE across the top of the arena
// so it's readable even while the whole crowd is still piled on the platform
// (the platform's own centre number gets buried under blobs). While the music
// plays (wander) it just teases that a number's coming.
function drawMingleBanner(ctx: CanvasRenderingContext2D, d: any, t: number) {
  const called = (d.phase === "mingle" || d.phase === "flash") && d.n;
  const cx = ARENA_W / 2;
  const yMid = 46; // a strip across the very top — well above the platform
  ctx.save();
  ctx.textBaseline = "middle";
  if (called) {
    const pulse = 0.92 + 0.08 * Math.sin(t * 0.012);
    const label = "GROUP OF ";
    const num = String(d.n);
    ctx.font = "800 30px 'Baloo 2', sans-serif";
    const labelW = ctx.measureText(label).width;
    ctx.font = `900 ${Math.round(58 * pulse)}px 'Baloo 2', sans-serif`;
    const numW = ctx.measureText(num).width;
    const total = labelW + numW;
    const left = cx - total / 2;
    // backing panel so it reads over any map / room beneath it
    ctx.fillStyle = "rgba(8,4,18,0.66)";
    ctx.strokeStyle = "rgba(255,213,79,0.9)";
    ctx.lineWidth = 4;
    roundRect(ctx, left - 26, yMid - 36, total + 52, 72, 18);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffd54f";
    ctx.font = "800 30px 'Baloo 2', sans-serif";
    ctx.fillText(label, left, yMid);
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(255,46,90,0.6)";
    ctx.shadowBlur = 18;
    ctx.font = `900 ${Math.round(58 * pulse)}px 'Baloo 2', sans-serif`;
    ctx.fillText(num, left + labelW, yMid);
  } else {
    // music's playing — the platform spins, everyone mingles, no number yet
    ctx.textAlign = "center";
    ctx.globalAlpha = 0.6 + 0.25 * Math.sin(t * 0.006);
    ctx.fillStyle = "#ffd54f";
    ctx.font = "800 34px 'Baloo 2', sans-serif";
    ctx.fillText("🎵 Mingle! Wait for the number…", cx, yMid);
  }
  ctx.restore();
  ctx.textBaseline = "alphabetic";
}

// Freeze Tag role banner — a fixed two-tone strip at the top of the arena so
// both teams (and spectators) always know who does what. Drawn in arena space.
function drawTagBanner(ctx: CanvasRenderingContext2D, d: any) {
  const segs = [
    { text: "🔵 BLUE freezes", color: TEAM_COLORS[0] },
    { text: "   ·   ", color: "rgba(255,255,255,0.55)" },
    { text: "🩷 PINK runs & thaws", color: TEAM_COLORS[1] },
  ];
  ctx.save();
  ctx.font = "800 26px 'Baloo 2', sans-serif";
  ctx.textBaseline = "middle";
  const widths = segs.map((s) => ctx.measureText(s.text).width);
  const total = widths.reduce((a, b) => a + b, 0);
  const y = 40;
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  roundRect(ctx, ARENA_W / 2 - total / 2 - 18, y - 22, total + 36, 44, 14);
  ctx.fill();
  let x = ARENA_W / 2 - total / 2;
  ctx.textAlign = "left";
  for (let i = 0; i < segs.length; i++) {
    ctx.fillStyle = segs[i].color;
    ctx.fillText(segs[i].text, x, y);
    x += widths[i];
  }
  if (d.deepFreeze) {
    ctx.textAlign = "center";
    ctx.font = "800 20px 'Baloo 2', sans-serif";
    ctx.fillStyle = "#bbe9ff";
    ctx.fillText("❄️ DEEP FREEZE — no more thawing!", ARENA_W / 2, y + 34);
  }
  ctx.restore();
  ctx.textBaseline = "alphabetic";
}

// Powerups are a GAMBLE now — every orb looks identical (no icon, no good/bad
// color tell). You don't know if it's a blessing or a curse until you grab it.
function drawPickups(ctx: CanvasRenderingContext2D, d: any, t: number) {
  if (!d.pickups) return;
  for (const p of d.pickups) {
    const bob = Math.sin(p.bob) * 6;
    // a gentle hue cycle (same animation rule for ALL orbs, so it never leaks
    // which kind it is) — just a mysterious shimmer.
    const hue = (t * 0.05 + p.x * 0.3 + p.y * 0.2) % 360;
    ctx.save();
    ctx.translate(p.x, p.y + bob);
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.006 + p.bob);
    ctx.shadowColor = `hsl(${hue}, 90%, 65%)`;
    ctx.shadowBlur = 12 + pulse * 10;
    const g = ctx.createRadialGradient(-6, -6, 2, 0, 0, 22);
    g.addColorStop(0, "rgba(255,255,255,0.55)");
    g.addColorStop(0.5, `hsla(${hue}, 85%, 60%, 0.45)`);
    g.addColorStop(1, `hsla(${(hue + 60) % 360}, 85%, 45%, 0.25)`);
    ctx.fillStyle = g;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    // a single "?" — same on every orb. Snatch it and find out.
    ctx.fillStyle = "#fff";
    ctx.font = "800 26px 'Baloo 2', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", 0, 1);
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

// =================== KEEPY UPPY ===================
const BALLOON_R = 30; // matches the server's KeepyUppy.BALLOON_R

function drawBalloon(
  ctx: CanvasRenderingContext2D,
  b: { x: number; y: number; vx?: number; color: string },
  mine: boolean,
  t: number,
) {
  const r = BALLOON_R;
  const lean = Math.max(-0.5, Math.min(0.5, (b.vx ?? 0) / 320)); // tilt into the drift
  ctx.save();
  ctx.translate(b.x, b.y);

  // "yours" marker: a soft pulsing halo so you can pick your balloon out of the sky
  if (mine) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.006);
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.25 * pulse;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.setLineDash([7, 7]);
    ctx.lineDashOffset = t * 0.03;
    ctx.beginPath();
    ctx.ellipse(0, 0, r + 7, r + 9, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.rotate(lean * 0.4);

  // wavy string down to the knot
  ctx.strokeStyle = "rgba(0,0,0,0.32)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, r * 1.04);
  for (let i = 1; i <= 4; i++) {
    const yy = r * 1.04 + i * 9;
    const xx = Math.sin(t * 0.004 + i * 0.9 + b.x * 0.01) * 5;
    ctx.lineTo(xx, yy);
  }
  ctx.stroke();

  // body (a fat teardrop), tinted to the owner's blob
  ctx.fillStyle = b.color;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.92, r, 0, 0, Math.PI * 2);
  ctx.fill();
  // knot at the bottom
  ctx.beginPath();
  ctx.moveTo(-5, r * 0.95);
  ctx.lineTo(5, r * 0.95);
  ctx.lineTo(0, r * 1.14);
  ctx.closePath();
  ctx.fill();
  // rim
  ctx.strokeStyle = "rgba(0,0,0,0.22)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.92, r, 0, 0, Math.PI * 2);
  ctx.stroke();
  // glossy highlight
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.ellipse(-r * 0.3, -r * 0.38, r * 0.22, r * 0.32, -0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// the pin that juts from a spiking blob — its touch bursts balloons
function drawSpikePin(ctx: CanvasRenderingContext2D, x: number, y: number, facing: number, scale: number, intensity: number) {
  const base = PLAYER_RADIUS * scale * 0.6;
  const len = PLAYER_RADIUS * scale + 24;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(facing);
  ctx.globalAlpha = 0.55 + 0.45 * intensity;
  ctx.strokeStyle = "#e8eef2";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(base, 0);
  ctx.lineTo(len, 0);
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(len - 1, -4);
  ctx.lineTo(len + 12, 0);
  ctx.lineTo(len - 1, 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.arc(len + 12, 0, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// =================== GLASS BRIDGE ===================
// Client-side animation state for the local player's crossing. The server only
// reports row + stun; everything below — the climbing camera, the step onto the
// chosen tile, the shatter — is interpolated here so the choice actually reads.
const glass = {
  cam: 0, // eased camera row (follows the shared frontier)
  lastT: 0,
  inited: false,
  stepKey: "", // dedupes the server's lastStep so an animation fires once
  stepAt: -1, // rc.time of the last successful step (hop)
  shatterAt: -1, // rc.time of the last shatter
  shatterRow: -1,
  shatterSide: 0,
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
  const frontier: number = d.frontier ?? 0;
  const revealedSides: number[] = d.revealedSides || []; // per row: -1 unknown, 0 L, 1 R
  const brokeSide: number[] = d.brokeSide || [];
  const walkers: any[] = d.walkers || [];
  const activeId: string = d.activeId || "";
  const phase: string = d.phase || "choose";
  const last = d.lastStep as { id: string; row: number; side: number; ok: boolean } | null;
  const active = walkers.find((w) => w.id === activeId);
  const youActive = activeId === rc.youId && phase === "choose";

  // backdrop chasm
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#1a1030");
  g.addColorStop(1, "#06040f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // --- local animation clock + latch the server's last step / shatter once ---
  const dt = glass.lastT ? Math.min(0.05, Math.max(0, (rc.time - glass.lastT) / 1000)) : 0;
  glass.lastT = rc.time;
  if (last) {
    const key = `${last.id}:${last.row}:${last.ok}`;
    if (key !== glass.stepKey) {
      glass.stepKey = key;
      if (last.ok) glass.stepAt = rc.time;
      else {
        glass.shatterAt = rc.time;
        glass.shatterRow = last.row;
        glass.shatterSide = last.side;
      }
    }
  }
  if (!glass.inited) {
    glass.cam = frontier;
    glass.inited = true;
  }
  glass.cam += (frontier - glass.cam) * Math.min(1, dt * 8);
  const cam = glass.cam;

  // ----- left rail: the LINE (turn order, who's alive / out / up) -----
  ctx.save();
  ctx.font = "700 14px 'Baloo 2', sans-serif";
  ctx.fillStyle = "#b9a7d6";
  ctx.textAlign = "left";
  ctx.fillText("THE LINE", 24, 34);
  const railH = H - 90;
  const per = Math.max(1, Math.min(12, walkers.length));
  walkers.forEach((w: any, i: number) => {
    const yy = 60 + (i % per) * (railH / per);
    const xx = 24 + Math.floor(i / per) * 132;
    drawBlob(ctx, w.characterId, xx + 14, yy, {
      r: 12,
      time: rc.time,
      anim: w.finished ? "cheer" : w.alive ? "idle" : "dead",
      variant: rc.variants?.get(w.id), accessories: rc.accessories?.get(w.id),
    });
    if (w.id === activeId && w.alive && !w.finished) {
      ctx.strokeStyle = "#ffd54f";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(xx + 14, yy, 17, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.font = "700 12px 'Baloo 2', sans-serif";
    ctx.fillStyle = w.finished ? "#69f0ae" : !w.alive ? "#6b5a86" : w.id === activeId ? "#ffd54f" : "#cbb6ff";
    ctx.fillText(
      w.finished ? "SAFE ✓" : !w.alive ? "shattered" : w.id === activeId ? "▶ up now" : "waiting",
      xx + 32,
      yy + 4,
    );
  });
  ctx.restore();

  const cx = W / 2;
  const baseY = H - 120;
  const topY = 92;

  // ----- the shared bridge -----
  for (let r = Math.max(0, Math.floor(cam) - 1); r < rows; r++) {
    const depth = r - cam;
    const yy = baseY - depth * GLASS_ROW_H;
    if (yy < topY - 60) break;
    if (yy > H + 60) continue;
    const scale = Math.max(0.34, 1 - Math.max(0, depth) * 0.12);
    const tileW = 116 * scale;
    const gap = 40 * scale;
    const isFrontier = r === frontier;
    const safe = revealedSides[r]; // -1 unknown, 0 L, 1 R
    for (const sideIdx of [0, 1]) {
      const sign = sideIdx === 0 ? -1 : 1;
      const tx = cx + sign * (gap / 2 + tileW / 2);
      const recentShatter = glass.shatterRow === r && glass.shatterSide === sideIdx && rc.time - glass.shatterAt < 520;
      ctx.save();
      ctx.globalAlpha = isFrontier ? 1 : Math.max(0.2, 0.7 - Math.max(0, depth) * 0.05);
      if (recentShatter) {
        drawShatteredTile(ctx, tx, yy, tileW, scale, rc.time - glass.shatterAt);
      } else if (safe >= 0 && safe !== sideIdx) {
        // KNOWN unsafe side — drawn as a gaping hole (it's been exposed)
        ctx.globalAlpha *= 0.4;
        ctx.fillStyle = "rgba(10,6,20,0.6)";
        ctx.strokeStyle = "rgba(120,90,160,0.35)";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 6]);
        roundRect(ctx, tx - tileW / 2, yy - 26 * scale, tileW, 52 * scale, 10);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        const known = safe === sideIdx; // a revealed SAFE pane
        const grad = ctx.createLinearGradient(tx, yy - 30, tx, yy + 30);
        if (known) {
          grad.addColorStop(0, "rgba(105,240,174,0.6)");
          grad.addColorStop(1, "rgba(46,184,124,0.3)");
        } else {
          grad.addColorStop(0, "rgba(180,235,255,0.55)");
          grad.addColorStop(1, "rgba(120,200,255,0.22)");
        }
        ctx.fillStyle = grad;
        ctx.strokeStyle = known ? "#69f0ae" : isFrontier ? "#b9f6ff" : "rgba(180,235,255,0.45)";
        ctx.lineWidth = isFrontier ? 4 : 2;
        roundRect(ctx, tx - tileW / 2, yy - 26 * scale, tileW, 52 * scale, 10);
        ctx.fill();
        ctx.stroke();
        if (known) {
          ctx.fillStyle = "#eafff3";
          ctx.font = `800 ${22 * scale}px 'Baloo 2', sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText("✓", tx, yy + 8 * scale);
        } else if (isFrontier && youActive) {
          // arrows only when it's actually YOUR turn to pick
          ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.font = `800 ${26 * scale}px 'Baloo 2', sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(sign < 0 ? "◀" : "▶", tx, yy + 9 * scale);
        }
      }
      ctx.restore();
    }
  }

  // ----- the active blob, standing at the frontier row -----
  if (active && active.alive && !active.finished && (phase === "choose" || phase === "step" || phase === "resolve")) {
    const depth = frontier - cam;
    const fy = baseY - depth * GLASS_ROW_H;
    const fScale = Math.max(0.55, 1 - Math.max(0, depth) * 0.12);
    const hop = rc.time - glass.stepAt < 350 ? Math.sin(((rc.time - glass.stepAt) / 350) * Math.PI) * 16 : 0;
    const justBroke = last && !last.ok && glass.shatterRow === frontier && rc.time - glass.shatterAt < 500;
    if (!justBroke) {
      drawBlob(ctx, active.characterId, cx, fy + 36 * fScale - hop, {
        r: 34,
        time: rc.time,
        anim: "idle",
        name: active.name,
        number: rc.numbers?.get(active.id),
        variant: rc.variants?.get(active.id), accessories: rc.accessories?.get(active.id),
        you: active.id === rc.youId,
      });
    }
  }

  // ----- header / prompt -----
  ctx.textAlign = "center";
  ctx.font = "800 22px 'Baloo 2', sans-serif";
  ctx.fillStyle = "#fff";
  ctx.fillText(`Pane ${Math.min(frontier + 1, rows)} / ${rows}`, cx, topY - 30);

  if (phase === "done") {
    ctx.fillStyle = "#69f0ae";
    ctx.font = "800 30px 'Baloo 2', sans-serif";
    ctx.fillText("🏁 Across! The pattern's cracked.", cx, topY);
  } else if (youActive) {
    ctx.fillStyle = "#ffd54f";
    ctx.font = "800 24px 'Baloo 2', sans-serif";
    ctx.fillText("YOUR TURN — pick a pane!", cx, topY);
    // turn timer bar
    const tl = Math.max(0, Math.min(1, (d.turnTimeLeft ?? 0) / 6));
    const barW = Math.min(360, W * 0.4);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    roundRect(ctx, cx - barW / 2, topY + 12, barW, 10, 5);
    ctx.fill();
    ctx.fillStyle = tl > 0.4 ? "#69f0ae" : "#ff5252";
    roundRect(ctx, cx - barW / 2, topY + 12, barW * tl, 10, 5);
    ctx.fill();
  } else if (active) {
    ctx.fillStyle = "#ffd54f";
    ctx.font = "800 18px 'Baloo 2', sans-serif";
    ctx.fillText(`👁 ${active.name} is choosing…`, cx, topY);
  }
}

// =================== TUG OF WAR ===================
// Local clock for the lose animation (when does the losing team start to fall).
const tug = { loseAt: 0, loser: -1 };
function renderTug(ctx: CanvasRenderingContext2D, W: number, H: number, cur: Snapshot, rc: RenderCtx) {
  const d = cur.data || {};

  // Pre-round "3·2·1·GO" hold: the server freezes all pulling until startAt, so
  // until then NOBODY (bots included) is allowed to heave — render them braced
  // and waiting, not mid-pull, so it never looks like the bots got a head start.
  const frozen = cur.startAt != null && Date.now() < cur.startAt;

  // ropePos > 0 → team 0 (left) is winning; < 0 → team 1 (right) is winning.
  const ropePos = d.ropePos || 0;
  const rp = Math.max(-1, Math.min(1, ropePos));
  const loserTeam: number = d.loserTeam ?? -1;
  if (loserTeam >= 0 && tug.loser !== loserTeam) {
    tug.loser = loserTeam;
    tug.loseAt = rc.time;
  }
  if (loserTeam < 0) {
    tug.loser = -1;
    tug.loseAt = 0;
  }
  const fallT = loserTeam >= 0 && tug.loseAt ? Math.max(0, (rc.time - tug.loseAt) / 1000) : 0;

  // ---- local mash feedback: when YOU tap, jerk the knot toward your side and
  // pulse your blob right away, before the next 20Hz snapshot reflects the pull.
  // Otherwise the rope only shows *net* force and mashing feels like it does
  // nothing whenever your side is losing the tug. ----
  const live = !frozen && loserTeam < 0;
  const mashPulse = live ? Math.max(0, 1 - (rc.time - mashFx.lastTapAt) / 200) : 0;
  const myTeam = (d.pullers || []).find((p: any) => p.id === rc.youId)?.team;
  const mySide = myTeam === 0 ? -1 : myTeam === 1 ? 1 : 0; // -1 left, +1 right, 0 = spectating

  // ---- canyon backdrop: two solid platforms with a deadly chasm between them ----
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#241b10");
  sky.addColorStop(1, "#0c0a08");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  const groundY = H * 0.6; // top surface the blobs stand on
  const pitHalf = Math.min(190, W * 0.16); // half-width of the central pit
  const pitL = W / 2 - pitHalf;
  const pitR = W / 2 + pitHalf;

  // the pit — a dark void dropping away under the rope ("underneath", as asked)
  const voidG = ctx.createLinearGradient(0, groundY - 20, 0, H);
  voidG.addColorStop(0, "#100a06");
  voidG.addColorStop(0.6, "#060403");
  voidG.addColorStop(1, "#000");
  ctx.fillStyle = voidG;
  ctx.fillRect(pitL, groundY - 20, pitHalf * 2, H - groundY + 20);
  // a faint menacing glow at the very bottom of the pit
  const glow = ctx.createRadialGradient(W / 2, H + 40, 10, W / 2, H + 40, pitHalf * 1.6);
  glow.addColorStop(0, "rgba(255,60,0,0.28)");
  glow.addColorStop(1, "rgba(255,60,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(pitL, groundY, pitHalf * 2, H - groundY);

  // the two platforms (left = team 0, right = team 1)
  const drawPlatform = (x0: number, x1: number) => {
    const pg = ctx.createLinearGradient(0, groundY, 0, H);
    pg.addColorStop(0, "#6a513a");
    pg.addColorStop(1, "#2c2014");
    ctx.fillStyle = pg;
    ctx.fillRect(x0, groundY, x1 - x0, H - groundY);
    ctx.fillStyle = "#8a6c4a";
    ctx.fillRect(x0, groundY, x1 - x0, 8); // grassy/rock lip
  };
  drawPlatform(0, pitL);
  drawPlatform(pitR, W);

  // "THE PIT" label down in the chasm
  ctx.save();
  ctx.fillStyle = "rgba(255,82,82,0.8)";
  ctx.font = "800 20px 'Baloo 2', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("THE PIT", W / 2, groundY + 54);
  ctx.restore();

  // ---- the rope + knot. The knot slides toward the WINNING team (no flag). ----
  const ropeY = groundY - 40;
  const knotX = W / 2 - rp * (pitHalf - 26) + mySide * mashPulse * 8; // rp>0 → slides left toward team 0; +local tap jerk
  ctx.strokeStyle = "#caa15a";
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(70, ropeY);
  // rope sags slightly through the knot
  ctx.quadraticCurveTo(knotX, ropeY + 10, W - 70, ropeY);
  ctx.stroke();
  ctx.lineCap = "butt";
  // the center knot — a fat red-wrapped binding marking the middle of the rope
  ctx.save();
  ctx.translate(knotX, ropeY + 6);
  ctx.fillStyle = Math.abs(rp) > 0.45 ? "#ff5252" : "#ffd54f";
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  roundRect(ctx, -12, -16, 24, 32, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(-12, -3, 24, 6);
  ctx.restore();

  // ---- teams ----
  const t0 = (d.pullers || []).filter((p: any) => p.team === 0);
  const t1 = (d.pullers || []).filter((p: any) => p.team === 1);
  // the whole tug-of-war leans toward the winning side as the rope slides
  const lean = -rp * (pitHalf * 0.5);

  const drawTeam = (team: any[], side: number) => {
    // side: -1 = left (team 0), +1 = right (team 1)
    const losing = side < 0 ? loserTeam === 0 : loserTeam === 1;
    const edge = side < 0 ? pitL : pitR; // inner edge of this team's platform
    team.forEach((p: any, i: number) => {
      // anchored back from the pit edge on their OWN ledge, in two rows, leaning
      // toward the rope (see lib/shared/tug.ts — keeps them off the pit at start)
      let bx = pullerStandX(edge, side < 0 ? -1 : 1, i, lean);
      let by = groundY - 18 + (i % 2 === 0 ? -26 : 14);
      // braced & still during the GO hold; mid-pull "run" only once it's live
      let anim = frozen ? "idle" : "run";
      let rot = 0;
      let alpha = 1;
      if (losing && fallT > 0) {
        // dragged off the edge and tumbling into the chasm
        const prog = Math.min(1, fallT / 1.3 + i * 0.04);
        bx = lerp(bx, W / 2, Math.min(1, prog * 1.4));
        by = groundY - 18 + prog * prog * (H - groundY + 90);
        rot = prog * (side < 0 ? 3.2 : -3.2);
        alpha = Math.max(0, 1 - prog * 0.9);
        anim = "fall";
      } else if (loserTeam >= 0 && !losing) {
        anim = "cheer"; // winners celebrate
      }
      const sway = frozen || losing || loserTeam >= 0 ? 0 : Math.sin(rc.time * 0.02 + i) * 5;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(bx + sway, by);
      if (rot) ctx.rotate(rot);
      drawBlob(ctx, p.characterId, 0, 0, {
        r: 30,
        time: rc.time,
        anim,
        facing: side < 0 ? 0 : Math.PI, // face the rope
        name: p.name,
        number: rc.numbers?.get(p.id),
        variant: rc.variants?.get(p.id), accessories: rc.accessories?.get(p.id),
        you: p.id === rc.youId,
      });
      // your own per-tap pulse: an expanding ring that pops on each mash
      if (p.id === rc.youId && mashPulse > 0 && anim !== "fall") {
        ctx.globalAlpha = alpha * mashPulse * 0.8;
        ctx.strokeStyle = "#ffe27a";
        ctx.lineWidth = 3 + mashPulse * 3;
        ctx.beginPath();
        ctx.arc(0, 0, 34 + (1 - mashPulse) * 22, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    });
  };
  drawTeam(t0, -1);
  drawTeam(t1, 1);
  ctx.globalAlpha = 1;

  // labels
  ctx.font = "800 22px 'Baloo 2', sans-serif";
  ctx.fillStyle = loserTeam === 0 ? "#ff5252" : "#1fe3c2";
  ctx.textAlign = "left";
  ctx.fillText(`🟦 Team 1  (${t0.length})`, 40, 44);
  ctx.fillStyle = loserTeam === 1 ? "#ff5252" : "#ff8fb3";
  ctx.textAlign = "right";
  ctx.fillText(`Team 2 🟥  (${t1.length})`, W - 40, 44);

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
    drawBlob(ctx, oppChar, W / 2, H * 0.26, { r: 56, time: rc.time, anim: "idle", name: oppName, number: rc.numbers?.get(oppId), variant: rc.variants?.get(oppId), accessories: rc.accessories?.get(oppId), facing: Math.PI / 2 });
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

  // Live countdown under the phase label — stalling past zero forfeits the duel,
  // so make the ticking clock impossible to miss (red once it gets tight).
  if (duel.status !== "done" && (d.phase === "pick" || d.phase === "drop") && typeof d.timeLeft === "number") {
    const secs = Math.max(0, Math.ceil(d.timeLeft));
    ctx.font = "800 18px 'Baloo 2', sans-serif";
    ctx.fillStyle = d.timeLeft <= 2 ? "#ff5252" : "#b9a7d6";
    ctx.fillText(`⏱ ${secs}s · or forfeit`, W / 2, H * 0.5 + 52);
  }

  // you (bottom)
  if (meChar) {
    drawBlob(ctx, meChar, W / 2, H * 0.74, { r: 60, time: rc.time, anim: duel.status === "done" && duel.winner === (youAreA ? duel.a : duel.b) ? "cheer" : "idle", name: meName, number: rc.numbers?.get(meId), variant: rc.variants?.get(meId), accessories: rc.accessories?.get(meId), you: true, facing: -Math.PI / 2 });
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
      variant: rc.variants?.get(j.id), accessories: rc.accessories?.get(j.id),
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

// =================== SIMON SAYS (obey the order, or freeze) ===================
function renderSimon(ctx: CanvasRenderingContext2D, W: number, H: number, cur: Snapshot, rc: RenderCtx) {
  const d: any = cur.data || {};
  const phase: string = d.phase || "ready";
  const cmd = d.command as { key: string; label: string; emoji: string; freeze: boolean } | null;
  const freeze = !!d.freeze;
  const contestants: any[] = d.contestants || [];
  const t = rc.time;

  // backdrop — an icy wash on a freeze, the usual pink stage otherwise
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  if (freeze && phase === "call") {
    bg.addColorStop(0, "#0e2a3a");
    bg.addColorStop(1, "#060d16");
  } else {
    bg.addColorStop(0, "#2a1240");
    bg.addColorStop(1, "#0b0713");
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // ---- top banner: the order ----
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = "#b9a7d6";
  ctx.font = "800 18px 'Baloo 2', sans-serif";
  ctx.fillText(`Order ${d.beat || 1}`, W / 2, 40);

  if (phase === "ready" || !cmd) {
    const pulse = 0.6 + 0.4 * Math.sin(t * 0.012);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = "#ffd54f";
    ctx.font = `800 ${Math.round(Math.min(64, W * 0.06))}px 'Baloo 2', sans-serif`;
    ctx.fillText("🙆 Simon says…", W / 2, H * 0.2);
    ctx.globalAlpha = 1;
  } else {
    const big = Math.round(Math.min(74, W * 0.07));
    if (freeze) {
      const flash = 0.7 + 0.3 * Math.sin(t * 0.03);
      ctx.fillStyle = `rgba(187,233,255,${flash})`;
      ctx.font = `${big + 8}px serif`;
      ctx.fillText("🧊", W / 2, H * 0.16);
      ctx.fillStyle = "#bbe9ff";
      ctx.font = `800 ${big}px 'Baloo 2', sans-serif`;
      ctx.fillText("FREEZE!", W / 2, H * 0.16 + big * 0.95);
      ctx.fillStyle = "#7fd6ff";
      ctx.font = "800 22px 'Baloo 2', sans-serif";
      ctx.fillText(phase === "judge" ? "Hands off was the move." : "DON'T TOUCH ANYTHING", W / 2, H * 0.16 + big * 1.5);
    } else {
      ctx.font = `${big + 6}px serif`;
      ctx.fillText(cmd.emoji, W / 2, H * 0.16);
      ctx.fillStyle = "#fff";
      ctx.font = `800 ${big}px 'Baloo 2', sans-serif`;
      ctx.fillText(cmd.label.toUpperCase(), W / 2, H * 0.16 + big * 0.95);
      // Spell out exactly which key/button does it, so nobody has to squint at
      // the tiny legend to figure out the mapping mid-panic.
      const keyLabel = simonByKey(cmd.key)?.keyLabel;
      if (keyLabel && phase === "call") {
        ctx.fillStyle = "#ffd54f";
        ctx.font = "800 30px 'Baloo 2', sans-serif";
        ctx.fillText(`▶ press  ${keyLabel}  ◀`, W / 2, H * 0.16 + big * 1.5);
      }
    }
    // judge sub-line: how many got boxed this order
    if (phase === "judge") {
      const outNow = contestants.filter((c) => c.result === "out").length;
      ctx.font = "800 22px 'Baloo 2', sans-serif";
      ctx.fillStyle = outNow ? "#ff5252" : "#69f0ae";
      ctx.fillText(outNow ? `💥 ${outNow} eliminated` : "✅ Everyone obeyed!", W / 2, H * 0.16 + big * 1.5);
    }
  }
  ctx.restore();

  // ---- reaction timer bar (only while the window is open) ----
  if (phase === "call") {
    const react = Math.max(0, Math.min(1, d.react || 0));
    const left = 1 - react;
    const barW = Math.min(560, W * 0.55);
    const barX = (W - barW) / 2;
    const barY = H * 0.31;
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    roundRect(ctx, barX, barY, barW, 16, 8);
    ctx.fill();
    const col = left > 0.5 ? "#69f0ae" : left > 0.25 ? "#ffd54f" : "#ff5252";
    ctx.fillStyle = freeze ? "#7fd6ff" : col;
    roundRect(ctx, barX, barY, Math.max(0, barW * left), 16, 8);
    ctx.fill();
    ctx.restore();
  }

  // ---- contestants grid ----
  const n = contestants.length;
  if (n > 0) {
    const cols = Math.min(n, n <= 5 ? n : Math.ceil(Math.sqrt(n * 1.8)));
    const rows = Math.ceil(n / cols);
    const areaTop = H * 0.4;
    const areaBot = H * 0.92;
    const cellW = (W - 80) / cols;
    const cellH = (areaBot - areaTop) / rows;
    const startX = (W - cellW * cols) / 2;
    const r = Math.max(15, Math.min(46, Math.min(cellW, cellH) * 0.3));

    contestants.forEach((c, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * cellW + cellW / 2;
      const y = areaTop + row * cellH + cellH * 0.5;

      if (!c.alive) {
        drawCoffin(ctx, x, y, r / PLAYER_RADIUS, t, coffinAge(rc, c.id));
        return;
      }

      const safe = phase === "judge" && c.result === "safe";
      drawBlob(ctx, c.characterId, x, y, {
        r,
        time: t,
        anim: safe ? "cheer" : "idle",
        name: n <= 8 ? c.name : undefined,
        number: rc.numbers?.get(c.id),
        variant: rc.variants?.get(c.id), accessories: rc.accessories?.get(c.id),
        you: c.id === rc.youId,
      });

      // bubble above the blob: what they did / their verdict
      let bubble = "";
      let faint = false;
      if (phase === "call") {
        if (c.did) bubble = simonEmoji(c.did);
        else {
          bubble = "❓";
          faint = true;
        }
      } else if (phase === "judge") {
        bubble = safe ? "✅" : "";
      }
      if (bubble) {
        ctx.save();
        ctx.globalAlpha = faint ? 0.4 : 1;
        ctx.font = `${Math.round(r * 1.1)}px serif`;
        ctx.textAlign = "center";
        ctx.fillText(bubble, x, y - r * 1.5 + Math.sin(t * 0.006 + i) * 2);
        ctx.restore();
      }
    });
  }

  // ---- danger vignette on a live freeze ----
  if (freeze && phase === "call") {
    ctx.save();
    ctx.strokeStyle = `rgba(127,214,255,${0.25 + 0.2 * Math.sin(t * 0.02)})`;
    ctx.lineWidth = 14;
    ctx.strokeRect(7, 7, W - 14, H - 14);
    ctx.restore();
  }

  rc.fx.draw(ctx);
}

// =================== CHUTES & LADDERS (board) ===================
// Smoothly-eased pawn positions + latched "+N 🪜 / −N 🐍" pop labels, kept out of
// the snapshot so the climb reads as motion instead of teleporting each roll.
const board = {
  pos: new Map<string, { x: number; y: number }>(),
  prevSq: new Map<string, number>(),
  prevAlive: new Map<string, boolean>(),
  label: new Map<string, { text: string; color: string; at: number }>(),
  lastT: 0,
};
// Chute fork outcome → colour / icon. -1 unknown, 0 = back to start, 1 = abyss.
const CHUTE_COL: Record<number, string> = { [-1]: "#b06be6", 0: "#26c6da", 1: "#ff4d6d" };
const CHUTE_ICON: Record<number, string> = { [-1]: "❓", 0: "🌀", 1: "💀" };
const DIE_PIPS: Record<number, number[][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

function renderBoard(ctx: CanvasRenderingContext2D, W: number, H: number, cur: Snapshot, rc: RenderCtx) {
  const d: any = cur.data || {};
  const cols: number = d.cols || 8;
  const rows: number = d.rows || 8;
  const goal: number = d.goal || 64;
  const climbers: any[] = d.climbers || [];
  const chutes: any[] = d.chutes || [];
  const chuteSquares = new Set<number>(chutes.map((s) => s.square));

  // backdrop
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#241433");
  bg.addColorStop(1, "#0c0717");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // ---- board geometry: a big centred square grid, slim header for the timer ----
  const headerH = 52;
  const size = Math.max(220, Math.min(W - 40, H - headerH - 96));
  const cell = size / cols;
  const bx = (W - size) / 2;
  const by = headerH;

  const cellCenter = (square: number): { x: number; y: number } => {
    if (square <= 0) return { x: bx + cell * 0.5, y: by + size + cell * 0.6 }; // start pad
    const s = Math.min(square, goal);
    const r = Math.floor((s - 1) / cols); // 0 = bottom row
    const within = (s - 1) % cols;
    const col = r % 2 === 0 ? within : cols - 1 - within; // serpentine
    return { x: bx + col * cell + cell / 2, y: by + (rows - 1 - r) * cell + cell / 2 };
  };

  // ---- prominent countdown: reach the top before it empties or you're culled ----
  const tl = Math.max(0, d.timeLeft ?? 0);
  const dur = d.duration || 1;
  const frac = Math.max(0, Math.min(1, tl / dur));
  const lowTime = tl < 8;
  const tcol = tl <= 5 ? "#ff4d6d" : tl <= 12 ? "#ffd54f" : "#69f0ae";
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = "800 19px 'Baloo 2', sans-serif";
  ctx.fillStyle = "#fff";
  ctx.fillText(`🪜 RACE TO 🏁 ${goal} — reach the top or be eliminated`, W / 2, 18);
  const barY = 28;
  const barH = 14;
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  roundRect(ctx, bx, barY, size, barH, 7);
  ctx.fill();
  const pulse = lowTime ? 0.6 + 0.4 * Math.sin(rc.time * 0.02) : 1;
  ctx.globalAlpha = pulse;
  ctx.fillStyle = tcol;
  roundRect(ctx, bx, barY, Math.max(0, size * frac), barH, 7);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.textAlign = "right";
  ctx.font = `800 ${lowTime ? 20 : 16}px 'Baloo 2', sans-serif`;
  ctx.fillStyle = tcol;
  ctx.fillText(`⏱ ${Math.ceil(tl)}s`, bx + size, barY - 2);
  ctx.restore();

  // ---- the grid of numbered cells ----
  ctx.save();
  for (let s = 1; s <= goal; s++) {
    const c = cellCenter(s);
    const r = Math.floor((s - 1) / cols);
    const within = (s - 1) % cols;
    const col = r % 2 === 0 ? within : cols - 1 - within;
    const checker = (r + col) % 2 === 0;
    ctx.fillStyle = checker ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.025)";
    ctx.fillRect(c.x - cell / 2, c.y - cell / 2, cell, cell);
    if (s === goal) {
      ctx.fillStyle = "rgba(105,240,174,0.2)";
      ctx.fillRect(c.x - cell / 2, c.y - cell / 2, cell, cell);
    }
    ctx.fillStyle = s === goal ? "#69f0ae" : "rgba(201,184,230,0.5)";
    ctx.font = `${Math.round(cell * 0.2)}px 'Baloo 2', sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(s === goal ? `🏁${goal}` : String(s), c.x - cell / 2 + 5, c.y - cell / 2 + 4);
  }
  // outer frame
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 3;
  ctx.strokeRect(bx, by, size, size);
  ctx.textBaseline = "alphabetic";
  ctx.restore();

  // ---- ladders (auto-climb) ----
  for (const l of d.ladders || []) drawLadder(ctx, cellCenter(l.from), cellCenter(l.to), cell);
  // ---- chutes (forks: pick a side — one resets you, one is the abyss) ----
  for (const s of chutes) drawChuteFork(ctx, cellCenter(s.square), cell, s.left ?? -1, s.right ?? -1, rc.time);

  // ---- advance eased pawn positions + latch pop labels for what just happened ----
  const dt = board.lastT ? Math.min(0.05, Math.max(0, (rc.time - board.lastT) / 1000)) : 0;
  board.lastT = rc.time;
  for (const c of climbers) {
    const target = cellCenter(c.square);
    const prevSq = board.prevSq.get(c.id);
    const wasAlive = board.prevAlive.get(c.id);
    let p = board.pos.get(c.id);
    // snap on (re)spawn / round reset / a reset-to-start bounce
    if (!p || c.square <= 0 || prevSq === undefined) {
      p = { x: target.x, y: target.y };
      board.pos.set(c.id, p);
    } else {
      p.x += (target.x - p.x) * Math.min(1, dt * 10);
      p.y += (target.y - p.y) * Math.min(1, dt * 10);
    }
    // just died? label the abyss (a chute death) vs running out of time
    if (wasAlive && !c.alive) {
      const fellInPit = prevSq !== undefined && chuteSquares.has(prevSq);
      board.label.set(c.id, fellInPit
        ? { text: "ABYSS! 💀", color: "#ff4d6d", at: rc.time }
        : { text: "OUT! ⏱", color: "#ff8a80", at: rc.time });
    } else if (prevSq !== undefined && c.square !== prevSq) {
      const delta = c.square - prevSq;
      if (c.square >= goal) board.label.set(c.id, { text: "SAFE! 🏁", color: "#69f0ae", at: rc.time });
      else if (c.square === 0 && prevSq > 0) board.label.set(c.id, { text: "BACK TO START 🌀", color: "#26c6da", at: rc.time });
      else if (delta > 6) board.label.set(c.id, { text: `CLIMB +${delta} 🪜`, color: "#69f0ae", at: rc.time });
    }
    board.prevSq.set(c.id, c.square);
    board.prevAlive.set(c.id, c.alive);
  }

  // ---- cluster pawns sharing a cell so they don't fully overlap ----
  const bySquare = new Map<number, any[]>();
  for (const c of climbers) {
    const k = c.alive ? c.square : -1000 - c.square; // dead drawn at their last cell
    if (!bySquare.has(k)) bySquare.set(k, []);
    bySquare.get(k)!.push(c);
  }
  const offsetFor = (i: number, n: number, sq: number): { ox: number; oy: number } => {
    if (n <= 1) return { ox: 0, oy: 0 };
    if (sq <= 0) {
      // spread the starting crowd along the pad
      return { ox: (i - (n - 1) / 2) * Math.min(cell * 0.5, (size - cell) / Math.max(1, n - 1)), oy: 0 };
    }
    const ang = (i / n) * Math.PI * 2;
    const rad = cell * 0.22 * (n > 4 ? 1.3 : 1);
    return { ox: Math.cos(ang) * rad, oy: Math.sin(ang) * rad };
  };

  const pawnR = Math.max(13, cell * 0.3);

  // draw order: coffins first (under), then living pawns sorted so YOU is on top
  const drawList = [...climbers].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? 1 : -1;
    if ((a.id === rc.youId) !== (b.id === rc.youId)) return a.id === rc.youId ? 1 : -1;
    return 0;
  });

  for (const c of drawList) {
    const p = board.pos.get(c.id) || cellCenter(c.square);
    const groupKey = c.alive ? c.square : -1000 - c.square;
    const group = bySquare.get(groupKey)!;
    const idx = group.indexOf(c);
    const { ox, oy } = offsetFor(idx, group.length, c.square);
    const x = p.x + ox;
    const y = p.y + oy;

    if (!c.alive) {
      drawCoffin(ctx, x, y, pawnR / PLAYER_RADIUS, rc.time, coffinAge(rc, c.id));
      drawPopLabel(ctx, c.id, x, y, pawnR, rc.time);
      continue;
    }

    // at a fork: highlight + prompt (loud for YOU). This is the key decision beat.
    if (c.choosing >= 0) {
      const fp = 0.5 + 0.5 * Math.sin(rc.time * 0.012);
      ctx.save();
      ctx.strokeStyle = `rgba(176,107,230,${0.55 + 0.4 * fp})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y, pawnR * 1.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (lowTime && !c.finished && c.id === rc.youId) {
      // only ring YOU when the clock is low — keeps the board readable
      const dpulse = 0.5 + 0.5 * Math.sin(rc.time * 0.02);
      ctx.save();
      ctx.strokeStyle = `rgba(255,60,60,${0.55 + 0.4 * dpulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, pawnR * 1.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    drawBlob(ctx, c.characterId, x, y, {
      r: pawnR,
      time: rc.time,
      anim: c.finished ? "cheer" : "idle",
      name: group.length <= 3 ? c.name : undefined,
      number: rc.numbers?.get(c.id),
      variant: rc.variants?.get(c.id), accessories: rc.accessories?.get(c.id),
      you: c.id === rc.youId,
    });
    if (c.finished) {
      ctx.font = `${Math.round(pawnR)}px serif`;
      ctx.textAlign = "center";
      ctx.fillText("👑", x, y - pawnR * 1.7);
    }

    // last-rolled die face, floating beside the pawn
    if (c.die > 0) drawDie(ctx, x + pawnR * 1.2, y - pawnR * 1.2, Math.max(14, pawnR * 0.9), c.die);

    // fork prompt sits above everything so it's never missed
    if (c.choosing >= 0) {
      const fp = 0.5 + 0.5 * Math.sin(rc.time * 0.012);
      const me = c.id === rc.youId;
      ctx.save();
      ctx.textAlign = "center";
      ctx.fillStyle = me ? "#ffd54f" : "rgba(255,213,79,0.9)";
      ctx.font = `800 ${Math.round(pawnR * (me ? 1.05 : 0.8))}px 'Baloo 2', sans-serif`;
      ctx.fillText("◀ PICK ▶", x, y - pawnR * 2.0 - fp * 4);
      ctx.restore();
    }

    drawPopLabel(ctx, c.id, x, y, pawnR, rc.time);
  }
}

// A short-lived floating label above a pawn (ladder climb / reset / safe / death).
function drawPopLabel(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, pawnR: number, time: number) {
  const lab = board.label.get(id);
  if (!lab) return;
  const age = (time - lab.at) / 1000;
  if (age >= 1.1) {
    board.label.delete(id);
    return;
  }
  ctx.save();
  ctx.globalAlpha = 1 - age / 1.1;
  ctx.fillStyle = lab.color;
  ctx.font = `800 ${Math.round(pawnR * 0.95)}px 'Baloo 2', sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(lab.text, x, y - pawnR * 2.4 - age * 26);
  ctx.restore();
}

function drawLadder(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, cell: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len; // perpendicular
  const ny = dx / len;
  const w = Math.min(cell * 0.22, 16);
  ctx.save();
  ctx.strokeStyle = "#d9a05b";
  ctx.lineWidth = Math.max(3, cell * 0.06);
  ctx.lineCap = "round";
  // two rails
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(a.x + nx * w * s, a.y + ny * w * s);
    ctx.lineTo(b.x + nx * w * s, b.y + ny * w * s);
    ctx.stroke();
  }
  // rungs
  ctx.strokeStyle = "#b97f3e";
  ctx.lineWidth = Math.max(2, cell * 0.04);
  const rungs = Math.max(2, Math.floor(len / (cell * 0.42)));
  for (let i = 1; i < rungs; i++) {
    const t = i / rungs;
    const cx = a.x + dx * t;
    const cy = a.y + dy * t;
    ctx.beginPath();
    ctx.moveTo(cx + nx * w, cy + ny * w);
    ctx.lineTo(cx - nx * w, cy - ny * w);
    ctx.stroke();
  }
  ctx.restore();
}

// A chute is a FORK: one square that splits two ways. `left`/`right` are the side
// outcomes (-1 unknown, 0 = back to start, 1 = abyss). Until a side is taken it's
// a mystery (❓); once someone tries it, it's revealed (🌀 reset / 💀 abyss) for all.
function drawChuteFork(
  ctx: CanvasRenderingContext2D,
  center: { x: number; y: number },
  cell: number,
  left: number,
  right: number,
  t: number,
) {
  const armX = cell * 0.62;
  const armY = cell * 0.5;
  const ends = [
    { o: left, x: center.x - armX, y: center.y + armY },
    { o: right, x: center.x + armX, y: center.y + armY },
  ];
  const pulse = 0.7 + 0.3 * Math.sin(t * 0.005);
  ctx.save();
  // tint the fork square so it reads as a hazard
  ctx.fillStyle = "rgba(176,107,230,0.16)";
  ctx.fillRect(center.x - cell / 2, center.y - cell / 2, cell, cell);
  // the two slides diverging from the square
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(4, cell * 0.09);
  for (const e of ends) {
    ctx.strokeStyle = CHUTE_COL[e.o] || CHUTE_COL[-1];
    ctx.globalAlpha = e.o === -1 ? pulse : 1;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(e.x, e.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // fork node
  ctx.fillStyle = "#7e3fb8";
  ctx.beginPath();
  ctx.arc(center.x, center.y, cell * 0.15, 0, Math.PI * 2);
  ctx.fill();
  // end badges with their icon
  const br = cell * 0.21;
  for (const e of ends) {
    ctx.fillStyle = CHUTE_COL[e.o] || CHUTE_COL[-1];
    ctx.globalAlpha = e.o === -1 ? pulse : 1;
    ctx.beginPath();
    ctx.arc(e.x, e.y, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.round(br * 1.25)}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(CHUTE_ICON[e.o] || CHUTE_ICON[-1], e.x, e.y + 1);
  }
  ctx.textBaseline = "alphabetic";
  ctx.restore();
}

function drawDie(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, val: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = Math.max(1, s * 0.06);
  roundRect(ctx, -s / 2, -s / 2, s, s, s * 0.18);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#241a33";
  const pr = s * 0.1;
  for (const [px, py] of DIE_PIPS[val] || []) {
    ctx.beginPath();
    ctx.arc(px * s * 0.26, py * s * 0.26, pr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
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

// =================== KING OF THE LAVA ISLANDS (lava floor + sinking islands) ===================
function drawLava(ctx: CanvasRenderingContext2D, d: any, t: number) {
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
  // the islands — various sizes, sinking into the magma
  for (const isl of d.islands || []) drawIsland(ctx, isl.x, isl.y, isl.r, t, !!isl.final);
}

function drawIsland(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, t: number, final: boolean) {
  if (R < 3) return;
  ctx.save();
  // molten halo bleeding into the lava — reads as the island slowly sinking
  const halo = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R + 16);
  halo.addColorStop(0, "rgba(255,90,10,0)");
  halo.addColorStop(1, "rgba(255,120,20,0.5)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, R + 16, 0, Math.PI * 2);
  ctx.fill();
  // rock surface
  const hg = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R);
  hg.addColorStop(0, final ? "#6f9a44" : "#5d8a3a");
  hg.addColorStop(1, "#37521f");
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  // glowing molten rim where rock meets lava
  ctx.lineWidth = 7;
  ctx.strokeStyle = `rgba(255,${120 + Math.floor(60 * Math.sin(t * 0.01 + cx * 0.05))},40,0.95)`;
  ctx.shadowColor = "#ff6d00";
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
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
    // spell out the whole rule: move NOW, and the chairs only appear once it stops
    ctx.fillStyle = "#69f0ae";
    ctx.fillText("🎵 KEEP MOVING!", ARENA_W / 2, 70);
    ctx.font = "700 20px 'Baloo 2', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText("stand still and you're OUT · chairs drop when the music STOPS", ARENA_W / 2, 96);
  } else if (d.phase === "scramble") {
    ctx.fillStyle = "#ff5252";
    ctx.fillText("🪑 GRAB A CHAIR!", ARENA_W / 2, 70);
  }
  ctx.restore();
  for (const c of d.chairs || []) drawStool(ctx, c.x, c.y, c.claimed, d.phase);
}

// A floating "⚠ MOVE!" countdown over any blob that's stopped dancing during the
// music, and a loud banner when that blob is YOU — so the keep-moving rule is
// unmistakable and nobody's eliminated without a clear, ticking heads-up.
function drawChairsWarn(ctx: CanvasRenderingContext2D, d: any, actors: Actor[], rc: RenderCtx) {
  const warn: { id: string; left: number }[] = d.warn || [];
  if (!warn.length) return;
  const pulse = 0.5 + 0.5 * Math.sin(rc.time * 0.03);
  ctx.save();
  ctx.textAlign = "center";
  for (const w of warn) {
    const a = actors.find((x) => x.id === w.id);
    if (!a) continue;
    const y = a.y - PLAYER_RADIUS * 2.1;
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 6;
    ctx.fillStyle = `rgba(255,82,82,${0.6 + 0.4 * pulse})`;
    ctx.font = "900 26px 'Baloo 2', sans-serif";
    ctx.fillText("⚠ MOVE!", a.x, y);
    ctx.fillStyle = "#fff";
    ctx.font = "800 19px 'Baloo 2', sans-serif";
    ctx.fillText(w.left.toFixed(1), a.x, y + 21);
    ctx.shadowBlur = 0;
  }
  // It's you about to be claimed — slam a banner up top so there's zero ambiguity.
  const mine = warn.find((w) => w.id === rc.youId);
  if (mine) {
    const cx = ARENA_W / 2;
    const y = 156;
    ctx.fillStyle = `rgba(150,16,34,${0.72 + 0.18 * pulse})`;
    ctx.strokeStyle = "rgba(255,82,82,0.95)";
    ctx.lineWidth = 4;
    roundRect(ctx, cx - 240, y - 42, 480, 78, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "900 40px 'Baloo 2', sans-serif";
    ctx.fillText("⚠️ KEEP MOVING! ⚠️", cx, y);
    ctx.font = "800 18px 'Baloo 2', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(`floor takes you in ${mine.left.toFixed(1)}s`, cx, y + 26);
  }
  ctx.restore();
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
  const phase: string = d.phase || "gift";
  const actors = interpActors(cur, prev, alpha);
  const evs: any[] = d.events || [];
  const receiverSet = new Set(evs.map((e) => e.receiverId));

  // During the gift (blackout) phase the parlor is dim but still VISIBLE — you
  // watch gifts being chosen in the gloom (givers stay secret) instead of staring
  // at a black screen. The guess/reveal phases are fully lit.
  if (phase === "gift") {
    ctx.fillStyle = "rgba(8,5,18,0.62)";
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  }

  if (phase === "reveal") {
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
    const dim = phase === "gift" ? 0.55 : 1;
    ctx.globalAlpha = dim;
    drawBlob(ctx, a.characterId, a.x, a.y, {
      r: PLAYER_RADIUS,
      time: rc.time,
      anim: "idle",
      name: a.name,
      number: rc.numbers?.get(a.id),
      variant: rc.variants?.get(a.id), accessories: rc.accessories?.get(a.id),
      you: a.id === rc.youId,
    });
    ctx.globalAlpha = 1;
    // a settled gift sits above each receiver during the guessing/reveal beats
    if (receiverSet.has(a.id) && phase !== "gift") {
      ctx.font = "30px serif";
      ctx.textAlign = "center";
      ctx.fillText("🎁", a.x, a.y - PLAYER_RADIUS * 1.9 + Math.sin(rc.time * 0.006) * 3);
    }
    // GUESS phase: show who is still deciding (a bobbing 🤔) vs already locked in
    if (phase === "guess") {
      const ev = evs.find((e) => e.receiverId === a.id);
      if (ev && !ev.guessed) {
        const pulse = 0.5 + 0.5 * Math.sin(rc.time * 0.008);
        ctx.save();
        ctx.strokeStyle = `rgba(255,213,79,${0.4 + pulse * 0.5})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(a.x, a.y, PLAYER_RADIUS + 12 + pulse * 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        ctx.font = "24px serif";
        ctx.textAlign = "center";
        ctx.fillText("🤔", a.x + PLAYER_RADIUS * 1.1, a.y - PLAYER_RADIUS * 1.2);
      }
    }
  }

  // GIFT phase: gifts are being CHOSEN in secret, so we can't show who's gifting
  // whom (that's the whole game). A few presents just drift in the gloom for
  // ambiance. If YOU are a giver who has locked a mark, your gift glides toward
  // them as a private confirmation (rides the per-player `secret`, so no one else
  // sees it).
  if (phase === "gift") {
    const prog = Math.max(0, Math.min(1, d.darkProg ?? 0));
    const sx = ARENA_W / 2;
    const sy = ARENA_H / 2;
    const drift = Math.max(1, d.gifts || 1);
    for (let i = 0; i < drift; i++) {
      const t = rc.time * 0.0009 + i * 1.7;
      const gx = sx + Math.cos(t) * (120 + i * 26);
      const gy = sy + Math.sin(t * 1.3) * 70;
      ctx.save();
      ctx.globalAlpha = 0.26 + 0.18 * Math.sin(rc.time * 0.004 + i);
      ctx.font = "26px serif";
      ctx.textAlign = "center";
      ctx.fillText("🎁", gx, gy);
      ctx.restore();
    }
    const sec: any = (cur as any).secret;
    if (sec?.role === "giver" && sec.targetId) {
      const r = actors.find((a) => a.id === sec.targetId);
      if (r) {
        const ease = prog * prog * (3 - 2 * prog);
        const gx = lerp(sx, r.x, ease);
        const gy = lerp(sy, r.y - PLAYER_RADIUS * 1.8, ease) - Math.sin(ease * Math.PI) * 40;
        ctx.save();
        ctx.strokeStyle = "rgba(255,213,79,0.7)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(r.x, r.y, PLAYER_RADIUS + 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.92;
        ctx.font = "30px serif";
        ctx.textAlign = "center";
        ctx.fillText("🎁", gx, gy);
        ctx.restore();
      }
    }
  }

  if (phase === "reveal") {
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

  ctx.textAlign = "center";
  ctx.font = "800 26px 'Baloo 2', sans-serif";
  if (phase === "gift") {
    const sec: any = (cur as any).secret;
    if (sec?.role === "giver") {
      ctx.fillStyle = "#ffd54f";
      ctx.fillText(
        sec.targetId ? "🤫 Gift planted — act natural." : "🎁 Pick your mark — slip them a gift!",
        W / 2,
        56,
      );
    } else {
      ctx.fillStyle = "#cbb6ff";
      ctx.fillText("🌑 Lights out — gifts are being chosen in the dark…", W / 2, 56);
    }
  } else if (phase === "guess") {
    const mine = evs.find((e) => e.receiverId === rc.youId);
    ctx.fillStyle = mine ? "#ffd54f" : "#b9a7d6";
    ctx.fillText(mine ? "🎁 Who gave you this gift? Tap a suspect below!" : "🎁 The gifted are guessing their givers…", W / 2, 56);
  } else if (phase === "reveal") {
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
