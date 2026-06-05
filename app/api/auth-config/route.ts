// Tiny public capability probe so the client can hide "Continue with Google"
// when no Google OAuth credentials are configured (rather than offer a dead end).
import { NextResponse } from "next/server";
import { authCapabilities } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(authCapabilities);
}
