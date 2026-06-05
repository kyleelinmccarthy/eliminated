"use client";
// A tiny, self-contained "live" snippet of a minigame for the How-to-Play page.
// Instead of recorded video, it runs the *real* authoritative minigame sim
// client-side with an all-bot lobby (each game self-drives its own bots in
// tick()) and pipes the resulting snapshots straight into the same renderFrame
// the live game uses. So previews are always accurate, need zero art assets,
// and loop forever. Silent by design — no audio, ever (12 of these at once).
import { useEffect, useRef } from "react";
import { createMinigame } from "@/lib/server/games/registry";
import type { Minigame, GameContext } from "@/lib/server/games/Minigame";
import { renderFrame } from "@/lib/client/render/renderers";
import { FxSystem } from "@/lib/client/render/fx";
import { MAPS } from "@/lib/shared/maps";
import { FREE_CHARACTERS } from "@/lib/shared/characters";
import { makeRng, shuffle } from "@/lib/shared/util";
import { TICK_MS, ARENA_W, ARENA_H } from "@/lib/shared/constants";
import type { GameId, Snapshot } from "@/lib/shared/types";

// Design space the renderers were tuned for (the in-game stage is full-screen
// ~16:9). The discrete games (glass/tug/rps/jump/present) draw with FIXED pixel
// sizes that assume this canvas; we render into it and scale the whole thing
// down to the preview, so their text/blobs shrink proportionally instead of
// dwarfing a tiny canvas. Arena games already self-fit, so this is a no-op for
// them. Matches ARENA_W/ARENA_H so arena fit() lands at scale 1.
const DESIGN_W = ARENA_W;
const DESIGN_H = ARENA_H;

// Games renderFrame() actually knows how to draw (keep in sync with the dispatch
// in lib/client/render/renderers.ts). Anything else (e.g. an in-progress game
// with no client renderer yet) gets a placeholder instead of a blank canvas.
const RENDERABLE = new Set<GameId>([
  "redlight", "tag", "mingle", "boomerang", "dodgeball", "musicalchairs", "prophunt", "koth", // arena
  "glassbridge", "tugofwar", "rpsminusone", "jumprope", "present", // discrete
]);

// Games rendered from a single player's perspective — they need a live "you" or
// they fall back to spectator/empty states (e.g. glass bridge's "Spectating…").
const FIRST_PERSON = new Set<GameId>(["glassbridge", "tugofwar", "rpsminusone", "jumprope", "present"]);

// Stable per-game seed so a preview looks the same on every visit (until it loops).
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Pull the set of currently-alive participant ids out of a snapshot, whatever
// shape the game uses, so the first-person camera can stay on a survivor.
function livingIds(snap: Snapshot): string[] {
  const d: any = snap.data || {};
  if (snap.actors) return snap.actors.filter((a) => a.alive).map((a) => a.id);
  if (d.walkers) return d.walkers.filter((w: any) => w.alive).map((w: any) => w.id);
  if (d.jumpers) return d.jumpers.filter((j: any) => j.alive).map((j: any) => j.id);
  if (d.pullers) return d.pullers.map((p: any) => p.id);
  if (d.duels) {
    const ids: string[] = [];
    for (const x of d.duels) if (x.status !== "done") ids.push(x.a, x.b);
    return ids;
  }
  return [];
}

