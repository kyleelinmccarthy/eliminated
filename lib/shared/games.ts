// Catalog metadata for each minigame (display info + how the game master frames
// it). The actual server logic lives in lib/server/games/*.

import type { GameId } from "./types";

export type ControlHint = "move" | "tap" | "choose" | "aim" | "team";

export interface GameMeta {
  id: GameId;
  name: string;
  tagline: string;
  icon: string; // emoji for menus
  rules: string; // short how-to shown on the intro card
  controls: ControlHint[];
  controlText: string;
  // How the Game Master's voice should pronounce it (TTS). Defaults to `name`
  // when omitted — set it when the display name reads badly aloud (e.g. "RPS").
  spokenName?: string;
  // Roughly how long a round lasts, shown on the intro card so players know what
  // they're in for ("how long is this going to take").
  lengthHint?: string;
  // Some games only make sense with an even headcount (balanced teams / clean
  // 1v1 pairings). The Game Master skips these when the field is odd.
  requiresEven?: boolean;
  minPlayers: number;
  arena: "field" | "bridge" | "rope" | "board" | "duel" | "parlor"; // renderer family
  flavors: string[]; // game-master quips chosen at random
  // How many players this game tends to eliminate. The Game Master avoids
  // "high" games as the very first round so a series doesn't open brutally.
  cull?: "low" | "mid" | "high";
  // Finale games are never picked at random — they're forced as the LAST round.
  finale?: boolean;
  // Finale-CAPABLE games can decisively crown a single survivor (so they're
  // eligible for the last round), but unlike `finale` they ALSO appear in the
  // normal rotation. On the final round they're told to leave exactly one blob.
  finaleCapable?: boolean;
}

