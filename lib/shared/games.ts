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
  minPlayers: number;
  arena: "field" | "bridge" | "rope" | "board" | "duel" | "parlor"; // renderer family
  flavors: string[]; // game-master quips chosen at random
  // How many players this game tends to eliminate. The Game Master avoids
  // "high" games as the very first round so a series doesn't open brutally.
  cull?: "low" | "mid" | "high";
  // Finale games are never picked at random — they're forced as the LAST round.
  finale?: boolean;
}

export const GAMES: Record<GameId, GameMeta> = {
  redlight: {
    id: "redlight",
    name: "Red Light, Green Light",
    tagline: "Move on green. Freeze on red. The Doll does not do warnings.",
    icon: "🚦",
    rules: "Reach the finish line. While the Doll watches (RED), any movement is fatal. Move only on GREEN. She does not accept appeals.",
    controls: ["move"],
    controlText: "WASD / Arrows or drag to move. STOP the instant it turns red.",
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
    tagline: "Freeze your enemies. Thaw your friends. Sob at the buzzer.",
    icon: "❄️",
    rules: "Two teams. Touch an ENEMY to freeze them solid; touch a frozen TEAMMATE to thaw them. In the final DEEP FREEZE, thawing stops — anyone frozen at the buzzer is ELIMINATED.",
    controls: ["move", "team"],
    controlText: "Move with WASD / Arrows or drag. Bump enemies to freeze, bump frozen friends to thaw.",
    minPlayers: 3,
    arena: "field",
    cull: "low",
    flavors: [
      "Cold hands, colder severance package.",
      "Friendship is temporary. Frostbite is forever.",
      "Thaw your friends. Or don't. The buzzer isn't picky.",
    ],
  },
  mingle: {
    id: "mingle",
    name: "Mingle",
    tagline: "Form a group of exactly the right size. Make friends or make peace with it.",
    icon: "🫂",
    rules: "When a number is called, cram into a room with EXACTLY that many blobs. Wrong-sized groups are eliminated. It's networking, but lethal.",
    controls: ["move"],
    controlText: "Move with WASD / Arrows or drag. Crowd into a room with the right count.",
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
    rules: "Cross the bridge one row at a time. Each row has two tiles — one holds, one SHATTERS. Choose before the timer hits zero. Choose wrong and learn to fly.",
    controls: ["choose"],
    controlText: "Click / press ← or → to pick the LEFT or RIGHT tile.",
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
    rules: "Face an opponent. Pick TWO throws, then DROP one. Standard rock-paper-scissors — losers are eliminated, ties replay.",
    controls: ["choose", "duel"] as any,
    controlText: "Click two throws, then click the one to KEEP.",
    minPlayers: 2,
    arena: "duel",
    cull: "high",
    flavors: [
      "Mind games. The loser forfeits a hand and the rest of them.",
      "Rock, paper, scissors, minus one, plus consequences.",
      "Two throws, one choice, no refunds.",
    ],
  },
  jumprope: {
    id: "jumprope",
    name: "Killer Jump Rope",
    tagline: "Jump in rhythm. The rope is patient. You are not.",
    icon: "🤸",
    rules: "A giant rope sweeps the floor. JUMP at the right moment. Mistime it and you're swept away. It only gets faster. It never gets kinder.",
    controls: ["tap"],
    controlText: "Press SPACE / click / tap to JUMP as the rope passes.",
    minPlayers: 1,
    arena: "rope",
    cull: "mid",
    flavors: [
      "Skip, skip, skip… faceplant.",
      "The rope never gets tired. It also never gets a raise. Relatable.",
      "Light on your feet, or laid out flat.",
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
    minPlayers: 2,
    arena: "field",
    cull: "high",
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
    controlText: "Move with WASD / Arrows or drag. When the music stops, sprint to a chair!",
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
    tagline: "A gift in the dark. Guess the giver, or pay for the gesture.",
    icon: "🎁",
    rules: "The lights go out and gifts are slipped between blobs. If you RECEIVED one, guess who gave it: guess right and the giver is caught & OUT; guess wrong and YOU'RE out. Sneaky givers, stay hidden.",
    controls: ["choose"],
    controlText: "Tap the blob you think slipped you the gift.",
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
    tagline: "Climb the ladders. Dread the snakes. Pray to the dice.",
    icon: "🪜",
    rules: "Roll your way up to square 100. Ladders launch you up; snakes drag you down. It's pure dumb luck — and when the clock runs out, whoever's lowest on the board gets swallowed. Keep rolling. Climb fast.",
    controls: ["tap"],
    controlText: "SMASH the button (or tap SPACE) to ROLL the die. Keep rolling — the stragglers get eaten.",
    minPlayers: 2,
    arena: "board",
    cull: "mid",
    flavors: [
      "A children's board game, now with a body count. Roll well or roll over.",
      "No skill. No strategy. Just dice and the slow creep of doom. Good luck — we mean that literally.",
      "The ladders giveth. The snakes taketh away. The clock just laughs.",
      "Whoever said it's not whether you win or lose clearly never played THIS version.",
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
    minPlayers: 1,
    arena: "parlor",
    cull: "mid",
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
    minPlayers: 2,
    arena: "field",
    cull: "mid",
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
    controls: ["move"],
    controlText: "Move with WASD / Arrows or drag. Hop between the sinking islands — and bump rivals into the lava!",
    minPlayers: 3,
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
