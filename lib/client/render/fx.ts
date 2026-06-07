// Client-side particle system + screen shake. Games emit lightweight `Effect`s
// in their snapshots; this turns them into juicy bursts.
import type { Effect, EffectKind } from "../../shared/types";

interface Particle {
  kind: EffectKind | "ghost";
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  spin: number;
  rot: number;
  grav: number;
}

interface FloatText {
  x: number;
  y: number;
  vy: number;
  life: number;
  max: number;
  text: string;
  color: string;
  size?: number; // font px (world units); defaults to 22
}

const CONFETTI = ["#ff2e88", "#ffce3a", "#19d3bd", "#2bb39a", "#4cd9a0", "#ff9800"];

export class FxSystem {
  private parts: Particle[] = [];
  private texts: FloatText[] = [];
  shake = 0;
  private seen = new Set<number>();

  reset() {
    this.parts.length = 0;
    this.texts.length = 0;
    this.shake = 0;
  }

  ingest(effects: Effect[] | undefined) {
    if (!effects) return;
    for (const e of effects) this.spawn(e.kind, e.x, e.y, { color: e.color, scale: e.scale, text: e.text });
  }

  spawn(kind: EffectKind, x: number, y: number, opts: { color?: string; scale?: number; text?: string } = {}) {
    const color = opts.color || "#fff";
    const s = opts.scale || 1;
    switch (kind) {
      case "confetti":
        for (let i = 0; i < 22; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 120 + Math.random() * 260;
          this.parts.push(this.p("confetti", x, y, Math.cos(a) * sp, Math.sin(a) * sp - 180, 0.9 + Math.random() * 0.6, 5 + Math.random() * 5, CONFETTI[i % CONFETTI.length], 700));
        }
        break;
      case "splat":
        for (let i = 0; i < 14; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 80 + Math.random() * 220;
          this.parts.push(this.p("splat", x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.5 + Math.random() * 0.5, 6 + Math.random() * 8 * s, color, 500));
        }
        this.shake = Math.max(this.shake, 6);
        break;
      case "poof":
        for (let i = 0; i < 10; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 40 + Math.random() * 120;
          this.parts.push(this.p("poof", x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.5 + Math.random() * 0.4, 10 + Math.random() * 12, color, 0));
        }
        break;
      case "spark":
        for (let i = 0; i < 8; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 120 + Math.random() * 200;
          this.parts.push(this.p("spark", x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + Math.random() * 0.3, 3 + Math.random() * 3, color, 300));
        }
        break;
      case "shockwave":
      case "ring":
        this.parts.push(this.p(kind, x, y, 0, 0, kind === "ring" ? 0.7 : 0.5, 12 * s, color, 0));
        break;
      case "shatter":
        for (let i = 0; i < 16; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 100 + Math.random() * 240;
          this.parts.push(this.p("shatter", x, y, Math.cos(a) * sp, Math.sin(a) * sp - 60, 0.6 + Math.random() * 0.5, 6 + Math.random() * 8, color || "#b3e5fc", 600));
        }
        break;
      case "pickup":
        // The powerup reveal — bigger, bolder and lingers a beat longer than a
        // plain float so you can read what you just grabbed.
        this.texts.push({ x, y, vy: -46, life: 1.5, max: 1.5, text: opts.text || "+", color, size: 28 * s });
        break;
      case "death":
        for (let i = 0; i < 18; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 100 + Math.random() * 280;
          this.parts.push(this.p("splat", x, y, Math.cos(a) * sp, Math.sin(a) * sp - 60, 0.6 + Math.random() * 0.6, 6 + Math.random() * 9, color || "#ff1744", 480));
        }
        // rising spirit
        this.parts.push(this.p("ghost", x, y, 0, -70, 1.4, 22, "#ffffff", -20));
        this.texts.push({ x, y: y - 20, vy: -42, life: 1.2, max: 1.2, text: "💀", color: "#fff" });
        this.shake = Math.max(this.shake, 10);
        break;
      case "shake":
        this.shake = Math.max(this.shake, 8 * s);
        break;
    }
  }

  private p(kind: any, x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, grav: number): Particle {
    return { kind, x, y, vx, vy, life, max: life, size, color, spin: (Math.random() - 0.5) * 12, rot: Math.random() * 6, grav };
  }

  update(dt: number) {
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 30);
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.parts.splice(i, 1);
        continue;
      }
      p.vy += p.grav * dt;
      p.vx *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const f = this.texts[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.texts.splice(i, 1);
        continue;
      }
      f.y += f.vy * dt;
      f.vy *= 0.96;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.parts) {
      const a = Math.min(1, p.life / p.max);
      ctx.save();
      ctx.globalAlpha = a;
      if (p.kind === "shockwave" || p.kind === "ring") {
        const prog = 1 - p.life / p.max;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 5 * a;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size + prog * (p.kind === "ring" ? 120 : 80), 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === "confetti" || p.kind === "shatter") {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      } else if (p.kind === "poof") {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = a * 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.4 - a * 0.4), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === "ghost") {
        ctx.globalAlpha = a * 0.7;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, Math.PI, 0);
        ctx.lineTo(p.x + p.size, p.y + p.size);
        ctx.lineTo(p.x - p.size, p.y + p.size);
        ctx.fill();
        ctx.fillStyle = "#241a33";
        ctx.beginPath();
        ctx.arc(p.x - p.size * 0.35, p.y, p.size * 0.16, 0, Math.PI * 2);
        ctx.arc(p.x + p.size * 0.35, p.y, p.size * 0.16, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    for (const f of this.texts) {
      const a = Math.min(1, f.life / f.max);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `800 ${f.size ?? 22}px 'Baloo 2', sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.fillStyle = f.color;
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    }
  }
}
