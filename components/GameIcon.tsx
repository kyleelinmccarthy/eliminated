import type { CSSProperties } from "react";
import { GAMES } from "@/lib/shared/games";
import type { GameId } from "@/lib/shared/types";

// A real rock-paper-scissors throw lands on its side — the hand comes down
// horizontal, it doesn't salute the ceiling. So everywhere the RPS Minus One
// icon shows up we tip each hand 90° (sideways, never upside-down) to mirror the
// actual throw. Every other game renders its icon untouched.
const RPS_HANDS = ["✊", "✋", "✌️"];

export function GameIcon({
  id,
  className,
  style,
}: {
  id: GameId;
  className?: string;
  style?: CSSProperties;
}) {
  if (id === "rpsminusone") {
    return (
      <span className={className} style={style}>
        {RPS_HANDS.map((hand, i) => (
          <span key={i} style={{ display: "inline-block", transform: "rotate(90deg)" }}>
            {hand}
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className={className} style={style}>
      {GAMES[id].icon}
    </span>
  );
}
