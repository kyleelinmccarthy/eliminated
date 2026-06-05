// The roster of silly blob characters (food, critters, wanderers). Drawn procedurally on
// a canvas (no image assets), so each character is pure data: colors + a `deco`
// kind the renderer special-cases for the topping, plus a face style.

export type Deco =
  | "leaf" // avocado / tomato stem
  | "stem" // eggplant
  | "seeds" // strawberry
  | "crown" // pineapple
  | "bush" // broccoli
  | "yolk" // egg cheeks
  | "sprinkles" // donut
  | "bumps" // pickle
  | "spots" // mushroom
  | "nori" // sushi / onigiri
  | "peel" // banana
  | "rind" // watermelon
  | "wizard" // pointy starred hat (+ beard)
  | "hood" // rogue's cowl
  | "none";

// Critter facial features layered onto the blob so the animals read as more
// than recolored food. Drawn behind the body (ears) and on the face (snout).
export type Ears = "round" | "pointy" | "long";
export type Snout = "round" | "long" | "cat";

// Body silhouette. The renderer traces a different outline per shape so a
// banana isn't just a yellow circle — each shape carries its own face/feet/
// topping anchors so everything still lines up.
export type BodyShape =
  | "round" // default squishy circle
  | "egg" // ovoid, narrow top
  | "pear" // avocado: small top lobe, fat bottom
  | "berry" // strawberry: wide shoulders, pointed bottom
  | "bulb" // eggplant: bulbous body + neck
  | "tall" // pickle / pineapple: standing capsule
  | "cone" // carrot / pepper: wide top, point down
  | "banana" // crescent
  | "triangle" // onigiri rice ball
  | "mushroom"; // domed cap + stem

export interface Character {
  id: string;
  name: string;
  body: string; // main body color
  body2: string; // shade
  accent: string; // deco / topping color
  blush: string;
  deco: Deco;
  eyes: "dot" | "big" | "sleepy" | "wide" | "star" | "frog";
  shape?: BodyShape; // body silhouette (defaults to "round")
  ears?: Ears; // ear shape (animals only)
  earInner?: string; // inner-ear color (defaults to blush)
  snout?: Snout; // muzzle style
  snoutColor?: string; // muzzle fill (defaults to a lighter body shade)
  unlock?: number; // marbles required (undefined = free)
  catchphrase: string;
}

