// Simon Says command catalog — the single source of truth shared by the server
// (which judges who obeyed), the client controls (key → wire value), and the
// renderer (banner labels / emoji). Keep `key` values STABLE: they're the exact
// strings sent over the wire as { kind: "choose", value: <key> }.

export interface SimonCommand {
  key: string; // wire/input value
  hotkey: string; // physical keyboard key, lowercased (" " for space)
  keyLabel: string; // pretty key cap shown on the button ("W", "SPACE")
  label: string; // imperative shown on the big banner ("Pat your head")
  short: string; // tiny button caption
  emoji: string;
}

// The five "do something" orders. Order here is also the on-screen button order.
export const SIMON_COMMANDS: SimonCommand[] = [
  { key: "head", hotkey: "w", keyLabel: "W", label: "Pat your head", short: "Pat head", emoji: "🙌" },
  { key: "nose", hotkey: "a", keyLabel: "A", label: "Touch your nose", short: "Touch nose", emoji: "👃" },
  { key: "blink", hotkey: "s", keyLabel: "S", label: "Blink your eyes!", short: "Blink", emoji: "👀" },
  { key: "flip", hotkey: "d", keyLabel: "D", label: "Do a flip!", short: "Flip", emoji: "🤸" },
  { key: "jump", hotkey: " ", keyLabel: "SPACE", label: "Jump!", short: "Jump", emoji: "⬆️" },
];

// The trap order: the correct response is to touch NOTHING. Any input is fatal.
export const SIMON_FREEZE = {
  key: "freeze",
  label: "FREEZE — don't move a muscle!",
  short: "Freeze",
  emoji: "🧊",
};

export const SIMON_KEYS = SIMON_COMMANDS.map((c) => c.key);

export function simonByKey(key: string): SimonCommand | undefined {
  return SIMON_COMMANDS.find((c) => c.key === key);
}

export function simonByHotkey(hotkey: string): SimonCommand | undefined {
  return SIMON_COMMANDS.find((c) => c.hotkey === hotkey);
}

// Look up the display emoji for whatever a contestant did this beat (a command
// key, or null for "held still").
export function simonEmoji(key: string | null | undefined): string {
  if (!key) return SIMON_FREEZE.emoji;
  return simonByKey(key)?.emoji ?? "❓";
}
