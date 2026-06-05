// Arena themes ("maps"). A minigame defines the layout; the map supplies the
// palette + decorative props so every round looks fresh. Drawn procedurally.

export interface GameMap {
  id: string;
  name: string;
  ground: string; // base floor color
  ground2: string; // checker / accent floor color
  wall: string; // arena border
  sky: string; // backdrop / vignette tint
  accent: string; // prop accent
  props: PropKind[]; // scattered decoration
  mood: "pastel" | "neon" | "spooky" | "candy" | "toxic" | "beach";
}

export type PropKind =
  | "sakura" // falling petals
  | "bubbles"
  | "ghosts"
  | "candy"
  | "goo"
  | "palms"
  | "stars"
  | "snow";

export const MAPS: GameMap[] = [
  {
    id: "courtyard",
    name: "Sakura Courtyard",
    ground: "#f7d9e3",
    ground2: "#f3c6d6",
    wall: "#c98aa6",
    sky: "#ffe9f1",
    accent: "#ff8fb3",
    props: ["sakura"],
    mood: "pastel",
  },
  {
    id: "neon",
    name: "Neon Sewer Disco",
    ground: "#1b1f3b",
    ground2: "#252a52",
    wall: "#00e5ff",
    sky: "#0a0c1f",
    accent: "#ff00e6",
    props: ["bubbles", "stars"],
    mood: "neon",
  },
  {
    id: "candy",
    name: "Candy Wasteland",
    ground: "#ffe0ec",
    ground2: "#ffd0e0",
    wall: "#c86fa0",
    sky: "#fff0f6",
    accent: "#7e57c2",
    props: ["candy"],
    mood: "candy",
  },
  {
    id: "toxic",
    name: "Toxic Lab",
    ground: "#dff5d0",
    ground2: "#cdebb6",
    wall: "#7cb342",
    sky: "#eaffd8",
    accent: "#aeea00",
    props: ["goo", "bubbles"],
    mood: "toxic",
  },
  {
    id: "beach",
    name: "Sunset Tide Pools",
    ground: "#ffe2bf",
    ground2: "#ffd0a0",
    wall: "#ef9a5a",
    sky: "#ffd9b0",
    accent: "#26c6da",
    props: ["palms", "bubbles"],
    mood: "beach",
  },
  {
    id: "haunt",
    name: "Haunted Playground",
    ground: "#2c2240",
    ground2: "#352a4d",
    wall: "#7e57c2",
    sky: "#160f26",
    accent: "#b388ff",
    props: ["ghosts", "stars"],
    mood: "spooky",
  },
];

export function getMap(id: string | null): GameMap {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}
