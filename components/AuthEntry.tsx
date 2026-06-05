"use client";
import dynamic from "next/dynamic";

// Client-only loader for the account UI. better-auth's useSession() isn't
// SSR-safe (it crashes resolving useRef during server render), so we defer it to
// the client wherever it's mounted — home topbar, leaderboard, in-game overlays.
// This centralizes the ssr:false wrapping so callers (including server
// components) can just drop in <AuthEntry variant="…" />.
const AccountButton = dynamic(() => import("./AccountButton").then((m) => m.AccountButton), {
  ssr: false,
});

export function AuthEntry(props: { variant?: "login" | "save"; label?: string }) {
  return <AccountButton {...props} />;
}
