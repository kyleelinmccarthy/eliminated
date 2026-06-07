"use client";
import { useEffect, useRef, useState } from "react";
import { net, snapBuffer, useGame } from "@/lib/client/net";
import { audio } from "@/lib/client/audio";
import { recordGlassChoice } from "@/lib/client/glass";
import type { GameId } from "@/lib/shared/types";
import { ARENA_W, ARENA_H } from "@/lib/shared/constants";
import { SIMON_COMMANDS, SIMON_FREEZE, simonByHotkey } from "@/lib/shared/simon";
import { characterVariants } from "@/lib/shared/characters";
import { BlobAvatar } from "./BlobAvatar";

const MOVEMENT = new Set<GameId>(["redlight", "tag", "mingle", "boomerang", "dodgeball", "musicalchairs", "keepyuppy", "koth"]);

export function GameControls({ game }: { game: GameId }) {
  if (game === "prophunt") return <ProphuntControls />;
  if (MOVEMENT.has(game)) return <MovementControls game={game} />;
  if (game === "glassbridge") return <GlassControls />;
  if (game === "tugofwar") return <MashControls label="PULL!" action="pull" color="pink" />;
  if (game === "jumprope") return <MashControls label="JUMP!" action="jump" color="teal" />;
  if (game === "chutesladders") return <RollControls />;
  if (game === "rpsminusone") return <RpsControls />;
  if (game === "present") return <PresentControls />;
  if (game === "simonsays") return <SimonControls />;
  return null;
}

