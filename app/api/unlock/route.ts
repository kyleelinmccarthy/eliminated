import { NextResponse } from "next/server";
import { unlockCharacter, profileKey } from "@/lib/server/db";
import { getCharacter } from "@/lib/shared/characters";
import { auth } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { clientId, characterId } = body as { clientId: string; characterId: string };
    if (!clientId || !characterId) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    // Spend from the account when signed in (verified server-side), else the guest.
    const session = await auth.api.getSession({ headers: req.headers });
    const key = profileKey(session?.user?.id ?? null, clientId);
    const ch = getCharacter(characterId);
    const cost = ch.unlock ?? 0;
    if (cost === 0) return NextResponse.json({ error: "Already free" }, { status: 400 });
    const result = await unlockCharacter(key, characterId, cost);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
