// Procedural drawing of the blob characters and themed arenas. No image
// assets — everything here is canvas paths so the whole game ships as code.
import { getCharacter, type Character, type BodyShape } from "../../shared/characters";
import type { GameMap } from "../../shared/maps";
import { PLAYER_RADIUS } from "../../shared/constants";

export interface BlobOpts {
  r?: number;
  facing?: number; // radians (look direction)
  anim?: string; // idle | run | dead | cheer | fall
  scale?: number;
  it?: boolean;
  shield?: boolean;
  ghost?: boolean;
  flash?: number; // 0..1 hurt flash
  time: number; // ms for animation
  name?: string;
  number?: number; // Squid Game-style player number, drawn as a chest bib
  variant?: number; // >0 = duplicate-icon disambiguation: draw an accent rim in MARKER_COLORS[variant-1]
  you?: boolean;
  alpha?: number;
}

// Accent colors for telling apart players who picked the same blob. Picked to be
// vivid and well-separated, and distinct from the team-ring palette so a colored
// rim never reads as a team marker. Cycled if more than this many share an icon.
const MARKER_COLORS = ["#ffd54f", "#4dd0e1", "#ff7043", "#b388ff", "#69f0ae", "#f06292", "#ffffff", "#8d6e63"];

function shade(hex: string, amt: number): string {
  const c = hex.replace("#", "");
  const n = parseInt(c.length === 3 ? c.split("").map((x) => x + x).join("") : c, 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r + amt)));
  g = Math.max(0, Math.min(255, Math.round(g + amt)));
  b = Math.max(0, Math.min(255, Math.round(b + amt)));
  return `rgb(${r},${g},${b})`;
}

export function drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.86, r * 0.92, r * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Per-shape anchors so feet, arms, toppings and the face land in the right
// spot no matter the silhouette. All values are multiples of the blob radius.
interface ShapeCfg {
  faceX?: number;
  faceY: number;
  faceScale: number;
  feetY: number;
  feetDX: number;
  armY: number;
  armDX: number;
  topY: number; // y of the crown, where toppings/ears sit
}

const SHAPES: Record<BodyShape, ShapeCfg> = {
  round: { faceY: 0, faceScale: 1, feetY: 0.78, feetDX: 0.4, armY: 0.1, armDX: 0.92, topY: -1.0 },
  egg: { faceY: -0.02, faceScale: 0.96, feetY: 0.92, feetDX: 0.34, armY: 0.12, armDX: 0.86, topY: -1.0 },
  pear: { faceY: 0.18, faceScale: 0.82, feetY: 0.96, feetDX: 0.3, armY: 0.24, armDX: 0.82, topY: -0.96 },
  berry: { faceY: -0.12, faceScale: 0.86, feetY: 0.92, feetDX: 0.16, armY: -0.05, armDX: 0.82, topY: -0.82 },
  bulb: { faceY: 0.24, faceScale: 0.82, feetY: 0.98, feetDX: 0.34, armY: 0.32, armDX: 0.78, topY: -1.0 },
  tall: { faceY: -0.2, faceScale: 0.84, feetY: 0.96, feetDX: 0.34, armY: 0.0, armDX: 0.7, topY: -1.05 },
  cone: { faceY: -0.28, faceScale: 0.78, feetY: 0.92, feetDX: 0.14, armY: -0.12, armDX: 0.66, topY: -0.92 },
  banana: { faceX: 0.12, faceY: 0.04, faceScale: 0.64, feetY: 0.95, feetDX: 0.14, armY: 0.22, armDX: 0.52, topY: -1.0 },
  triangle: { faceY: 0.16, faceScale: 0.84, feetY: 0.96, feetDX: 0.32, armY: 0.26, armDX: 0.84, topY: -0.92 },
  mushroom: { faceY: 0.18, faceScale: 0.78, feetY: 0.96, feetDX: 0.24, armY: 0.36, armDX: 0.5, topY: -0.95 },
};