// ---------------- movement (+ boomerang / dodgeball aim/throw/dash) ----------------
function MovementControls({ game }: { game: GameId }) {
  const isThrow = game === "boomerang" || game === "dodgeball";
  const isSpike = game === "keepyuppy";

  useEffect(() => {
    const keys = new Set<string>();
    const sendMove = () => {
      let dx = 0;
      let dy = 0;
      const up = keys.has("w") || keys.has("arrowup");
      const down = keys.has("s") || keys.has("arrowdown");
      const left = keys.has("a") || keys.has("arrowleft");
      const right = keys.has("d") || keys.has("arrowright");
      if (game === "redlight") {
        // Red Light is a horizontal sprint toward the Doll on the RIGHT. Players
        // intuitively press W to "go forward", so rotate the d-pad 90°: W/↑ runs
        // toward the finish, S/↓ backs off, A/D nudge between lanes. (The joystick
        // stays screen-aligned — dragging right already heads for the finish.)
        if (up) dx += 1;
        if (down) dx -= 1;
        if (left) dy -= 1;
        if (right) dy += 1;
      } else {
        if (up) dy -= 1;
        if (down) dy += 1;
        if (left) dx -= 1;
        if (right) dx += 1;
      }
      net.move(dx, dy);
    };
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
      if (k === " " && isThrow) {
        net.input({ kind: "action", name: "throw" });
        audio.sfx("throw");
        return;
      }
      if ((k === " " || k === "shift") && isSpike) {
        net.input({ kind: "action", name: "spike" });
        audio.sfx("whoosh");
        return;
      }
      if (k === "shift" && isThrow) {
        net.input({ kind: "action", name: "dash" });
        audio.sfx("whoosh");
        return;
      }
      if (!keys.has(k)) {
        keys.add(k);
        sendMove();
      }
    };
    const up = (e: KeyboardEvent) => {
      keys.delete(e.key.toLowerCase());
      sendMove();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      net.move(0, 0);
    };
  }, [isThrow]);

  // boomerang mouse aim + click throw
  useEffect(() => {
    if (!isThrow) return;
    const youId = useGame.getState().youId;
    let lastAim = 0;
    const canvas = document.querySelector(".gamecanvas") as HTMLCanvasElement | null;
    const aim = (clientX: number, clientY: number) => {
      const cur = snapBuffer.cur;
      if (!cur?.actors || !canvas) return;
      const me = cur.actors.find((a) => a.id === youId);
      if (!me) return;
      const rect = canvas.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;
      const s = Math.min(W / ARENA_W, H / ARENA_H);
      const ox = (W - ARENA_W * s) / 2;
      const oy = (H - ARENA_H * s) / 2;
      const sx = ox + me.x * s;
      const sy = oy + me.y * s;
      const ang = Math.atan2(clientY - rect.top - sy, clientX - rect.left - sx);
      const now = performance.now();
      if (now - lastAim > 50) {
        net.input({ kind: "aim", angle: ang });
        lastAim = now;
      }
    };
    const move = (e: MouseEvent) => aim(e.clientX, e.clientY);
    const click = (e: MouseEvent) => {
      aim(e.clientX, e.clientY);
      net.input({ kind: "action", name: "throw" });
      audio.sfx("throw");
    };
    window.addEventListener("mousemove", move);
    canvas?.addEventListener("mousedown", click);
    return () => {
      window.removeEventListener("mousemove", move);
      canvas?.removeEventListener("mousedown", click);
    };
  }, [isThrow]);

  return (
    <>
      <Joystick onVec={(dx, dy) => net.move(dx, dy)} />
      {isThrow && (
        <div className="brawl-btns">
          <button
            className="rbtn dash"
            onPointerDown={() => {
              net.input({ kind: "action", name: "dash" });
              audio.sfx("whoosh");
            }}
          >
            💨<span>DASH</span>
          </button>
          <button
            className="rbtn throw"
            onPointerDown={() => {
              net.input({ kind: "action", name: "throw" });
              audio.sfx("throw");
            }}
          >
            🪃<span>THROW</span>
          </button>
        </div>
      )}
      {isSpike && (
        <div className="brawl-btns">
          <button
            className="rbtn spike"
            onPointerDown={() => {
              net.input({ kind: "action", name: "spike" });
              audio.sfx("whoosh");
            }}
          >
            📌<span>SPIKE</span>
          </button>
        </div>
      )}
      <div className="hint">
        {isThrow
          ? "WASD move · mouse aim · click/SPACE throw · SHIFT dash"
          : isSpike
            ? "WASD move under your balloon to bat it · SPACE / SPIKE to pop theirs"
            : game === "redlight"
              ? "W / ↑ runs forward · A·D to dodge · FREEZE the instant it's RED"
              : game === "koth"
                ? "WASD / Arrows to move · bump rivals into the lava!"
                : "WASD / Arrows to move"}
      </div>
      <style jsx>{`
        .brawl-btns {
          position: absolute;
          right: 22px;
          bottom: 34px;
          display: flex;
          gap: 14px;
          align-items: flex-end;
        }
        .rbtn {
          width: 88px;
          height: 88px;
          border-radius: 50%;
          border: 3px solid #fff3;
          font-size: 1.8rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: #fff;
          background: radial-gradient(circle at 30% 30%, #ff7ab0, #d81b73);
          box-shadow: 0 6px 0 #9c1250;
          user-select: none;
          touch-action: none;
        }
        .rbtn span {
          font-size: 0.7rem;
          font-weight: 800;
        }
        .rbtn.dash {
          background: radial-gradient(circle at 30% 30%, #7defff, #00bcd4);
          box-shadow: 0 6px 0 #00838f;
          width: 74px;
          height: 74px;
        }
        .rbtn.spike {
          background: radial-gradient(circle at 30% 30%, #ffe082, #ffb300);
          box-shadow: 0 6px 0 #c87b00;
        }
        .rbtn:active {
          transform: translateY(4px);
        }
        .hint {
          position: absolute;
          bottom: 8px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 0.78rem;
          color: var(--ink-dim);
          background: rgba(0, 0, 0, 0.35);
          padding: 4px 12px;
          border-radius: 10px;
          pointer-events: none;
        }
      `}</style>
    </>
  );
}

