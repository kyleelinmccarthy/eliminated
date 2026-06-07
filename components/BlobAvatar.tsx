"use client";
import { useEffect, useRef } from "react";
import { drawBlob } from "@/lib/client/render/draw";

export function BlobAvatar({
  characterId,
  size = 72,
  animate = false,
  anim = "idle",
  variant = 0,
  accessories,
}: {
  characterId: string;
  size?: number;
  animate?: boolean;
  anim?: string;
  variant?: number; // >0 = same-icon accent rim, matching the in-game disambiguation
  accessories?: string[]; // equipped cosmetic ids to draw over the blob
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Stable dependency for the equipped list so the effect re-runs when it changes
  // (arrays are compared by identity otherwise).
  const accKey = (accessories ?? []).join(",");

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    cv.width = size * dpr;
    cv.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let raf = 0;
    const render = (t: number) => {
      ctx.clearRect(0, 0, size, size);
      drawBlob(ctx, characterId, size / 2, size / 2 + size * 0.04, {
        r: size * 0.3,
        time: t,
        anim,
        variant,
        accessories,
      });
      if (animate) raf = requestAnimationFrame(render);
    };
    render(animate ? performance.now() : 0);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId, size, animate, anim, variant, accKey]);

  return <canvas ref={ref} style={{ width: size, height: size, display: "block" }} />;
}
