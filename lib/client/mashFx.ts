// Local-only feedback for mash games (tug of war). Records the moment YOU last
// tapped so the canvas can show an instant yank — a knot jerk + a pulse ring on
// your blob — before the next 20Hz server snapshot lands. Without this, the rope
// only reflects *net* force, so when your side is losing the per-capita battle it
// drifts away no matter how hard you mash and it feels like input is being eaten.
// performance.now()-based to match RenderCtx.time (the rAF clock in GameStage).
export const mashFx = { lastTapAt: -1e9 };

export function registerMashTap(): void {
  mashFx.lastTapAt = performance.now();
}