// Traces (only) the body silhouette for a shape, centred on the origin and
// roughly bounded by x∈[-r,r], y∈[-1.1r, 1.1r] so anchors stay consistent.
function bodyPath(ctx: CanvasRenderingContext2D, shape: BodyShape, r: number) {
  switch (shape) {
    case "egg":
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.02);
      ctx.bezierCurveTo(r * 0.66, -r * 1.0, r * 0.9, -r * 0.2, r * 0.9, r * 0.22);
      ctx.bezierCurveTo(r * 0.9, r * 0.84, r * 0.5, r * 1.05, 0, r * 1.05);
      ctx.bezierCurveTo(-r * 0.5, r * 1.05, -r * 0.9, r * 0.84, -r * 0.9, r * 0.22);
      ctx.bezierCurveTo(-r * 0.9, -r * 0.2, -r * 0.66, -r * 1.0, 0, -r * 1.02);
      ctx.closePath();
      break;
    case "pear":
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.02);
      ctx.bezierCurveTo(r * 0.42, -r * 0.98, r * 0.46, -r * 0.45, r * 0.5, -r * 0.12);
      ctx.bezierCurveTo(r * 0.96, r * 0.18, r * 0.86, r * 1.04, 0, r * 1.06);
      ctx.bezierCurveTo(-r * 0.86, r * 1.04, -r * 0.96, r * 0.18, -r * 0.5, -r * 0.12);
      ctx.bezierCurveTo(-r * 0.46, -r * 0.45, -r * 0.42, -r * 0.98, 0, -r * 1.02);
      ctx.closePath();
      break;
    case "berry":
      ctx.beginPath();
      ctx.moveTo(0, r * 1.08);
      ctx.bezierCurveTo(-r * 0.7, r * 0.55, -r * 1.02, -r * 0.1, -r * 0.66, -r * 0.66);
      ctx.bezierCurveTo(-r * 0.42, -r * 1.0, -r * 0.12, -r * 0.94, 0, -r * 0.84);
      ctx.bezierCurveTo(r * 0.12, -r * 0.94, r * 0.42, -r * 1.0, r * 0.66, -r * 0.66);
      ctx.bezierCurveTo(r * 1.02, -r * 0.1, r * 0.7, r * 0.55, 0, r * 1.08);
      ctx.closePath();
      break;
    case "bulb":
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.05);
      ctx.bezierCurveTo(r * 0.3, -r * 1.02, r * 0.32, -r * 0.55, r * 0.4, -r * 0.22);
      ctx.bezierCurveTo(r * 0.95, r * 0.12, r * 0.92, r * 1.06, 0, r * 1.08);
      ctx.bezierCurveTo(-r * 0.92, r * 1.06, -r * 0.95, r * 0.12, -r * 0.4, -r * 0.22);
      ctx.bezierCurveTo(-r * 0.32, -r * 0.55, -r * 0.3, -r * 1.02, 0, -r * 1.05);
      ctx.closePath();
      break;
    case "tall":
      roundRectPath(ctx, -r * 0.66, -r * 1.06, r * 1.32, r * 2.12, r * 0.62);
      break;
    case "cone":
      ctx.beginPath();
      ctx.moveTo(-r * 0.82, -r * 0.7);
      ctx.bezierCurveTo(-r * 0.82, -r * 1.08, r * 0.82, -r * 1.08, r * 0.82, -r * 0.7);
      ctx.bezierCurveTo(r * 0.6, r * 0.0, r * 0.28, r * 0.78, r * 0.06, r * 1.06);
      ctx.bezierCurveTo(r * 0.02, r * 1.12, -r * 0.02, r * 1.12, -r * 0.06, r * 1.06);
      ctx.bezierCurveTo(-r * 0.28, r * 0.78, -r * 0.6, r * 0.0, -r * 0.82, -r * 0.7);
      ctx.closePath();
      break;
    case "banana":
      ctx.beginPath();
      ctx.moveTo(-r * 0.34, -r * 1.0);
      ctx.bezierCurveTo(r * 0.5, -r * 0.94, r * 0.96, -r * 0.16, r * 0.66, r * 0.82);
      ctx.bezierCurveTo(r * 0.5, r * 1.14, r * 0.16, r * 1.12, -r * 0.02, r * 0.92);
      ctx.bezierCurveTo(r * 0.42, r * 0.12, r * 0.12, -r * 0.5, -r * 0.34, -r * 1.0);
      ctx.closePath();
      break;
    case "triangle":
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.0);
      ctx.bezierCurveTo(r * 0.22, -r * 0.96, r * 0.8, r * 0.5, r * 0.98, r * 0.82);
      ctx.bezierCurveTo(r * 1.04, r * 1.0, r * 0.6, r * 1.06, 0, r * 1.06);
      ctx.bezierCurveTo(-r * 0.6, r * 1.06, -r * 1.04, r * 1.0, -r * 0.98, r * 0.82);
      ctx.bezierCurveTo(-r * 0.8, r * 0.5, -r * 0.22, -r * 0.96, 0, -r * 1.0);
      ctx.closePath();
      break;
    case "mushroom":
      ctx.beginPath();
      ctx.moveTo(-r * 1.0, -r * 0.12);
      ctx.bezierCurveTo(-r * 1.02, -r * 1.04, r * 1.02, -r * 1.04, r * 1.0, -r * 0.12);
      ctx.bezierCurveTo(r * 0.72, r * 0.02, r * 0.46, -r * 0.04, r * 0.42, r * 0.16);
      ctx.bezierCurveTo(r * 0.44, r * 0.6, r * 0.42, r * 0.95, r * 0.36, r * 1.02);
      ctx.bezierCurveTo(r * 0.2, r * 1.1, -r * 0.2, r * 1.1, -r * 0.36, r * 1.02);
      ctx.bezierCurveTo(-r * 0.42, r * 0.95, -r * 0.44, r * 0.6, -r * 0.42, r * 0.16);
      ctx.bezierCurveTo(-r * 0.46, -r * 0.04, -r * 0.72, r * 0.02, -r * 1.0, -r * 0.12);
      ctx.closePath();
      break;
    default: // round
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 1.04, 0, 0, Math.PI * 2);
      break;
  }
}

