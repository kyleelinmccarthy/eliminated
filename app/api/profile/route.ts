import { NextResponse } from "next/server";
import { getOrCreateProfile, profileKey } from "@/lib/server/db";
import { auth } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");
  const name = url.searchParams.get("name") || "Blob";
  if (!clientId) return NextResponse.json({ error: "Missing clientId" }, { status: 400 });
  try {
    // Signed-in players get their account profile regardless of the query param.
    const session = await auth.api.getSession({ headers: req.headers });
    const key = profileKey(session?.user?.id ?? null, clientId);
    const profile = await getOrCreateProfile(key, name);
    return NextResponse.json(profile);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
