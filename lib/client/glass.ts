// Local player's most recent glass-bridge tile pick, shared from the controls
// to the renderer so your blob can visibly step toward the tile you chose.
// (The server snapshot only reports row + stun, not which side you picked.)
export const glassChoice: { side: -1 | 1; at: number } = { side: 1, at: -1 };

export function recordGlassChoice(side: -1 | 1) {
  glassChoice.side = side;
  glassChoice.at = typeof performance !== "undefined" ? performance.now() : 0;
}