// ---------------- prop hunt (hide & seek) ----------------
function ProphuntControls() {
  const youId = useGame((s) => s.youId);
  const [st, setSt] = useState({ role: "hider" as "seeker" | "hider", phase: "hide", swings: 0, quota: 0, found: 0 });
  const isSeekerRef = useRef(false);

  // poll the snapshot for our role + the seeker's blade status
  useEffect(() => {
    const iv = setInterval(() => {
      const cur = snapBuffer.cur;
      if (!cur || cur.game !== "prophunt") return;
      const d: any = cur.data || {};
      const me = cur.actors?.find((a) => a.id === youId);
      const role = me && d.seekerId === me.id ? "seeker" : "hider";
      isSeekerRef.current = role === "seeker";
      setSt({ role, phase: d.phase || "hide", swings: d.swings ?? 0, quota: d.quota ?? 0, found: d.found ?? 0 });
    }, 120);
    return () => clearInterval(iv);
  }, [youId]);

  const swing = () => {
    if (!isSeekerRef.current) return;
    net.input({ kind: "action", name: "swing" });
    audio.sfx("whoosh");
  };

  // keyboard: WASD/arrows move for everyone; SPACE swings for the seeker
  useEffect(() => {
    const keys = new Set<string>();
    const sendMove = () => {
      let dx = 0;
      let dy = 0;
      if (keys.has("w") || keys.has("arrowup")) dy -= 1;
      if (keys.has("s") || keys.has("arrowdown")) dy += 1;
      if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
      if (keys.has("d") || keys.has("arrowright")) dx += 1;
      net.move(dx, dy);
    };
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
      if (k === " ") {
        swing();
        return;
      }
      if (!keys.has(k)) {
        keys.add(k);
        sendMove();
      }
    };
    const up = (e: KeyboardEvent) => {
      keys.delete(e.key.toLowerCase());
      sendMove();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      net.move(0, 0);
    };
  }, []);

  // seeker: click anywhere on the arena to swing at the nearest object
  useEffect(() => {
    const canvas = document.querySelector(".gamecanvas") as HTMLCanvasElement | null;
    const click = () => swing();
    canvas?.addEventListener("mousedown", click);
    return () => canvas?.removeEventListener("mousedown", click);
  }, []);

  const seeker = st.role === "seeker";
  const hunting = st.phase === "hunt";
  const hint = seeker
    ? hunting
      ? `🗡️ ${st.swings} swing${st.swings === 1 ? "" : "s"} left · found ${st.found}/${st.quota} — skewer ${st.quota} or YOU'RE boxed!`
      : "🙈 Counting… the blade comes out soon. (Find at least 1 or you're out too.)"
    : hunting
      ? "🫥 HOLD STILL — moving makes you twitch (and twitching gets you found)"
      : "🏃 Find a lookalike prop and freeze next to it!";

  return (
    <>
      <Joystick onVec={(dx, dy) => net.move(dx, dy)} />
      {seeker && hunting && (
        <div className="brawl-btns">
          <button
            className="rbtn swing"
            onPointerDown={(e) => {
              e.preventDefault();
              swing();
            }}
          >
            🗡️<span>SWING</span>
          </button>
        </div>
      )}
      <div className={`hint ${seeker ? "seek" : ""}`}>{hint}</div>
      <style jsx>{`
        .brawl-btns {
          position: absolute;
          right: 22px;
          bottom: 34px;
        }
        .rbtn {
          width: 92px;
          height: 92px;
          border-radius: 50%;
          border: 3px solid #fff3;
          font-size: 1.9rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: #fff;
          background: radial-gradient(circle at 30% 30%, #ff7ab0, #d81b73);
          box-shadow: 0 6px 0 #9c1250;
          user-select: none;
          touch-action: none;
        }
        .rbtn span {
          font-size: 0.7rem;
          font-weight: 800;
        }
        .rbtn:active {
          transform: translateY(4px);
          box-shadow: 0 2px 0 #9c1250;
        }
        .hint {
          position: absolute;
          bottom: 8px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 0.82rem;
          color: var(--ink-dim);
          background: rgba(0, 0, 0, 0.4);
          padding: 5px 14px;
          border-radius: 10px;
          pointer-events: none;
          text-align: center;
          max-width: 92vw;
        }
        .hint.seek {
          color: #ffd54f;
          font-weight: 700;
        }
      `}</style>
    </>
  );
}