export function GamePreview({ gameId, bots = 10 }: { gameId: GameId; bots?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return; // non-renderable games render a placeholder instead
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const STEP = TICK_MS / 1000; // seconds per fixed sim tick (mirrors the server)
    const HOLD = 1.4; // pause on the final frame before re-racking the lobby
    const firstPerson = FIRST_PERSON.has(gameId);

    const fx = new FxSystem();
    const deaths = new Map<string, number>(); // actorId -> first-seen-dead time (coffin drop-in)
    let numbers = new Map<string, number>(); // actorId -> Squid Game number badge
    let game: Minigame | null = null;
    let mapId = MAPS[0].id;
    let youId: string | null = null; // a live participant, for first-person renderers
    let prev: Snapshot | null = null;
    let cur: Snapshot | null = null;
    let simMs = 0;
    let acc = 0;
    let endHold = 0;
    let loopN = 0;
    let raf = 0;
    let last = 0;
    let running = false;

    function build() {
      const rng = makeRng(hash(gameId) + loopN * 0x9e3779b1);
      const roster = shuffle(rng, FREE_CHARACTERS);
      const players = Array.from({ length: bots }, (_, i) => ({
        id: `b${i}`,
        name: `Bot ${i + 1}`,
        characterId: roster[i % roster.length],
        isBot: true,
      }));
      const map = MAPS[(hash(gameId) + loopN) % MAPS.length];
      mapId = map.id;
      numbers = new Map(players.map((p, i) => [p.id, 1 + ((i * 53 + loopN * 7) % 456)]));
      const gctx: GameContext = {
        players,
        map,
        rng,
        friendlyFire: true,
        emitFx: () => {}, // server is a no-op too; fx ride along in each snapshot
        toast: () => {}, // no UI toasts in a preview
        roundIndex: 2,
        totalRounds: 6,
        isFinale: gameId === "koth",
        intensity: 0.5, // mid harshness keeps the action lively but not instant
        night: false,
      };
      game = createMinigame(gameId, gctx);
      game.start();
      fx.reset();
      deaths.clear();
      prev = null;
      cur = game.snapshot(0);
      youId = firstPerson ? players[0].id : null;
      simMs = 0;
      acc = 0;
      endHold = 0;
    }

    function step() {
      if (!game) return;
      simMs += TICK_MS;
      game.tick(STEP, simMs);
      prev = cur;
      cur = game.snapshot(simMs);
      if (cur.actors) fx.ingest(cur.fx); // arena games feed the particle system (matches GameStage)
      // keep the first-person camera on someone who's still in it
      if (firstPerson) {
        const living = livingIds(cur);
        if (living.length && (!youId || !living.includes(youId))) youId = living[0];
      }
    }

    function stampDeaths(now: number) {
      if (!cur?.actors) return;
      for (const a of cur.actors) {
        if (!a.alive) {
          if (!deaths.has(a.id)) deaths.set(a.id, now);
        } else if (deaths.has(a.id)) {
          deaths.delete(a.id);
        }
      }
    }

    function draw(now: number, alpha: number) {
      if (!cur) return;
      const cw = canvas!.clientWidth;
      const ch = canvas!.clientHeight;
      if (!cw || !ch) return;
      // render at the design resolution, scaled to fill the preview (no letterbox)
      ctx!.save();
      ctx!.scale(cw / DESIGN_W, ch / DESIGN_H);
      renderFrame(ctx!, DESIGN_W, DESIGN_H, cur, prev, alpha, { youId, time: now, fx, mapId, numbers, deaths });
      ctx!.restore();
    }

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      if (!w || !h) return;
      canvas!.width = Math.floor(w * dpr);
      canvas!.height = Math.floor(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function frame(now: number) {
      if (!game) build();
      if (!last) last = now;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      acc += dt;
      while (acc >= STEP) {
        acc -= STEP;
        if (game!.isDone()) {
          endHold += STEP;
          if (endHold >= HOLD) {
            loopN++;
            build();
          }
        } else {
          step();
        }
      }
      fx.update(dt);
      stampDeaths(now);
      draw(now, game!.isDone() ? 1 : Math.min(1, acc / STEP));
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (running || reduced) return;
      running = true;
      last = 0;
      if (!game) build();
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    // Only animate previews that are actually on-screen — keeps a page of 12 live
    // sims cheap (typically 2-4 run at once; the rest are paused).
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) (e.isIntersecting ? start : stop)();
      },
      { threshold: 0.1, rootMargin: "150px" },
    );
    io.observe(canvas);

    // Reduced motion: fast-forward to a lively mid-action frame and hold it. No loop.
    if (reduced) {
      const once = () => {
        resize();
        if (!canvas!.clientWidth) {
          raf = requestAnimationFrame(once);
          return;
        }
        if (!game) build();
        for (let i = 0; i < 40 && game && !game.isDone(); i++) step();
        fx.update(0.4);
        stampDeaths(900);
        draw(900, 1);
      };
      raf = requestAnimationFrame(once);
    }

    return () => {
      io.disconnect();
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [gameId, bots]);

  // Games without a client renderer yet (e.g. Prop Hunt) get an honest placeholder
  // rather than a blank black box.
  if (!RENDERABLE.has(gameId)) {
    return (
      <div className="htp-preview htp-preview--soon" aria-hidden="true">
        <span>👀 no preview — you’ll have to die in person</span>
      </div>
    );
  }

  return (
    <div className="htp-preview">
      <canvas ref={canvasRef} aria-hidden="true" />
      <span className="htp-preview-badge">▶ LIVE · bots</span>
    </div>
  );
}
