// Better Auth's catch-all handler — serves /api/auth/* (sign-in, sign-up,
// callbacks, session, etc.). Must run on the Node runtime (libSQL + crypto).
import { auth } from "@/lib/server/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const runtime = "nodejs";
export const { GET, POST } = toNextJsHandler(auth);