export const CHARACTERS: Character[] = [
  // ---- New blobs: critters & wanderers (ears, snouts, headgear), shown first ----
  {
    id: "koala",
    name: "Koalamity",
    body: "#9aa7b0",
    body2: "#6f7d87",
    accent: "#cfd8dc",
    blush: "#f4a9c0",
    deco: "none",
    eyes: "big",
    ears: "round",
    earInner: "#c98aa7",
    snout: "round",
    snoutColor: "#828f98",
    catchphrase: "Leaf me alone.",
  },
  {
    id: "aardvark",
    name: "Aard to Kill",
    body: "#c9a079",
    body2: "#a3764f",
    accent: "#8d6e63",
    blush: "#e3b79a",
    deco: "none",
    eyes: "sleepy",
    ears: "long",
    earInner: "#d8b79c",
    snout: "long",
    snoutColor: "#bb9472",
    catchphrase: "First in the dictionary.",
  },
  {
    id: "panther",
    name: "Purrgatory",
    body: "#37333f",
    body2: "#211e29",
    accent: "#ffd54f",
    blush: "#534b60",
    deco: "none",
    eyes: "wide",
    ears: "pointy",
    earInner: "#6b5a7a",
    snout: "cat",
    snoutColor: "#2a2733",
    catchphrase: "Stay in the shadows.",
  },
  {
    id: "fox",
    name: "Foxic",
    body: "#fb8c42",
    body2: "#e8631d",
    accent: "#fff3e0",
    blush: "#ffc299",
    deco: "none",
    eyes: "big",
    ears: "pointy",
    earInner: "#3a2b25",
    snout: "long",
    snoutColor: "#fff3e0",
    catchphrase: "What does it say?",
  },
  {
    id: "capybara",
    name: "Capybarely",
    body: "#a3764f",
    body2: "#7c5836",
    accent: "#5b3f28",
    blush: "#c79a72",
    deco: "none",
    eyes: "sleepy",
    ears: "round",
    earInner: "#5b3f28",
    snout: "round",
    snoutColor: "#8c6342",
    catchphrase: "Unbothered. Moisturized.",
  },
  {
    id: "wizard",
    name: "Hocus Croakus",
    body: "#62b13a",
    body2: "#3f7d24",
    accent: "#ffd54f",
    blush: "#9ccc65",
    deco: "wizard",
    eyes: "frog",
    catchphrase: "Abraca-ribbit.",
  },
  {
    id: "rogue",
    name: "Hood Riddance",
    body: "#bcc4c2",
    body2: "#8a93a3",
    accent: "#242b33",
    blush: "#9aa39f",
    deco: "hood",
    eyes: "wide",
    catchphrase: "Pick a card. Or a pocket.",
  },
  {
    id: "bunny",
    name: "Hare Trigger",
    body: "#f3eef0",
    body2: "#d6c9d0",
    accent: "#f4a9c0",
    blush: "#f6b8cc",
    deco: "none",
    eyes: "big",
    ears: "long",
    earInner: "#f4a9c0",
    snout: "round",
    snoutColor: "#e9dde3",
    catchphrase: "Hare today, gone tomorrow.",
  },
  {
    id: "pig",
    name: "Boar-ed to Death",
    body: "#f7a8c0",
    body2: "#e07a9c",
    accent: "#c75f80",
    blush: "#ffc2d6",
    deco: "none",
    eyes: "big",
    ears: "round",
    earInner: "#e07a9c",
    snout: "round",
    snoutColor: "#f08fb0",
    catchphrase: "Dying of boredom. And other things.",
  },
  {
    id: "cat",
    name: "Meowderer",
    body: "#90a4ae",
    body2: "#607d8b",
    accent: "#cfd8dc",
    blush: "#b0bec5",
    deco: "none",
    eyes: "wide",
    ears: "pointy",
    earInner: "#cfd8dc",
    snout: "cat",
    snoutColor: "#b0bec5",
    catchphrase: "Curiosity killed them. I finished the job.",
  },
  {
    id: "mouse",
    name: "Plague Rat",
    body: "#b9b2c4",
    body2: "#948ca6",
    accent: "#d8b7c4",
    blush: "#e7c4d2",
    deco: "none",
    eyes: "big",
    ears: "round",
    earInner: "#e7c4d2",
    snout: "long",
    snoutColor: "#aaa2b8",
    catchphrase: "Spreading good vibes and bubonic plague.",
  },
  {
    id: "hamster",
    name: "Hamstrung",
    body: "#f0c08a",
    body2: "#d69b5e",
    accent: "#8d6e63",
    blush: "#ffd9a8",
    deco: "none",
    eyes: "big",
    ears: "round",
    earInner: "#e7b07a",
    snout: "round",
    snoutColor: "#f7d3a0",
    catchphrase: "Stuffing my cheeks for the apocalypse.",
  },
  {
    id: "ghost",
    name: "Ghosted",
    body: "#e9edf2",
    body2: "#c3cbd6",
    accent: "#b0bec5",
    blush: "#d6c8e0",
    deco: "none",
    eyes: "wide",
    catchphrase: "I'll just see myself out.",
  },
  {
    id: "slime",
    name: "Slime Crime",
    body: "#4dd0e1",
    body2: "#00acc1",
    accent: "#80deea",
    blush: "#b2ebf2",
    deco: "none",
    eyes: "big",
    catchphrase: "Spineless and proud of it.",
  },

  // ---- Original food blobs ----
  {
    id: "avo",
    name: "Avocadon't",
    body: "#7cb342",
    body2: "#558b2f",
    accent: "#5d4037",
    blush: "#c5e1a5",
    deco: "leaf",
    eyes: "big",
    shape: "pear",
    catchphrase: "Guac and roll!",
  },
  {
    id: "egg",
    name: "Sir Eggbert",
    body: "#fffdf5",
    body2: "#ffe0a3",
    accent: "#ffb300",
    blush: "#ffd5b8",
    deco: "yolk",
    eyes: "wide",
    shape: "egg",
    catchphrase: "Don't get scrambled.",
  },
  {
    id: "berry",
    name: "Strawbarbara",
    body: "#ef5350",
    body2: "#c62828",
    accent: "#fff176",
    blush: "#ff8a80",
    deco: "seeds",
    eyes: "big",
    shape: "berry",
    catchphrase: "Berry dangerous.",
  },
  {
    id: "egg2",
    name: "Sir Nightshade",
    body: "#7b3f9e",
    body2: "#4a148c",
    accent: "#66bb6a",
    blush: "#ce93d8",
    deco: "stem",
    eyes: "sleepy",
    shape: "bulb",
    catchphrase: "Thank you, very mush.",
  },
  {
    id: "brocc",
    name: "Grim Floret",
    body: "#9ccc65",
    body2: "#689f38",
    accent: "#33691e",
    blush: "#c5e1a5",
    deco: "bush",
    eyes: "dot",
    catchphrase: "Eat your greens... or else.",
  },
  {
    id: "donut",
    name: "Detective Donut",
    body: "#ffcc80",
    body2: "#e0a050",
    accent: "#f06292",
    blush: "#ffab91",
    deco: "sprinkles",
    eyes: "big",
    catchphrase: "I'm on a roll.",
  },
  {
    id: "pickle",
    name: "Dill With It",
    body: "#7cb342",
    body2: "#33691e",
    accent: "#aed581",
    blush: "#c5e1a5",
    deco: "bumps",
    eyes: "wide",
    shape: "tall",
    catchphrase: "Kind of a big dill.",
  },
  {
    id: "tomato",
    name: "Tomato Tony",
    body: "#e53935",
    body2: "#b71c1c",
    accent: "#43a047",
    blush: "#ff8a80",
    deco: "leaf",
    eyes: "dot",
    catchphrase: "You say tomato...",
  },
  {
    id: "pine",
    name: "Princess Pineapple",
    body: "#ffd54f",
    body2: "#fbc02d",
    accent: "#66bb6a",
    blush: "#ffe082",
    deco: "crown",
    eyes: "star",
    shape: "tall",
    catchphrase: "Stay sharp.",
  },
  {
    id: "shroom",
    name: "Deathcap Dan",
    body: "#ef5350",
    body2: "#c62828",
    accent: "#fff8e1",
    blush: "#ffcdd2",
    deco: "spots",
    eyes: "sleepy",
    shape: "mushroom",
    catchphrase: "There's fungi among us.",
  },
  {
    id: "sushi",
    name: "Raw Deal",
    body: "#fff8e1",
    body2: "#ffe0b2",
    accent: "#ff7043",
    blush: "#ffccbc",
    deco: "nori",
    eyes: "wide",
    shape: "egg",
    catchphrase: "Roll with it.",
  },
  {
    id: "nana",
    name: "Banana Joe",
    body: "#ffee58",
    body2: "#fdd835",
    accent: "#8d6e63",
    blush: "#fff59d",
    deco: "peel",
    eyes: "big",
    shape: "banana",
    catchphrase: "This is bananas!",
  },
  {
    id: "plum",
    name: "Sour Grapes",
    body: "#9575cd",
    body2: "#6a4ca3",
    accent: "#5d4037",
    blush: "#c8b0e6",
    deco: "leaf",
    eyes: "sleepy",
    catchphrase: "Sour grapes? Always.",
  },
  {
    id: "orange",
    name: "Pulp Friction",
    body: "#ffa726",
    body2: "#fb8c00",
    accent: "#5d4037",
    blush: "#ffcc80",
    deco: "leaf",
    eyes: "big",
    catchphrase: "Concentrate, or get squeezed.",
  },

  // ---- Unlockables (bought with Marbles), cheapest first ----
  {
    id: "blueberry",
    name: "Bruiseberry",
    body: "#5c6bc0",
    body2: "#3949ab",
    accent: "#4f9b3a",
    blush: "#9fa8da",
    deco: "stem",
    eyes: "big",
    unlock: 200,
    catchphrase: "This is gonna leave a mark.",
  },
  {
    id: "carrot",
    name: "Root of Evil",
    body: "#ff9800",
    body2: "#ef6c00",
    accent: "#66bb6a",
    blush: "#ffcc80",
    deco: "bush",
    eyes: "wide",
    shape: "cone",
    unlock: 250,
    catchphrase: "What's up, doc?",
  },
  {
    id: "dragonfruit",
    name: "Dragon Fruit Punch",
    body: "#e91e63",
    body2: "#ad1457",
    accent: "#1b1b1b",
    blush: "#f48fb1",
    deco: "seeds",
    eyes: "wide",
    unlock: 450,
    catchphrase: "Scaly outside. Mush inside. Relatable.",
  },
  {
    id: "melon",
    name: "Watermelon Wanda",
    body: "#66bb6a",
    body2: "#388e3c",
    accent: "#ef5350",
    blush: "#a5d6a7",
    deco: "rind",
    eyes: "star",
    unlock: 500,
    catchphrase: "One in a melon.",
  },
  {
    id: "goldegg",
    name: "Yolk's On You",
    body: "#ffe082",
    body2: "#ffb300",
    accent: "#ff8f00",
    blush: "#ffe9b0",
    deco: "yolk",
    eyes: "star",
    shape: "egg",
    unlock: 800,
    catchphrase: "Officially worth more than you.",
  },
  {
    id: "onigiri",
    name: "Rigor Rice",
    body: "#fafafa",
    body2: "#e0e0e0",
    accent: "#37474f",
    blush: "#ffcdd2",
    deco: "nori",
    eyes: "wide",
    shape: "triangle",
    unlock: 1000,
    catchphrase: "Rice to meet you.",
  },
  {
    id: "ninja",
    name: "Backstabber",
    body: "#2f3640",
    body2: "#1e2228",
    accent: "#16181d",
    blush: "#3a4049",
    deco: "hood",
    eyes: "wide",
    unlock: 1200,
    catchphrase: "It's not personal. It's strategy.",
  },
  {
    id: "sorcerer",
    name: "Hexecutioner",
    body: "#5e35b1",
    body2: "#4527a0",
    accent: "#ffca28",
    blush: "#b39ddb",
    deco: "wizard",
    eyes: "star",
    unlock: 1600,
    catchphrase: "Abracadav-bye.",
  },
  {
    id: "ghostpepper",
    name: "Reaper Pepper",
    body: "#ff5252",
    body2: "#d50000",
    accent: "#212121",
    blush: "#ff1744",
    deco: "stem",
    eyes: "star",
    shape: "cone",
    unlock: 2000,
    catchphrase: "Too hot to handle.",
  },
  {
    id: "cosmic",
    name: "Black Hole",
    body: "#5c2a9d",
    body2: "#311b66",
    accent: "#ce93d8",
    blush: "#b388ff",
    deco: "none",
    eyes: "star",
    unlock: 3000,
    catchphrase: "Everything goes in. Nothing comes out.",
  },
];

export const FREE_CHARACTERS = CHARACTERS.filter((c) => !c.unlock).map((c) => c.id);

export function getCharacter(id: string): Character {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

export function randomCharacterId(): string {
  return FREE_CHARACTERS[Math.floor(Math.random() * FREE_CHARACTERS.length)];
}
