"use client";
// One place to buy anything from the shops — characters OR accessories. Both
// pickers call this so the purchase flow (price check, POST, profile refresh,
// toast on failure) lives once. The server re-prices server-side; we just relay.
import { useGame } from "./net";
import { audio } from "./audio";
import { cosmeticCost } from "@/lib/shared/accessories";

// Attempts to buy a cosmetic. Returns true if it's now owned (or already was).
// On failure it surfaces the server's reason as a toast and returns false.
export async function buyCosmetic(id: string): Promise<boolean> {
  const cost = cosmeticCost(id);
  if (!cost) return false; // free or unknown — nothing to buy
  const clientId = useGame.getState().clientId;
  try {
    const res = await fetch("/api/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // `characterId` is the legacy field name for "the cosmetic id"; the server
      // accepts any buyable id and prices it itself.
      body: JSON.stringify({ clientId, characterId: id }),
    });
    const data = await res.json();
    if (data?.error) {
      audio.sfx("bad");
      const s = useGame.getState();
      s.set({ toasts: [...s.toasts, { id: Date.now(), text: data.error, kind: "bad" }] });
      return false;
    }
    audio.sfx("win");
    useGame.setState({ profile: data });
    return true;
  } catch {
    return false;
  }
}
