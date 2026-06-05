// One-time fold of a guest's progress into the signed-in account. Called by the
// client right after the first sign-in/sign-up. The guest clientId comes from
// the body, but the account is taken from the VERIFIED session — never the body.
import { NextResponse } from "next/server";
import { auth } from "@/lib/server/auth";
import { mergeGuestIntoAccount } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  try {
    const { clientId } = (await req.json().catch(() => ({}))) as { clientId?: string };
    const profile = await mergeGuestIntoAccount(
      session.user.id,
      (clientId || "").slice(0, 64),
      session.user.name || session.user.email || "Blob",
    );
    return NextResponse.json(profile);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