export const GAMES: Record<GameId, GameMeta> = {
  redlight: {
    id: "redlight",
    name: "Red Light, Green Light",
    tagline: "Move on green. Freeze on red. The Doll does not do warnings.",
    icon: "🚦",
    rules: "Reach the finish line. While the Doll watches (RED), any movement is fatal. Move only on GREEN. She does not accept appeals.",
    controls: ["move"],
    controlText: "W / ↑ runs forward (or drag). A·D dodge between lanes. FREEZE the instant it turns RED.",
    lengthHint: "~45s",
    minPlayers: 1,
    arena: "field",
    cull: "mid",
    flavors: [
      "The Doll has woken up. She'd like you to hold very still. Forever, ideally.",
      "Green means go. Red means a frank conversation about your choices.",
      "Statues live. Dancers get a lovely memorial tile.",
    ],
  },
  tag: {
    id: "tag",
    name: "Freeze Tag",
    tagline: "Blue hunts. Pink runs. Thaw your friends or shatter at the buzzer.",
    icon: "❄️",
    rules: "🔵 BLUE are the freezers (they glow) — chase the 🩷 PINK runners and one touch freezes a runner solid. PINK: thaw a frozen teammate by touching them. At the buzzer, any PINK still frozen is eliminated — and any BLUE freezer who caught NOBODY goes down too.",
    controls: ["move", "team"],
    controlText: "Move with WASD / Arrows or drag. BLUE: bump pink runners to FREEZE them (catch at least one!). PINK: run — and touch a frozen teammate to THAW them.",
    lengthHint: "~35s",
    requiresEven: true,
    minPlayers: 4,
    arena: "field",
    cull: "low",
    flavors: [
      "Cold hands, colder severance package.",
      "Blue's job is to catch. Pink's job is to not be caught. Riveting stuff.",
      "Thaw your friends. Or don't. The buzzer isn't picky.",
    ],
  },
  mingle: {
    id: "mingle",
    name: "Mingle",
    tagline: "Form a group of exactly the right size. Make friends or make peace with it.",
    icon: "🫂",
    rules: "Everyone starts on the spinning platform while the music plays. When it STOPS, a number appears — sprint off into one of the ring circles in a group of EXACTLY that many. Too few, too many, or still on the platform? Eliminated. It's networking, but lethal.",
    controls: ["move"],
    controlText: "Move with WASD / Arrows or drag. When the music stops and a number appears, pile into a ring circle in a group of exactly that size.",
    lengthHint: "~40s",
    minPlayers: 4,
    arena: "field",
    cull: "low",
    flavors: [
      "Mingle! Network! Your survival is now a team-building exercise.",
      "Groups of the wrong size will be… right-sized.",
      "Find your people. They will absolutely abandon you.",
    ],
  },
  glassbridge: {
    id: "glassbridge",
    name: "Glass Stepping Stones",
    tagline: "One tile holds. One doesn't. Gamble with your feet.",
    icon: "🪟",
    rules: "One bridge, one hidden safe path. You cross ONE AT A TIME, in line order: the blob up front guesses LEFT or RIGHT for the next pane. Guess right and you step on; guess WRONG and the glass shatters — you're gone, but everyone behind now sees the safe side. Cross, or run out of blobs trying.",
    controls: ["choose"],
    controlText: "When it's your turn, press ← / → (or tap) to pick the LEFT or RIGHT pane.",
    lengthHint: "~30s",
    minPlayers: 1,
    arena: "bridge",
    cull: "mid",
    flavors: [
      "One pane is tempered. One is a skylight. Choose.",
      "It's a fifty-fifty. The house already took the other fifty.",
      "Don't look down. Fine, look down. It changes nothing.",
    ],
  },
  tugofwar: {
    id: "tugofwar",
    name: "Tug of War",
    tagline: "Mash to pull. The losing team tests gravity.",
    icon: "🪢",
    rules: "Two teams. Mash the button to pull the rope your way. The team dragged over the edge is eliminated. Gravity handles the rest.",
    controls: ["tap", "team"],
    controlText: "SMASH the button (or Space / click) as fast as you can!",
    lengthHint: "~30s",
    minPlayers: 2,
    arena: "rope",
    cull: "high",
    flavors: [
      "Strength in numbers. And in repetitive strain injury.",
      "Heave! Ho! Into the void with the underperformers.",
      "A battle of thumbs, settled by a cliff.",
    ],
  },
  rpsminusone: {
    id: "rpsminusone",
    name: "RPS Minus One",
    tagline: "Throw two. Drop one. Outthink a stranger or die trying.",
    icon: "✊✋✌️",
    rules: "Face one opponent. Pick TWO throws before the clock runs out, then DROP one — beat the timer or you FORFEIT the duel and you're out. Standard rock-paper-scissors decides it — the loser is eliminated. A TIE (same throw) hurts no one: you both simply throw again until someone wins.",
    controls: ["choose", "duel"] as any,
    controlText: "Click two throws, then click the one to KEEP — beat the countdown or you forfeit. Tie = throw again, nobody's out.",
    spokenName: "Rock, Paper, Scissors. Minus one.",
    lengthHint: "~30s",
    requiresEven: true,
    minPlayers: 2,
    arena: "duel",
    cull: "high",
    finaleCapable: true, // as a finale it runs a full single-elim bracket to one
    flavors: [
      "Mind games. The loser forfeits a hand and the rest of them.",
      "Rock, paper, scissors, minus one, plus consequences.",
      "Two throws, one choice, no refunds.",
    ],
  },
  jumprope: {
    id: "jumprope",
    name: "Killer Jump Rope",
    tagline: "Skip your way across the bridge. The rope is patient. You are not.",
    icon: "🤸",
    rules: "A giant rope sweeps the deck of a bridge over a long drop. Every clean JUMP carries you one plank further across. Mistime it and you're swept off the edge. Reach the far side and you're safe — but the rope only gets faster.",
    controls: ["tap"],
    controlText: "Press SPACE / click / tap to JUMP the rope and cross the bridge.",
    lengthHint: "~40s",
    minPlayers: 1,
    arena: "rope",
    cull: "mid",
    finaleCapable: true, // first across the bridge
    flavors: [
      "Skip, skip, skip… into the abyss.",
      "It's not the rope that kills you. It's the plank you never reach.",
      "Cross the bridge, or become a cautionary tale at the bottom of it.",
    ],
  },
  boomerang: {
    id: "boomerang",
    name: "Boomerang Brawl",
    tagline: "Throw, dodge, grab questionable powerups. Last blob standing.",
    icon: "🪃",
    rules: "A free-for-all arena. Hurl your boomerang, dodge incoming, and grab wild powerups. Last blob standing survives!",
    controls: ["move", "aim"],
    controlText: "Move with WASD / Arrows. Aim with the mouse, click to THROW. Dash with Shift.",
    lengthHint: "~45s",
    minPlayers: 2,
    arena: "field",
    cull: "high",
    finaleCapable: true, // free-for-all last blob standing
    flavors: [
      "Steel yourselves. The boomerangs, like your problems, come back.",
      "Grab a powerup. It might save you. It might curse you. We're not telling.",
      "All fun and games until it returns to sender.",
    ],
  },
  dodgeball: {
    id: "dodgeball",
    name: "Dodgeball",
    tagline: "Two teams, one line, a tasteful hail of rubber. Last team standing.",
    icon: "🤾",
    rules: "Grab a ball and hurl it across the line. Anyone hit (no shield) is OUT. Dash to dodge. Wipe out the other team — or just have more blobs left when the buzzer sounds.",
    controls: ["move", "aim"],
    controlText: "WASD move · mouse aim · click / SPACE throw · SHIFT dash to dodge.",
    lengthHint: "~45s",
    minPlayers: 4,
    arena: "field",
    cull: "mid",
    flavors: [
      "Dodge, duck, dip, dive, and die.",
      "If you can dodge a boomerang, you can dodge accountability.",
      "Rubber meets blob. Blob does not file a complaint.",
    ],
  },
  musicalchairs: {
    id: "musicalchairs",
    name: "Musical Chairs",
    tagline: "When the music stops, grab a seat. Or grab a clue.",
    icon: "🪑",
    rules: "Roam while the music plays. The instant it STOPS, race to a chair. One blob per chair — anyone left standing is ELIMINATED. A chair vanishes each round, because scarcity is the point.",
    controls: ["move"],
    controlText: "Move with WASD / Arrows or drag. The chairs only appear when the music STOPS — then sprint!",
    lengthHint: "~40s",
    minPlayers: 3,
    arena: "field",
    cull: "low",
    flavors: [
      "Round and round… one of you is about to learn about scarcity.",
      "The music is lying to you. It always stops. Like everything.",
      "Butts in seats, blobs. Everyone else, into the ground.",
    ],
  },
  present: {
    id: "present",
    name: "Secret Santa Sabotage",
    tagline: "Pick a mark in the dark. Guess your giver, or pay for the gesture.",
    icon: "🎁",
    rules: "When the lights drop, a few secret GIVERS each slip a gift to a blob of THEIR choosing. Lights up: if you got a gift, guess who gave it — guess right and the giver is caught & OUT; guess wrong and YOU'RE out. Givers: choose your mark, then stay hidden.",
    controls: ["choose"],
    controlText: "Secret giver? Tap the blob you want to gift while the lights are out. Got a gift? Tap whoever you think slipped it to you.",
    lengthHint: "~30s",
    minPlayers: 4,
    arena: "parlor",
    cull: "high",
    flavors: [
      "'Tis the season for paranoia and light treason.",
      "Someone left you a present. How thoughtful. How incriminating.",
      "In the dark, everyone's a suspect and nobody's a friend.",
    ],
  },
  prophunt: {
    id: "prophunt",
    name: "Prop Hunt",
    tagline: "Become the furniture. One blob has a sword and a quota.",
    icon: "🗡️",
    rules: "Everyone disguises as a random prop and blends into a room full of identical decoys. ONE Seeker stalks the room with a blade — but only a few swings before it dulls. Get skewered and you're boxed; hold perfectly still and you're just a barrel. (Moving makes you twitch — and twitching gets noticed.)",
    controls: ["move"],
    controlText: "Hiders: WASD / Arrows to creep — but HOLD STILL to blend in. Seeker: move + SPACE / click / SWING to slash the nearest object.",
    lengthHint: "~40s",
    minPlayers: 3,
    arena: "field",
    cull: "mid",
    flavors: [
      "Hide as a chair. Live as a chair. Possibly die as a chair.",
      "The Seeker gets a sword and a body count to hit. The rest of you get to be IKEA.",
      "If you can't beat the décor, become the décor.",
      "A blade, a quota, and a room full of suspiciously nervous furniture.",
    ],
  },
  chutesladders: {
    id: "chutesladders",
    name: "Chutes & Ladders",
    tagline: "Climb the ladders. Gamble the chutes. Beat the clock.",
    icon: "🪜",
    rules: "RACE up the board to the top (square 64) — that's SAFETY. Ladders auto-launch you upward. But land on a CHUTE and you must GAMBLE: pick LEFT or RIGHT. One side dumps you back to the START, the other drops you into the ABYSS and you're ELIMINATED. Each chute's sides never change — so watch who goes first and learn the safe path. Reach the top before the clock runs out, or you're culled.",
    controls: ["tap", "choose"],
    controlText: "SMASH to ROLL (or SPACE). 🪜 climb · at a CHUTE pick ◀ LEFT / RIGHT ▶ (A·D or ←·→) — one resets you, one ends you. Reach 🏁 before the clock!",
    lengthHint: "~30s",
    minPlayers: 2,
    arena: "board",
    cull: "high",
    flavors: [
      "A children's board game, now with a body count. Roll well, choose wisely, or roll over.",
      "Every chute is a coin-flip with your life. Lucky for you, the coin remembers — watch who falls first.",
      "The ladders giveth. The chutes ask you to pick your own doom. The clock just laughs.",
      "Left or right? One way home, one way to the abyss. Choose — the dice won't help you now.",
    ],
  },
  simonsays: {
    id: "simonsays",
    name: "Simon Says",
    tagline: "Do exactly as you're told. Fumble, freeze up, or twitch — and you're done.",
    icon: "🙆",
    rules: "The Game Master barks an order — do the matching move before the timer runs out. 🙌 head · 👃 nose · 👀 blink · 🤸 flip · ⬆️ jump. On 🧊 FREEZE, touch NOTHING. Wrong move, too slow, or one nervous twitch on freeze: eliminated.",
    controls: ["choose"],
    controlText: "W pat head · A touch nose · S blink · D flip · SPACE jump — and FREEZE means hands OFF.",
    lengthHint: "~30s",
    minPlayers: 1,
    arena: "parlor",
    cull: "mid",
    finaleCapable: true, // last one to obey perfectly
    flavors: [
      "Simon says obey. Simon does not say there's a refund.",
      "Listen carefully. Your reflexes are now a survival skill.",
      "One wrong twitch and you're beautifully gift-wrapped.",
    ],
  },
  keepyuppy: {
    id: "keepyuppy",
    name: "Keepy Uppy",
    tagline: "Keep your balloon off the floor. Pop everyone else's. Teamwork!™",
    icon: "🎈",
    rules: "You're issued one balloon in your colors. Don't let it touch the floor and don't let it get popped — either one and you're done. Bump it to bat it back up; tap SPIKE to jab a rival's balloon and burst it. The air keeps getting heavier.",
    controls: ["move", "tap"],
    controlText: "WASD / Arrows or drag to move under your balloon (you auto-bat it up). SPACE / SPIKE to pop a rival's.",
    lengthHint: "~40s",
    minPlayers: 2,
    arena: "field",
    cull: "mid",
    finaleCapable: true, // last balloon still airborne
    flavors: [
      "One balloon each. 'Keep it up as a group,' they said. Then they handed out pins.",
      "It's a children's party game. The children are gone. The pins remain.",
      "Float it, defend it, and burst your neighbor's. Latex is a finite resource.",
    ],
  },
  koth: {
    id: "koth",
    name: "King of the Lava Islands",
    tagline: "The floor is lava. The islands are sinking. The crown is petty.",
    icon: "🌋",
    rules: "THE FINALE. The floor is lava and the islands sink into it one by one. Hop between them to stay off the floor, grab powerups, and shove rivals into the magma. The islands run out — last blob not-on-fire is CHAMPION.",
    controls: ["move", "aim"],
    controlText: "Move with WASD / Arrows or drag to hop between the sinking islands. Aim with the mouse, then CLICK / SPACE to SHOVE a rival off into the lava.",
    lengthHint: "~1 min",
    // The series culls down to a 1v1 for the finale, so it must run with 2.
    minPlayers: 2,
    arena: "field",
    cull: "high",
    finale: true,
    flavors: [
      "All thrones are temporary. These ones are also sinking.",
      "The floor is lava. The islands have read the room and are leaving.",
      "So many islands. So little square footage. So briefly.",
    ],
  },
};

export const ALL_GAME_IDS = Object.keys(GAMES) as GameId[];

export function gameMeta(id: GameId): GameMeta {
  return GAMES[id];
}