export function drawBlob(
  ctx: CanvasRenderingContext2D,
  characterId: string,
  x: number,
  y: number,
  opts: BlobOpts,
) {
  const ch = getCharacter(characterId);
  const baseR = (opts.r ?? PLAYER_RADIUS) * (opts.scale ?? 1);
  const t = opts.time;
  const anim = opts.anim ?? "idle";
  const dead = anim === "dead";
  const phase = (t * 0.006 + x * 0.05) % (Math.PI * 2);

  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
  if (opts.ghost) ctx.globalAlpha *= 0.55;

  drawShadow(ctx, x, y, baseR);

  // bounce / squash
  let bob = 0;
  let squashX = 1;
  let squashY = 1;
  let rot = 0;
  if (anim === "run") {
    bob = Math.sin(t * 0.018 + x) * baseR * 0.12;
    squashX = 1 + Math.sin(t * 0.018 + x) * 0.06;
    squashY = 1 - Math.sin(t * 0.018 + x) * 0.06;
  } else if (anim === "idle") {
    squashY = 1 + Math.sin(phase) * 0.03;
    squashX = 1 - Math.sin(phase) * 0.03;
  } else if (anim === "cheer") {
    bob = -Math.abs(Math.sin(t * 0.012)) * baseR * 0.35;
  } else if (dead) {
    rot = Math.PI / 2;
  } else if (anim === "fall") {
    rot = t * 0.02;
    squashX = squashY = 1;
  }

  ctx.translate(x, y + bob);
  if (rot) ctx.rotate(rot);

  // "it" fiery aura
  if (opts.it && !dead) {
    ctx.save();
    const aura = baseR * (1.5 + Math.sin(t * 0.02) * 0.12);
    const g = ctx.createRadialGradient(0, 0, baseR * 0.6, 0, 0, aura);
    g.addColorStop(0, "rgba(255,120,40,0.0)");
    g.addColorStop(0.7, "rgba(255,90,30,0.35)");
    g.addColorStop(1, "rgba(255,40,40,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, aura, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const lean = Math.cos(opts.facing ?? -Math.PI / 2) * (anim === "run" ? 0.12 : 0);
  ctx.rotate(lean);

  const cfg = SHAPES[ch.shape ?? "round"];
  const topShift = (cfg.topY + 1) * baseR; // re-seat toppings/ears on this shape's crown

  // feet
  const footSwing = anim === "run" ? Math.sin(t * 0.02 + x) * baseR * 0.3 : 0;
  ctx.fillStyle = shade(ch.body2, -20);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * baseR * cfg.feetDX, baseR * cfg.feetY + (s === 1 ? footSwing : -footSwing) * 0.4, baseR * 0.22, baseR * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ears (behind the body so the base tucks under the head)
  if (ch.ears) {
    ctx.save();
    ctx.translate(0, topShift);
    drawEars(ctx, ch, baseR);
    ctx.restore();
  }

  // body silhouette (squash applied while tracing so the outline stays even)
  const bodyGrad = ctx.createLinearGradient(0, -baseR, 0, baseR);
  bodyGrad.addColorStop(0, shade(ch.body, 22));
  bodyGrad.addColorStop(1, ch.body2);
  ctx.save();
  ctx.scale(squashX, squashY);
  bodyPath(ctx, ch.shape ?? "round", baseR);
  // duplicate-icon accent rim — stroked before the fill so the body covers its
  // inner half, leaving a crisp contour in this player's marker color. Hugs the
  // exact silhouette at any size and never collides with toppings/face/number.
  const mark = opts.variant && opts.variant > 0 ? MARKER_COLORS[(opts.variant - 1) % MARKER_COLORS.length] : null;
  if (mark && !dead) {
    ctx.lineWidth = (baseR * 0.3) / squashY;
    ctx.lineJoin = "round";
    ctx.strokeStyle = mark;
    ctx.stroke();
  }
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.lineWidth = (baseR * 0.12) / squashY;
  ctx.strokeStyle = shade(ch.body2, -34);
  ctx.stroke();
  if (opts.flash && opts.flash > 0) {
    ctx.globalAlpha = opts.flash * 0.7;
    ctx.fillStyle = "#fff";
    ctx.fill();
  }
  ctx.restore();

  // toppings (leaf / stem / crown / hat / hood …) on the crown
  ctx.save();
  ctx.translate(0, topShift);
  drawDeco(ctx, ch, baseR, t);
  ctx.restore();

  // arms (little nubs)
  ctx.fillStyle = ch.body2;
  const armUp = anim === "cheer" ? -baseR * 0.5 : 0;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * baseR * cfg.armDX, baseR * cfg.armY + armUp, baseR * 0.18, baseR * 0.26, s * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // face + cheeks, anchored to this shape's face area
  ctx.save();
  ctx.translate((cfg.faceX ?? 0) * baseR, cfg.faceY * baseR);
  if (cfg.faceScale !== 1) ctx.scale(cfg.faceScale, cfg.faceScale);
  drawFace(ctx, ch, baseR, opts.facing ?? -Math.PI / 2, dead, anim, t);
  if (!dead) {
    ctx.fillStyle = ch.blush;
    ctx.globalAlpha = (ctx.globalAlpha || 1) * 0.7;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * baseR * 0.5, baseR * 0.18, baseR * 0.16, baseR * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // Squid Game player-number bib on the chest
  if (opts.number && opts.number > 0 && !dead) {
    const label = String(opts.number).padStart(3, "0");
    const fontSize = baseR * 0.46;
    const tagY = baseR * 0.62;
    ctx.save();
    ctx.font = `800 ${fontSize}px 'Baloo 2', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const tw = ctx.measureText(label).width;
    const bw = tw + baseR * 0.28;
    const bh = fontSize * 1.2;
    roundRectPath(ctx, -bw / 2, tagY - bh / 2, bw, bh, bh * 0.34);
    ctx.fillStyle = "rgba(245,247,244,0.92)";
    ctx.fill();
    ctx.lineWidth = Math.max(1, baseR * 0.04);
    ctx.strokeStyle = "rgba(20,30,28,0.4)";
    ctx.stroke();
    ctx.fillStyle = "#16201d";
    ctx.fillText(label, 0, tagY + fontSize * 0.05);
    ctx.restore();
  }

  ctx.restore();

  // shield bubble (outside body transform)
  if (opts.shield && !dead) {
    ctx.save();
    ctx.strokeStyle = "rgba(128,216,255,0.85)";
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(x, y + bob, baseR * 1.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(128,216,255,0.12)";
    ctx.fill();
    ctx.restore();
  }

  // you marker
  if (opts.you && !dead) {
    ctx.save();
    ctx.fillStyle = "var(--yellow)";
    ctx.fillStyle = "#ffd54f";
    const ay = y - baseR * 1.7 + Math.sin(t * 0.006) * 3;
    ctx.beginPath();
    ctx.moveTo(x, ay + 10);
    ctx.lineTo(x - 8, ay - 4);
    ctx.lineTo(x + 8, ay - 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // name
  if (opts.name) {
    ctx.save();
    ctx.font = `700 ${Math.max(11, baseR * 0.5)}px 'Baloo 2', sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.fillStyle = opts.you ? "#ffd54f" : "#fff";
    const ny = y - baseR * 1.45;
    ctx.strokeText(opts.name, x, ny);
    ctx.fillText(opts.name, x, ny);
    ctx.restore();
  }
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  ch: Character,
  r: number,
  facing: number,
  dead: boolean,
  anim: string,
  t: number,
) {
  const lookX = Math.cos(facing) * r * 0.12;
  const lookY = Math.sin(facing) * r * 0.08;
  const eyeY = -r * 0.12;
  const eyeDX = r * 0.32;
  const eyeR = ch.eyes === "big" ? r * 0.26 : ch.eyes === "wide" ? r * 0.24 : r * 0.2;

  if (dead) {
    // X eyes + tongue
    ctx.strokeStyle = "#2a2030";
    ctx.lineWidth = r * 0.1;
    for (const s of [-1, 1]) {
      const ex = s * eyeDX;
      ctx.beginPath();
      ctx.moveTo(ex - eyeR * 0.6, eyeY - eyeR * 0.6);
      ctx.lineTo(ex + eyeR * 0.6, eyeY + eyeR * 0.6);
      ctx.moveTo(ex + eyeR * 0.6, eyeY - eyeR * 0.6);
      ctx.lineTo(ex - eyeR * 0.6, eyeY + eyeR * 0.6);
      ctx.stroke();
    }
    ctx.fillStyle = "#ff5a7a";
    ctx.beginPath();
    ctx.ellipse(0, r * 0.42, r * 0.14, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // muzzle / snout sits under the eyes (animals)
  if (ch.snout) drawSnout(ctx, ch, r);

  // frog: bulging eyes on top + a wide grin (used by the frog wizard)
  if (ch.eyes === "frog") {
    const ex = r * 0.42;
    const ey = -r * 0.4;
    const er = r * 0.34;
    ctx.lineWidth = r * 0.06;
    ctx.strokeStyle = shade(ch.body2, -28);
    for (const s of [-1, 1]) {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(s * ex, ey, er, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = "#241a33";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * ex + lookX, ey + lookY + r * 0.04, er * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * ex + lookX - er * 0.18, ey + lookY - er * 0.1, er * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
    // nostrils
    ctx.fillStyle = shade(ch.body2, -16);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * r * 0.12, -r * 0.04, r * 0.04, 0, Math.PI * 2);
      ctx.fill();
    }
    // wide grin
    ctx.strokeStyle = "#27331c";
    ctx.lineWidth = r * 0.1;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, r * 0.12, r * 0.52, 0.08 * Math.PI, 0.92 * Math.PI);
    ctx.stroke();
    return;
  }

  // whites
  ctx.fillStyle = "#fff";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * eyeDX, eyeY, eyeR, eyeR * (ch.eyes === "sleepy" ? 0.7 : 1.05), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // pupils
  ctx.fillStyle = "#241a33";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(s * eyeDX + lookX, eyeY + lookY, eyeR * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // sparkle
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(s * eyeDX + lookX - eyeR * 0.18, eyeY + lookY - eyeR * 0.2, eyeR * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
  if (ch.eyes === "star") {
    ctx.fillStyle = "#ffd54f";
    for (const s of [-1, 1]) drawStar(ctx, s * eyeDX, eyeY, eyeR * 0.5, 5);
  }

  // mouth — placement follows the muzzle when there is one
  ctx.strokeStyle = "#3a2a40";
  ctx.lineWidth = r * 0.09;
  ctx.lineCap = "round";
  if (ch.snout === "round") {
    ctx.beginPath();
    ctx.arc(0, r * 0.52, r * 0.16, 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.stroke();
  } else if (ch.snout === "long") {
    ctx.beginPath();
    ctx.arc(0, r * 0.88, r * 0.13, 0.05 * Math.PI, 0.95 * Math.PI);
    ctx.stroke();
  } else if (ch.snout === "cat") {
    ctx.beginPath();
    ctx.moveTo(0, r * 0.46);
    ctx.quadraticCurveTo(-r * 0.13, r * 0.58, -r * 0.22, r * 0.49);
    ctx.moveTo(0, r * 0.46);
    ctx.quadraticCurveTo(r * 0.13, r * 0.58, r * 0.22, r * 0.49);
    ctx.stroke();
  } else if (anim === "cheer" || anim === "run") {
    // open happy
    ctx.fillStyle = "#7a2540";
    ctx.beginPath();
    ctx.ellipse(0, r * 0.42, r * 0.22, r * 0.16, 0, 0, Math.PI);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(0, r * 0.34, r * 0.2, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }

  // wizard's bushy beard hides the lower face
  if (ch.deco === "wizard") {
    ctx.fillStyle = "#eef0f2";
    ctx.beginPath();
    ctx.moveTo(-r * 0.4, r * 0.2);
    ctx.quadraticCurveTo(-r * 0.46, r * 0.96, 0, r * 1.0);
    ctx.quadraticCurveTo(r * 0.46, r * 0.96, r * 0.4, r * 0.2);
    ctx.quadraticCurveTo(r * 0.2, r * 0.44, 0, r * 0.4);
    ctx.quadraticCurveTo(-r * 0.2, r * 0.44, -r * 0.4, r * 0.2);
    ctx.closePath();
    ctx.fill();
  }
}

function drawDeco(ctx: CanvasRenderingContext2D, ch: Character, r: number, t: number) {
  const deco = ch.deco;
  const accent = ch.accent;
  ctx.save();
  ctx.fillStyle = accent;
  switch (deco) {
    case "leaf":
      ctx.strokeStyle = "#3a6b1e";
      ctx.lineWidth = r * 0.08;
      ctx.fillStyle = "#5fae34";
      ctx.beginPath();
      ctx.ellipse(r * 0.18, -r * 1.02, r * 0.3, r * 0.16, -0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.95);
      ctx.lineTo(-r * 0.05, -r * 1.25);
      ctx.stroke();
      break;
    case "stem":
      ctx.fillStyle = "#4f9b3a";
      ctx.beginPath();
      ctx.moveTo(-r * 0.18, -r * 0.95);
      ctx.quadraticCurveTo(0, -r * 1.4, r * 0.2, -r * 1.0);
      ctx.quadraticCurveTo(0, -r * 1.1, -r * 0.18, -r * 0.95);
      ctx.fill();
      break;
    case "seeds":
      ctx.fillStyle = accent;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        ctx.save();
        ctx.translate(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.45 - r * 0.05);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.05, r * 0.09, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      break;
    case "crown":
      ctx.fillStyle = "#4caf50";
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * r * 0.22, -r * 0.95);
        ctx.lineTo(i * r * 0.22 - r * 0.1, -r * 1.5);
        ctx.lineTo(i * r * 0.22 + r * 0.1, -r * 1.5);
        ctx.closePath();
        ctx.fill();
      }
      break;
    case "bush":
      ctx.fillStyle = accent;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.5, -r * 0.9 + Math.sin(a) * r * 0.3, r * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "yolk":
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(0, -r * 0.2, r * 0.0, 0, Math.PI * 2); // no-op anchor
      break;
    case "sprinkles":
      ctx.fillStyle = "#f48fb1";
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.55, r * 0.95, r * 0.5, 0, Math.PI, 0);
      ctx.fill();
      const cols = ["#fff", "#ffd54f", "#4dd0e1", "#7e57c2"];
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = cols[i % cols.length];
        ctx.save();
        ctx.translate(-r * 0.7 + (i / 7) * r * 1.4, -r * 0.6 - Math.sin(i) * r * 0.1);
        ctx.rotate(i);
        ctx.fillRect(-r * 0.04, -r * 0.1, r * 0.08, r * 0.2);
        ctx.restore();
      }
      break;
    case "bumps":
      ctx.fillStyle = accent;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(-r * 0.5 + i * r * 0.25, -r * 0.6 + (i % 2) * r * 0.2, r * 0.08, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "spots":
      ctx.fillStyle = accent;
      for (const [dx, dy] of [[-0.4, -0.5], [0.35, -0.55], [0.0, -0.3], [0.5, -0.1]]) {
        ctx.beginPath();
        ctx.arc(dx * r, dy * r, r * 0.13, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "nori":
      ctx.fillStyle = accent;
      ctx.fillRect(-r * 0.95, r * 0.2, r * 1.9, r * 0.5);
      break;
    case "peel":
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r * 0.1, -r * 1.35, -r * 0.1, -r * 1.4);
      ctx.lineWidth = r * 0.14;
      ctx.strokeStyle = "#8d6e63";
      ctx.stroke();
      break;
    case "rind":
      ctx.fillStyle = accent;
      break;
    case "wizard": {
      const hat = ch.body2;
      // brim
      ctx.fillStyle = shade(hat, -12);
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.9, r * 0.8, r * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      // bent cone
      ctx.fillStyle = hat;
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, -r * 0.9);
      ctx.quadraticCurveTo(r * 0.08, -r * 1.25, r * 0.2, -r * 1.98);
      ctx.quadraticCurveTo(r * 0.04, -r * 1.2, r * 0.6, -r * 0.9);
      ctx.closePath();
      ctx.fill();
      // band + stars in the accent color
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.96, r * 0.52, r * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
      drawStar(ctx, -r * 0.04, -r * 1.36, r * 0.11, 5);
      drawStar(ctx, r * 0.14, -r * 1.68, r * 0.07, 5);
      break;
    }
    case "hood": {
      // A cloaked figure with the face peeking out of a recessed opening.
      // Covering the WHOLE blob is what reads as a hood: an earlier version that
      // cloaked only the crown turned into a haircut, and a fully-lit ringed
      // opening read as an ape muzzle. The fix is to cloak the entire body and
      // sink the face into a teardrop opening that's shadowed at the brow. Both
      // hooded blobs use the round body. `accent` is the cloak colour.
      const cloak = ch.accent;
      const rim = shade(cloak, 30);
      // Face opening: a vertical teardrop — wide at the brow, tapered to the chin.
      const opening = (c: CanvasRenderingContext2D) => {
        c.beginPath();
        c.moveTo(0, -r * 0.6);
        c.quadraticCurveTo(r * 0.62, -r * 0.58, r * 0.66, -r * 0.05);
        c.quadraticCurveTo(r * 0.5, r * 0.5, 0, r * 0.62);
        c.quadraticCurveTo(-r * 0.5, r * 0.5, -r * 0.66, -r * 0.05);
        c.quadraticCurveTo(-r * 0.62, -r * 0.58, 0, -r * 0.6);
        c.closePath();
      };
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 1.04, 0, 0, Math.PI * 2); // round body silhouette
      ctx.clip();
      // cloak the whole body except the opening (even-odd leaves the face showing)
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 1.04, 0, 0, Math.PI * 2);
      opening(ctx);
      ctx.fillStyle = cloak;
      ctx.fill("evenodd");
      // shadow falling from the hood lip so the face sits recessed inside
      const shadow = ctx.createLinearGradient(0, -r * 0.6, 0, r * 0.2);
      shadow.addColorStop(0, "rgba(0,0,0,0.55)");
      shadow.addColorStop(0.6, "rgba(0,0,0,0.13)");
      shadow.addColorStop(1, "rgba(0,0,0,0)");
      opening(ctx);
      ctx.fillStyle = shadow;
      ctx.fill();
      ctx.restore();
      // lighter fold of fabric at the rim of the opening
      ctx.lineWidth = r * 0.05;
      ctx.strokeStyle = rim;
      opening(ctx);
      ctx.stroke();
      // forward-drooping hood point rising above the crown
      ctx.beginPath();
      ctx.moveTo(-r * 0.3, -r * 1.0);
      ctx.quadraticCurveTo(r * 0.28, -r * 1.5, r * 0.54, -r * 0.98);
      ctx.quadraticCurveTo(r * 0.16, -r * 1.12, -r * 0.3, -r * 1.0);
      ctx.closePath();
      ctx.fillStyle = cloak;
      ctx.fill();
      ctx.lineWidth = r * 0.04;
      ctx.strokeStyle = rim;
      ctx.stroke();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

// Layered critter features — ears go behind the body, the snout on the face.
function drawEars(ctx: CanvasRenderingContext2D, ch: Character, r: number) {
  const fill = shade(ch.body, 6);
  const inner = ch.earInner ?? ch.blush;
  ctx.save();
  ctx.strokeStyle = shade(ch.body2, -34);
  ctx.lineWidth = r * 0.1;
  for (const s of [-1, 1]) {
    if (ch.ears === "round") {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(s * r * 0.66, -r * 0.66, r * 0.44, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = inner;
      ctx.beginPath();
      ctx.arc(s * r * 0.66, -r * 0.66, r * 0.24, 0, Math.PI * 2);
      ctx.fill();
    } else if (ch.ears === "pointy") {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(s * r * 0.26, -r * 0.7);
      ctx.lineTo(s * r * 0.66, -r * 1.6);
      ctx.lineTo(s * r * 0.86, -r * 0.62);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = inner;
      ctx.beginPath();
      ctx.moveTo(s * r * 0.42, -r * 0.74);
      ctx.lineTo(s * r * 0.63, -r * 1.3);
      ctx.lineTo(s * r * 0.74, -r * 0.7);
      ctx.closePath();
      ctx.fill();
    } else if (ch.ears === "long") {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(s * r * 0.5, -r * 1.12, r * 0.17, r * 0.62, s * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = inner;
      ctx.beginPath();
      ctx.ellipse(s * r * 0.5, -r * 1.12, r * 0.08, r * 0.42, s * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawSnout(ctx: CanvasRenderingContext2D, ch: Character, r: number) {
  const nose = "#241a26";
  const muzzle = ch.snoutColor ?? shade(ch.body, 16);
  if (ch.snout === "round") {
    ctx.fillStyle = muzzle;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.34, r * 0.42, r * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = nose;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.24, r * 0.2, r * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (ch.snout === "long") {
    ctx.fillStyle = muzzle;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.5, r * 0.3, r * 0.46, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = nose;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.72, r * 0.12, r * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (ch.snout === "cat") {
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = r * 0.025;
    for (const s of [-1, 1]) {
      for (const wy of [0.32, 0.44]) {
        ctx.beginPath();
        ctx.moveTo(s * r * 0.16, r * 0.36);
        ctx.lineTo(s * r * 0.9, r * wy);
        ctx.stroke();
      }
    }
    ctx.fillStyle = nose;
    ctx.beginPath();
    ctx.moveTo(-r * 0.1, r * 0.3);
    ctx.lineTo(r * 0.1, r * 0.3);
    ctx.lineTo(0, r * 0.42);
    ctx.closePath();
    ctx.fill();
  }
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, points: number) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

// ---------------- prop hunt objects ----------------
// A disguisable room object. Decoys and disguised hiders are drawn by the EXACT
// same routine so a still hider is indistinguishable from the furniture — the
// only tell is `wobble` (0..1), the nervous twitch of a prop that's creeping.
export interface PropOpts {
  scale?: number;
  wobble?: number; // 0 = perfectly still (looks like a decoy), 1 = fidgeting
  you?: boolean; // your own disguise — gets a discreet marker
  time: number;
}

export function drawProp(
  ctx: CanvasRenderingContext2D,
  kind: string,
  x: number,
  y: number,
  opts: PropOpts,
) {
  const r = PLAYER_RADIUS * (opts.scale ?? 1);
  const wob = opts.wobble ?? 0;
  drawShadow(ctx, x, y, r);
  ctx.save();
  ctx.translate(x, y + r * 0.92);
  if (wob > 0) {
    const sway = Math.sin(opts.time * 0.02 + x * 0.05) * 0.1 * wob;
    ctx.rotate(sway);
    ctx.translate(0, -Math.abs(Math.sin(opts.time * 0.03 + x)) * r * 0.06 * wob);
  }
  ctx.lineJoin = "round";
  const stroke = "rgba(0,0,0,0.32)";
  ctx.lineWidth = Math.max(1.5, r * 0.08);
  ctx.strokeStyle = stroke;

  switch (kind) {
    case "crate": {
      const w = r * 1.5;
      const h = r * 1.5;
      ctx.fillStyle = "#c08a4e";
      roundRectPath(ctx, -w / 2, -h, w, h, r * 0.16);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#8a5a2b";
      ctx.lineWidth = Math.max(1.5, r * 0.09);
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h);
      ctx.lineTo(w / 2, 0);
      ctx.moveTo(w / 2, -h);
      ctx.lineTo(-w / 2, 0);
      ctx.moveTo(-w / 2, -h * 0.66);
      ctx.lineTo(w / 2, -h * 0.66);
      ctx.moveTo(-w / 2, -h * 0.33);
      ctx.lineTo(w / 2, -h * 0.33);
      ctx.stroke();
      break;
    }
    case "barrel": {
      const w = r * 1.3;
      const h = r * 1.7;
      ctx.fillStyle = "#a9762f";
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h);
      ctx.quadraticCurveTo(-w * 0.66, -h / 2, -w / 2, 0);
      ctx.lineTo(w / 2, 0);
      ctx.quadraticCurveTo(w * 0.66, -h / 2, w / 2, -h);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#5e3d15";
      ctx.lineWidth = Math.max(1.5, r * 0.12);
      for (const yy of [-h * 0.82, -h * 0.5, -h * 0.16]) {
        ctx.beginPath();
        ctx.moveTo(-w * 0.56, yy);
        ctx.lineTo(w * 0.56, yy);
        ctx.stroke();
      }
      break;
    }
    case "jar": {
      const w = r * 1.2;
      const h = r * 1.5;
      ctx.fillStyle = "#3aa6b0";
      ctx.beginPath();
      ctx.moveTo(-w * 0.3, -h);
      ctx.lineTo(w * 0.3, -h);
      ctx.quadraticCurveTo(w * 0.66, -h * 0.86, w * 0.5, -h * 0.6);
      ctx.quadraticCurveTo(w * 0.66, -h * 0.22, 0, 0);
      ctx.quadraticCurveTo(-w * 0.66, -h * 0.22, -w * 0.5, -h * 0.6);
      ctx.quadraticCurveTo(-w * 0.66, -h * 0.86, -w * 0.3, -h);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.beginPath();
      ctx.ellipse(-w * 0.16, -h * 0.6, w * 0.12, h * 0.3, 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "bush": {
      ctx.fillStyle = "#5b9b3a";
      const lobes: [number, number, number][] = [
        [-r * 0.5, -r * 0.5, r * 0.55],
        [r * 0.5, -r * 0.5, r * 0.55],
        [0, -r * 0.95, r * 0.6],
        [0, -r * 0.4, r * 0.62],
      ];
      for (const [lx, ly, lr] of lobes) {
        ctx.beginPath();
        ctx.arc(lx, ly, lr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      for (const [lx, ly, lr] of lobes) {
        ctx.beginPath();
        ctx.arc(lx - lr * 0.3, ly - lr * 0.3, lr * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "stool": {
      ctx.fillStyle = "#d9a05b";
      ctx.strokeStyle = "#7a4a1d";
      ctx.lineWidth = Math.max(1.5, r * 0.07);
      // legs
      ctx.fillRect(-r * 0.7, -r * 0.7, r * 0.22, r * 0.7);
      ctx.fillRect(r * 0.48, -r * 0.7, r * 0.22, r * 0.7);
      ctx.strokeRect(-r * 0.7, -r * 0.7, r * 0.22, r * 0.7);
      ctx.strokeRect(r * 0.48, -r * 0.7, r * 0.22, r * 0.7);
      // seat
      roundRectPath(ctx, -r * 0.85, -r * 0.95, r * 1.7, r * 0.42, r * 0.14);
      ctx.fillStyle = "#e8b873";
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "rock":
    default: {
      ctx.fillStyle = "#9aa3ab";
      ctx.beginPath();
      ctx.moveTo(-r * 0.95, 0);
      ctx.lineTo(-r * 0.7, -r * 0.7);
      ctx.lineTo(-r * 0.1, -r * 0.98);
      ctx.lineTo(r * 0.6, -r * 0.78);
      ctx.lineTo(r * 0.95, -r * 0.12);
      ctx.lineTo(r * 0.5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = Math.max(1, r * 0.05);
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, -r * 0.9);
      ctx.lineTo(r * 0.1, -r * 0.4);
      ctx.lineTo(-r * 0.1, -r * 0.05);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();

  // your-own-disguise marker: a discreet bobbing chevron so you can find yourself
  if (opts.you) {
    ctx.save();
    ctx.fillStyle = "#ffd54f";
    const ay = y - r * 1.6 + Math.sin(opts.time * 0.006) * 3;
    ctx.beginPath();
    ctx.moveTo(x, ay + 10);
    ctx.lineTo(x - 8, ay - 4);
    ctx.lineTo(x + 8, ay - 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// A small drawn sword, gripped by the Seeker, pointing along `facing`. `swing`
// (0..1) snaps it through a slash arc.
export function drawSword(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  facing: number,
  scale: number,
  swing: number,
) {
  const r = PLAYER_RADIUS * scale;
  ctx.save();
  ctx.translate(x, y);
  // swing snaps the blade forward through an arc
  const arc = swing > 0 ? (1 - swing) * 1.4 - 0.7 : -0.35;
  ctx.rotate(facing + arc);
  ctx.translate(r * 0.7, 0);
  // motion swoosh
  if (swing > 0.05) {
    ctx.strokeStyle = `rgba(255,255,255,${swing * 0.6})`;
    ctx.lineWidth = r * 0.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(-r * 0.7, 0, r * 1.5, -0.8, 0.8);
    ctx.stroke();
  }
  // blade
  ctx.fillStyle = "#e8eef2";
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.12);
  ctx.lineTo(r * 1.5, -r * 0.07);
  ctx.lineTo(r * 1.7, 0);
  ctx.lineTo(r * 1.5, r * 0.07);
  ctx.lineTo(0, r * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // guard + hilt
  ctx.fillStyle = "#c9a24a";
  ctx.fillRect(-r * 0.06, -r * 0.34, r * 0.14, r * 0.68);
  ctx.fillStyle = "#6b4a1e";
  ctx.fillRect(-r * 0.42, -r * 0.1, r * 0.4, r * 0.2);
  ctx.restore();
}

// ---------------- arena background ----------------
export function drawArena(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  w: number,
  h: number,
  t: number,
  opts: { checker?: boolean; pad?: number } = {},
) {
  const pad = opts.pad ?? 0;
  // floor
  ctx.fillStyle = map.ground;
  ctx.fillRect(0, 0, w, h);
  if (opts.checker !== false) {
    ctx.fillStyle = map.ground2;
    const cs = 64;
    for (let yy = 0; yy < h; yy += cs) {
      for (let xx = 0; xx < w; xx += cs) {
        if (((xx / cs) + (yy / cs)) % 2 === 0) ctx.fillRect(xx, yy, cs, cs);
      }
    }
  }
  // vignette
  const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.85);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.32)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);

  // border wall
  ctx.strokeStyle = map.wall;
  ctx.lineWidth = 10;
  ctx.strokeRect(pad + 5, pad + 5, w - 2 * pad - 10, h - 2 * pad - 10);

  drawProps(ctx, map, w, h, t);
}

function drawProps(ctx: CanvasRenderingContext2D, map: GameMap, w: number, h: number, t: number) {
  for (const prop of map.props) {
    if (prop === "sakura") {
      ctx.fillStyle = "rgba(255,143,179,0.8)";
      for (let i = 0; i < 26; i++) {
        const x = (i * 137 + t * 0.03) % w;
        const y = (i * 211 + t * 0.05 * (1 + (i % 3))) % h;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * 0.001 + i);
        ctx.beginPath();
        ctx.ellipse(0, 0, 7, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else if (prop === "stars") {
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      for (let i = 0; i < 40; i++) {
        const x = (i * 97.3) % w;
        const y = (i * 53.7) % h;
        const tw = 0.5 + 0.5 * Math.sin(t * 0.004 + i);
        ctx.globalAlpha = tw * 0.6;
        ctx.fillRect(x, y, 2.5, 2.5);
      }
      ctx.globalAlpha = 1;
    } else if (prop === "bubbles") {
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      for (let i = 0; i < 16; i++) {
        const x = (i * 173) % w;
        const y = (h - ((i * 91 + t * 0.06) % h));
        ctx.beginPath();
        ctx.arc(x, y, 8 + (i % 4) * 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (prop === "ghosts") {
      ctx.fillStyle = "rgba(179,136,255,0.18)";
      for (let i = 0; i < 8; i++) {
        const x = (i * 233 + Math.sin(t * 0.001 + i) * 40) % w;
        const y = (i * 151 + Math.cos(t * 0.0012 + i) * 30) % h;
        ctx.beginPath();
        ctx.arc(x, y, 22, Math.PI, 0);
        ctx.lineTo(x + 22, y + 20);
        ctx.lineTo(x - 22, y + 20);
        ctx.fill();
      }
    } else if (prop === "candy") {
      const cols = ["#ff8fb3", "#7e57c2", "#4dd0e1", "#ffd54f"];
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = cols[i % cols.length];
        ctx.globalAlpha = 0.25;
        const x = (i * 211) % w;
        const y = (i * 167) % h;
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (prop === "goo") {
      ctx.fillStyle = "rgba(174,234,0,0.12)";
      for (let i = 0; i < 8; i++) {
        const x = (i * 263) % w;
        const y = (i * 197) % h;
        ctx.beginPath();
        ctx.ellipse(x, y, 40, 22, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (prop === "palms") {
      ctx.fillStyle = "rgba(38,166,154,0.2)";
      for (let i = 0; i < 6; i++) {
        const x = (i * 251) % w;
        const y = (i * 173) % h;
        ctx.beginPath();
        ctx.arc(x, y, 26, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
