import { NextResponse, type NextRequest } from "next/server";

// Canonical-host redirect: send the bare apex (eliminatedgame.com) to www.
//
// Google OAuth's authorized redirect URI and the Better Auth cookie are pinned to
// the www host. On the apex domain the cookie/redirect host doesn't match, so
// "Continue with Google" silently fails AND the WebSocket upgrade can't read the
// session — a signed-in player then shows up as a fresh guest with 0 marbles even
// though their account row (visible on the leaderboard) holds their real total.
// Forcing one canonical origin fixes both the broken Google sign-in and the
// "leaderboard says 175, homepage says 0" mismatch.
export function middleware(req: NextRequest) {
  const host = req.headers.get("host") || "";
  // Match the apex with or without a port; never touch www, previews, or Railway hosts.
  if (host === "eliminatedgame.com" || host === "eliminatedgame.com:443") {
    const url = req.nextUrl.clone();
    url.protocol = "https:";
    url.host = "www.eliminatedgame.com";
    url.port = "";
    return NextResponse.redirect(url, 308);
  }
  return NextResponse.next();
}

export const config = {
  // Run on real pages and API/auth routes, but skip Next internals and static
  // assets (the WebSocket upgrade never goes through middleware anyway).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