function Joystick({ onVec }: { onVec: (dx: number, dy: number) => void }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef(false);
  const R = 52;

  const handle = (clientX: number, clientY: number) => {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const m = Math.hypot(dx, dy);
    if (m > R) {
      dx = (dx / m) * R;
      dy = (dy / m) * R;
    }
    setKnob({ x: dx, y: dy });
    onVec(dx / R, dy / R);
  };

  return (
    <div
      ref={baseRef}
      className="joy"
      onPointerDown={(e) => {
        active.current = true;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        handle(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => active.current && handle(e.clientX, e.clientY)}
      onPointerUp={() => {
        active.current = false;
        setKnob({ x: 0, y: 0 });
        onVec(0, 0);
      }}
      onPointerCancel={() => {
        active.current = false;
        setKnob({ x: 0, y: 0 });
        onVec(0, 0);
      }}
    >
      <div className="knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
      <style jsx>{`
        .joy {
          position: absolute;
          left: 26px;
          bottom: 30px;
          width: 132px;
          height: 132px;
          border-radius: 50%;
          background: rgba(0, 0, 0, 0.28);
          border: 2px solid var(--line);
          touch-action: none;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .knob {
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: radial-gradient(circle at 30% 30%, #fff6, #2bb39a);
          border: 2px solid #fff5;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}

// ---------------- glass bridge (turn-based relay) ----------------
function GlassControls() {
  const youId = useGame((s) => s.youId);
  const [st, setSt] = useState({ active: "", activeName: "", phase: "choose", alive: true, finished: false });
  const turnRef = useRef(false);

  // poll the snapshot so only the blob whose turn it is can pick
  useEffect(() => {
    const iv = setInterval(() => {
      const cur = snapBuffer.cur;
      if (!cur || cur.game !== "glassbridge") return;
      const d: any = cur.data || {};
      const me = (d.walkers || []).find((w: any) => w.id === youId);
      const act = (d.walkers || []).find((w: any) => w.id === d.activeId);
      turnRef.current = d.activeId === youId && d.phase === "choose";
      setSt({
        active: d.activeId || "",
        activeName: act?.name || "someone",
        phase: d.phase || "choose",
        alive: me ? me.alive : true,
        finished: me ? me.finished : false,
      });
    }, 100);
    return () => clearInterval(iv);
  }, [youId]);

  const choose = (v: "L" | "R") => {
    if (!turnRef.current) return; // only the active blob, only while choosing
    net.input({ kind: "choose", value: v });
    recordGlassChoice(v === "R" ? 1 : -1);
    audio.sfx("blip");
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "arrowleft" || k === "a") choose("L");
      if (k === "arrowright" || k === "d") choose("R");
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  const yourTurn = st.active === youId && st.phase === "choose";
  const hint = st.finished
    ? "🏁 You made it across — safe!"
    : !st.alive
      ? "💥 You shattered the glass. Spectating…"
      : yourTurn
        ? "YOUR TURN — LEFT or RIGHT. One holds, one shatters."
        : `⏳ Watch ${st.activeName} guess — learn the pattern…`;

  return (
    <div className="glass-btns">
      <div className="glass-turn">{hint}</div>
      <div className="glass-row">
        <button className="gbtn" disabled={!yourTurn} onPointerDown={() => choose("L")}>
          ◀<span>LEFT</span>
        </button>
        <button className="gbtn" disabled={!yourTurn} onPointerDown={() => choose("R")}>
          <span>RIGHT</span>▶
        </button>
      </div>
      <style jsx>{`
        .glass-btns {
          position: absolute;
          bottom: 34px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }
        .glass-turn {
          font-family: var(--font-display);
          font-weight: 800;
          font-size: 0.95rem;
          color: var(--yellow);
          background: rgba(0, 0, 0, 0.45);
          padding: 5px 16px;
          border-radius: 12px;
          text-align: center;
          max-width: 92vw;
        }
        .glass-row {
          display: flex;
          gap: 30px;
        }
        .gbtn:disabled {
          opacity: 0.35;
          filter: grayscale(0.5);
        }
        .gbtn {
          width: 150px;
          height: 92px;
          border-radius: 18px;
          border: 3px solid #80d8ff;
          background: linear-gradient(180deg, rgba(128, 216, 255, 0.4), rgba(128, 216, 255, 0.15));
          color: #fff;
          font-family: var(--font-display);
          font-size: 2rem;
          font-weight: 800;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          box-shadow: 0 6px 0 #0288a8;
        }
        .gbtn span {
          font-size: 1rem;
        }
        .gbtn:active {
          transform: translateY(4px);
          box-shadow: 0 2px 0 #0288a8;
        }
      `}</style>
    </div>
  );
}

// ---------------- mash (tug of war / jump rope) ----------------
function MashControls({ label, action, color }: { label: string; action: "pull" | "jump"; color: string }) {
  const tap = () => {
    net.input({ kind: "tap" });
    audio.sfx(action === "jump" ? "jump" : "drum");
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === " " || e.key.toLowerCase() === (action === "jump" ? "w" : "e")) {
        e.preventDefault();
        tap();
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);
  return (
    <div className="mash">
      <button className={`mashbtn ${color}`} onPointerDown={tap}>
        {label}
      </button>
      <div className="hint">SMASH the button or tap SPACE!</div>
      <style jsx>{`
        .mash {
          position: absolute;
          bottom: 40px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }
        .mashbtn {
          width: 230px;
          height: 140px;
          border-radius: 28px;
          border: 4px solid #fff4;
          font-family: var(--font-display);
          font-size: 2.4rem;
          font-weight: 800;
          color: #fff;
          background: radial-gradient(circle at 30% 25%, #ff7ab0, #d81b73);
          box-shadow: 0 8px 0 #9c1250;
          user-select: none;
          touch-action: none;
        }
        .mashbtn.teal {
          background: radial-gradient(circle at 30% 25%, #7defff, #00bcd4);
          box-shadow: 0 8px 0 #00838f;
          color: #06241f;
        }
        .mashbtn:active {
          transform: translateY(6px);
          box-shadow: 0 2px 0 #9c1250;
        }
        .hint {
          font-size: 0.85rem;
          color: var(--ink-dim);
          background: rgba(0, 0, 0, 0.35);
          padding: 4px 12px;
          border-radius: 10px;
        }
      `}</style>
    </div>
  );
}

// ---------------- chutes & ladders (roll the die) ----------------
const ROLL_CD_MS = 700; // mirrors the server's per-roll cooldown
function RollControls() {
  const youId = useGame((s) => s.youId);
  const [cd, setCd] = useState(0); // 1 = just rolled, 0 = ready
  const [finished, setFinished] = useState(false);
  const cdRef = useRef(0);
  const finRef = useRef(false);

  const roll = () => {
    if (cdRef.current > 0 || finRef.current) return;
    net.input({ kind: "tap" });
    audio.sfx("drum");
    cdRef.current = ROLL_CD_MS;
    setCd(1);
  };

  // keyboard: SPACE rolls
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        roll();
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  // tick the local cooldown bar + watch for topping out
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      if (cdRef.current > 0) {
        cdRef.current = Math.max(0, cdRef.current - dt);
        setCd(cdRef.current / ROLL_CD_MS);
      }
      const cur = snapBuffer.cur;
      if (cur?.game === "chutesladders") {
        const me = (cur.data as any)?.climbers?.find((c: any) => c.id === youId);
        const fin = !!me?.finished;
        if (fin !== finRef.current) {
          finRef.current = fin;
          setFinished(fin);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [youId]);

  const ready = cd <= 0 && !finished;
  return (
    <div className="roll">
      <button className={`rollbtn ${ready ? "ready" : ""} ${finished ? "safe" : ""}`} onPointerDown={roll} disabled={finished}>
        <span className="lbl">{finished ? "🏁 SAFE!" : "🎲 ROLL"}</span>
        {!finished && <span className="cdfill" style={{ transform: `scaleX(${1 - cd})` }} />}
      </button>
      <div className="hint">
        {finished ? "🏁 SAFE at the top — you made it. Enjoy the view." : "SMASH to roll · 🪜 climb to safety · 🐍 snakes can KILL · reach the top!"}
      </div>
      <style jsx>{`
        .roll {
          position: absolute;
          bottom: 36px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }
        .rollbtn {
          position: relative;
          overflow: hidden;
          width: 210px;
          height: 120px;
          border-radius: 26px;
          border: 4px solid #fff4;
          font-family: var(--font-display);
          font-size: 2.2rem;
          font-weight: 800;
          color: #fff;
          background: radial-gradient(circle at 30% 25%, #ffd36b, #e8930f);
          box-shadow: 0 8px 0 #9c5f06;
          user-select: none;
          touch-action: none;
        }
        .rollbtn .lbl {
          position: relative;
          z-index: 2;
          text-shadow: 0 2px 0 rgba(0, 0, 0, 0.25);
        }
        .rollbtn.ready {
          background: radial-gradient(circle at 30% 25%, #aef5b5, #2bb84d);
          box-shadow: 0 8px 0 #157a2e;
          animation: rollPulse 1.1s ease-in-out infinite;
        }
        .rollbtn.safe {
          background: radial-gradient(circle at 30% 25%, #7defff, #00bcd4);
          box-shadow: 0 8px 0 #00838f;
          opacity: 0.85;
        }
        .rollbtn:active {
          transform: translateY(6px);
          box-shadow: 0 2px 0 #9c5f06;
        }
        .cdfill {
          position: absolute;
          left: 0;
          bottom: 0;
          width: 100%;
          height: 7px;
          transform-origin: left;
          background: #fff;
          opacity: 0.85;
          z-index: 1;
        }
        @keyframes rollPulse {
          0%,
          100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.04);
          }
        }
        .hint {
          font-size: 0.85rem;
          color: var(--ink-dim);
          background: rgba(0, 0, 0, 0.35);
          padding: 4px 12px;
          border-radius: 10px;
          text-align: center;
          max-width: 92vw;
        }
      `}</style>
    </div>
  );
}

// ---------------- RPS minus one ----------------
const THROW_LABEL: Record<string, string> = { R: "✊ Rock", P: "✋ Paper", S: "✌️ Scissors" };
const THROW_ICON: Record<string, string> = { R: "✊", P: "✋", S: "✌️" };
const THROW_WORD: Record<string, string> = { R: "Rock", P: "Paper", S: "Scissors" };
function RpsControls() {
  const youId = useGame((s) => s.youId);
  const [phase, setPhase] = useState("pick");
  const [myThrows, setMyThrows] = useState<string[]>([]);
  const [picks, setPicks] = useState<string[]>([]);
  const [locked, setLocked] = useState(false);
  const [kept, setKept] = useState<string | null>(null);
  const [status, setStatus] = useState("pick");
  const [ties, setTies] = useState(0);

  // poll snapshot for phase + my duel
  useEffect(() => {
    const iv = setInterval(() => {
      const cur = snapBuffer.cur;
      if (!cur || cur.game !== "rpsminusone") return;
      const d: any = cur.data || {};
      const duel = (d.duels || []).find((x: any) => x.a === youId || x.b === youId);
      const ph = d.phase || "pick";
      setPhase(ph);
      if (duel) {
        const mine = duel.a === youId ? duel.aThrows : duel.bThrows;
        setMyThrows(mine || []);
        setStatus(duel.status);
        setTies(duel.ties || 0);
      }
    }, 120);
    return () => clearInterval(iv);
  }, [youId]);

  // reset locks when phase changes
  const lastPhase = useRef("pick");
  useEffect(() => {
    if (phase !== lastPhase.current) {
      lastPhase.current = phase;
      if (phase === "pick") {
        setPicks([]);
        setLocked(false);
        setKept(null);
      }
      if (phase === "drop") setKept(null);
    }
  }, [phase]);

  function pick(t: string) {
    if (locked || picks.length >= 2) return;
    audio.sfx("blip");
    const next = [...picks, t];
    setPicks(next);
    if (next.length === 2) {
      net.input({ kind: "choose", value: next.join("") });
      setLocked(true);
    }
  }
  function keep(t: string) {
    if (kept) return;
    audio.sfx("click");
    setKept(t);
    net.input({ kind: "choose", value: t });
  }

  return (
    <div className="rps-ctl">
      {phase === "pick" && (
        <>
          {ties > 0 && <div className="rps-tie">🤝 TIE #{ties} — same throw, nobody’s out. Throw again!</div>}
          <div className="rps-title">{locked ? "Locked! Waiting for the drop…" : `Pick TWO throws (${picks.length}/2)`}</div>
          {!locked && (
            <div className="rps-row">
              {["R", "P", "S"].map((t) => (
                <button key={t} className="rps-btn" onClick={() => pick(t)}>
                  <span className="rps-ico">{THROW_ICON[t]}</span> {THROW_WORD[t]}
                </button>
              ))}
            </div>
          )}
          {picks.length > 0 && <div className="rps-picks">You: {picks.map((p) => THROW_LABEL[p].split(" ")[0]).join("  ")}</div>}
        </>
      )}
      {phase === "drop" && (
        <>
          <div className="rps-title">{kept ? "Locked in!" : "DROP one — keep your best hand!"}</div>
          {!kept && (
            <div className="rps-row">
              {myThrows.map((t, i) => (
                <button key={i} className="rps-btn keep" onClick={() => keep(t)}>
                  Keep <span className="rps-ico">{THROW_ICON[t]}</span> {THROW_WORD[t]}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {(phase === "resolve" || status === "done") && (
        <div className="rps-title">{status === "done" ? "Result!" : "Throwing…"}</div>
      )}
      <style jsx>{`
        .rps-ctl {
          position: absolute;
          bottom: 28px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          background: rgba(0, 0, 0, 0.4);
          border: 2px solid var(--line);
          border-radius: 18px;
          padding: 14px 22px;
        }
        .rps-title {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 1.1rem;
        }
        .rps-row {
          display: flex;
          gap: 12px;
        }
        .rps-btn {
          background: rgba(255, 79, 154, 0.18);
          border: 2px solid var(--line-bright);
          border-radius: 14px;
          padding: 14px 20px;
          color: #fff;
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 1.1rem;
        }
        .rps-btn:active {
          transform: translateY(3px);
        }
        .rps-btn.keep {
          background: rgba(31, 227, 194, 0.18);
          border-color: var(--teal);
        }
        /* Hands thrown sideways (a real RPS throw), rotated 90° — never flipped
           upside-down. */
        .rps-ico {
          display: inline-block;
          transform: rotate(90deg);
          font-size: 1.3rem;
          vertical-align: middle;
        }
        .rps-tie {
          font-size: 0.95rem;
          font-weight: 800;
          color: var(--yellow);
        }
        .rps-picks {
          font-size: 0.9rem;
          color: var(--ink-dim);
        }
      `}</style>
    </div>
  );
}

// ---------------- present / secret santa (guess the giver) ----------------
function PresentControls() {
  const youId = useGame((s) => s.youId);
  const room = useGame((s) => s.room);
  const [phase, setPhase] = useState("dark");
  const [cands, setCands] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    const iv = setInterval(() => {
      const cur = snapBuffer.cur;
      if (!cur || cur.game !== "present") return;
      const d: any = cur.data || {};
      setPhase(d.phase || "dark");
      const ev = (d.events || []).find((e: any) => e.receiverId === youId);
      setCands(ev?.candidateIds || []);
      if (d.phase !== "guess") setPicked(null);
    }, 120);
    return () => clearInterval(iv);
  }, [youId]);

  const players = room?.players || [];
  const pinfo = (id: string) => players.find((p) => p.id === id);
  const variants = characterVariants(players);

  function choose(id: string) {
    if (picked) return;
    setPicked(id);
    net.input({ kind: "choose", value: id });
    audio.sfx("click");
  }

  const isReceiver = phase === "guess" && cands.length > 0;

  return (
    <div className="present-ctl">
      {isReceiver ? (
        <>
          <div className="present-title">{picked ? "Locked in! 🤞" : "🎁 Who gave you the gift?"}</div>
          <div className="present-row">
            {cands.map((id) => {
              const p = pinfo(id);
              return (
                <button
                  key={id}
                  className={`present-btn ${picked === id ? "sel" : ""}`}
                  disabled={!!picked}
                  onClick={() => choose(id)}
                >
                  <BlobAvatar characterId={p?.characterId || "avo"} size={46} variant={variants.get(id) ?? 0} />
                  <span>{p?.name || "???"}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="present-hint">
          {phase === "dark"
            ? "🌑 Lights out — a gift is being placed…"
            : phase === "reveal"
              ? "🎁 Unwrapping the truth…"
              : "🎁 Watching the parlor…"}
        </div>
      )}
      <style jsx>{`
        .present-ctl {
          position: absolute;
          bottom: 28px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          background: rgba(0, 0, 0, 0.45);
          border: 2px solid var(--line);
          border-radius: 18px;
          padding: 14px 22px;
          max-width: 92vw;
        }
        .present-title {
          font-family: var(--font-display);
          font-weight: 800;
          font-size: 1.15rem;
        }
        .present-hint {
          font-family: var(--font-display);
          font-weight: 700;
          color: var(--ink-dim);
        }
        .present-row {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 10px;
        }
        .present-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          background: rgba(255, 79, 154, 0.14);
          border: 2px solid var(--line-bright);
          border-radius: 14px;
          padding: 8px 12px;
          color: #fff;
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 0.85rem;
          min-width: 78px;
        }
        .present-btn.sel {
          border-color: var(--yellow);
          background: rgba(255, 213, 79, 0.2);
        }
        .present-btn:disabled {
          opacity: 0.55;
        }
        .present-btn:active {
          transform: translateY(2px);
        }
      `}</style>
    </div>
  );
}

// ---------------- simon says (obey the order, or freeze) ----------------
function SimonControls() {
  const [phase, setPhase] = useState("ready");
  const [freeze, setFreeze] = useState(false);
  const [pressed, setPressed] = useState<string | null>(null);
  const beatRef = useRef(-1);
  const phaseRef = useRef("ready");
  const pressedRef = useRef<string | null>(null);

  // poll the snapshot so we can lock exactly one input per order (and reset on
  // each new beat). The server is the authority; this is just for feel.
  useEffect(() => {
    const iv = setInterval(() => {
      const cur = snapBuffer.cur;
      if (!cur || cur.game !== "simonsays") return;
      const d: any = cur.data || {};
      if (d.beat !== beatRef.current) {
        beatRef.current = d.beat;
        pressedRef.current = null;
        setPressed(null);
      }
      phaseRef.current = d.phase;
      setPhase(d.phase);
      setFreeze(!!d.freeze);
    }, 80);
    return () => clearInterval(iv);
  }, []);

  const press = (key: string) => {
    if (phaseRef.current !== "call") return; // window isn't open
    if (pressedRef.current) return; // already answered this order
    pressedRef.current = key;
    setPressed(key);
    net.input({ kind: "choose", value: key });
    audio.sfx("blip");
  };

  // keyboard: W / A / S / D + SPACE → the matching order
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const raw = e.key === " " || e.key === "Spacebar" ? " " : e.key.toLowerCase();
      const cmd = simonByHotkey(raw);
      if (!cmd) return;
      e.preventDefault();
      press(cmd.key);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  const open = phase === "call";
  const status =
    phase === "ready"
      ? "👂 Simon says…"
      : freeze
        ? "🧊 FREEZE — hands OFF!"
        : open
          ? pressed
            ? "Locked in! 🤞"
            : "GO — do it NOW!"
          : "…";

  return (
    <div className={`simon-ctl ${freeze && open ? "danger" : ""}`}>
      <div className="simon-status">{status}</div>
      <div className="simon-row">
        {SIMON_COMMANDS.map((c) => (
          <button
            key={c.key}
            className={`simon-btn ${pressed === c.key ? "sel" : ""}`}
            onPointerDown={(e) => {
              e.preventDefault();
              press(c.key);
            }}
          >
            <span className="simon-emoji">{c.emoji}</span>
            <span className="simon-label">{c.short}</span>
            <span className="simon-key">{c.keyLabel}</span>
          </button>
        ))}
      </div>
      <div className="simon-hint">
        Do the order shown above — tap its button or press the key on it. {SIMON_FREEZE.emoji}{" "}
        <strong>FREEZE</strong> means touch NOTHING — a wrong move, fumble, or one twitch and you&apos;re boxed.
      </div>
      <style jsx>{`
        .simon-ctl {
          position: absolute;
          bottom: 22px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          background: rgba(0, 0, 0, 0.42);
          border: 2px solid var(--line);
          border-radius: 18px;
          padding: 12px 18px 10px;
          max-width: 96vw;
        }
        .simon-ctl.danger {
          border-color: var(--red);
          box-shadow: 0 0 0 2px rgba(255, 46, 90, 0.25), 0 0 26px rgba(255, 46, 90, 0.35);
        }
        .simon-status {
          font-family: var(--font-display);
          font-weight: 800;
          font-size: 1.05rem;
          color: #fff;
        }
        .simon-ctl.danger .simon-status {
          color: #ff8fb3;
        }
        .simon-row {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: center;
        }
        .simon-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          min-width: 78px;
          padding: 8px 10px 6px;
          border-radius: 14px;
          border: 2px solid var(--line-bright);
          background: rgba(255, 79, 154, 0.16);
          color: #fff;
          font-family: var(--font-display);
          font-weight: 700;
          user-select: none;
          touch-action: none;
        }
        .simon-btn:active {
          transform: translateY(3px);
        }
        .simon-btn.sel {
          border-color: var(--yellow);
          background: rgba(255, 213, 79, 0.24);
        }
        .simon-emoji {
          font-size: 1.7rem;
          line-height: 1;
        }
        .simon-label {
          font-size: 0.8rem;
        }
        .simon-key {
          font-size: 0.74rem;
          font-weight: 800;
          color: #06241f;
          background: var(--yellow);
          border-radius: 6px;
          padding: 1px 8px;
        }
        .simon-hint {
          font-size: 0.9rem;
          color: var(--ink);
          text-align: center;
          max-width: 560px;
          line-height: 1.35;
        }
        .simon-hint strong {
          color: #bbe9ff;
        }
      `}</style>
    </div>
  );
}
