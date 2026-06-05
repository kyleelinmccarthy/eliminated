import type { GameId } from "../../shared/types";
import type { Minigame, GameContext } from "./Minigame";
import { GAMES } from "../../shared/games";
import { RedLightGreenLight } from "./RedLightGreenLight";
import { Tag } from "./Tag";
import { Mingle } from "./Mingle";
import { GlassBridge } from "./GlassBridge";
import { TugOfWar } from "./TugOfWar";
import { RpsMinusOne } from "./RpsMinusOne";
import { JumpRope } from "./JumpRope";
import { Boomerang } from "./Boomerang";
import { Dodgeball } from "./Dodgeball";
import { MusicalChairs } from "./MusicalChairs";
import { PresentSwap } from "./PresentSwap";
import { PropHunt } from "./PropHunt";
import { KingOfTheHill } from "./KingOfTheHill";

const CTORS: Record<GameId, new (ctx: GameContext) => Minigame> = {
  redlight: RedLightGreenLight,
  tag: Tag,
  mingle: Mingle,
  glassbridge: GlassBridge,
  tugofwar: TugOfWar,
  rpsminusone: RpsMinusOne,
  jumprope: JumpRope,
  boomerang: Boomerang,
  dodgeball: Dodgeball,
  musicalchairs: MusicalChairs,
  present: PresentSwap,
  prophunt: PropHunt,
  koth: KingOfTheHill,
};

export function createMinigame(id: GameId, ctx: GameContext): Minigame {
  return new CTORS[id](ctx);
}

export function minPlayersFor(id: GameId): number {
  return GAMES[id].minPlayers;
}
