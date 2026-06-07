// Geometry for placing Tug-of-War pullers on their LEDGE (never over the pit).
//
// The two teams stand on solid platforms either side of a central pit: team 0
// (blue) on the LEFT ledge, team 1 (pink) on the RIGHT ledge. A team's `side` is
// -1 (left) or +1 (right). `pitEdge` is the INNER edge of that team's platform —
// the left pit boundary for the left team, the right pit boundary for the right
// team. Pullers line up BACK from that edge (away from the void), so a higher
// index sits further from the pit, deeper on the ledge.
//
// `lean` shifts the whole formation toward the winning side as the rope slides;
// that is what drags the LOSING team toward (and finally into) the pit — the
// whole point of the game. At the start (lean 0) every puller is on solid ground.

export const TUG_ANCHOR = 60; // first puller's distance back from the pit edge
export const TUG_SPACING = 58; // gap between successive pullers on a team

export function tugSide(team: number): -1 | 1 {
  return team === 0 ? -1 : 1;
}

export function pullerStandX(
  pitEdge: number,
  side: -1 | 1,
  index: number,
  lean = 0,
  anchor = TUG_ANCHOR,
  spacing = TUG_SPACING,
): number {
  // `+ side * offset` pushes the team AWAY from the pit onto its own ledge:
  // the left team (side -1) sits left of the left edge; the right team (side +1)
  // sits right of the right edge. (The earlier renderer SUBTRACTED here, which
  // planted both teams out over the pit from the very first frame.)
  return pitEdge + side * (anchor + index * spacing) + lean;
}
