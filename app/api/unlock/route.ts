import { NextResponse } from "next/server";
import { unlockCosmetic, profileKey } from "@/lib/server/db";
import { cosmeticCost } from "@/lib/shared/accessories";
import { auth } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // `characterId` is the cosmetic id — kept named for backwards compatibility,
    // but it now accepts any buyable id (character OR accessory).
    const { clientId, characterId } = body as { clientId: string; characterId: string };
    if (!clientId || !characterId) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    // Price is resolved SERVER-SIDE from the catalogs — the client never gets to
    // name its own price.
    const cost = cosmeticCost(characterId);
    if (!cost) return NextResponse.json({ error: "Nothing to buy — that's free or unknown." }, { status: 400 });
    // Spend from the account when signed in (verified server-side), else the guest.
    const session = await auth.api.getSession({ headers: req.headers });
    const key = profileKey(session?.user?.id ?? null, clientId);
    const result = await unlockCosmetic(key, characterId, cost);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
