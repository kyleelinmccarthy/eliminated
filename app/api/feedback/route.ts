// Player feedback intake. Validates, stores it in the DB, and (best-effort)
// emails it to the team inbox so nothing is lost if one path fails. The signed-in
// account (if any) is taken from the VERIFIED session, never the body.
import { NextResponse } from "next/server";
import { validateFeedback } from "@/lib/shared/feedback";
import { saveFeedback } from "@/lib/server/db";
import { sendEmail } from "@/lib/server/email";
import { auth } from "@/lib/server/auth";
import { CONTACT_EMAIL, SITE_NAME } from "@/lib/shared/legal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Light per-IP rate limit: a feedback form shouldn't be a spam cannon. In-memory
// is fine — abuse from one box gets throttled; a restart resetting it is harmless.
const hits = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 6;
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Whoa — that's a lot of feedback. Give it a few minutes." }, { status: 429 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const v = validateFeedback(body || {});
  if (!v.ok || !v.value) {
    return NextResponse.json({ error: v.error || "Invalid feedback." }, { status: 400 });
  }
  const { message, email, category, context } = v.value;

  const clientId: string | null = typeof body.clientId === "string" ? body.clientId.slice(0, 64) : null;
  let account = "(guest)";
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (session?.user) account = `${session.user.name || "user"} <${session.user.email}>`;
  } catch {
    /* session lookup is best-effort context only */
  }

  const createdAt = new Date().toISOString();

  // Persist first so feedback survives even if email is down.
  let stored = true;
  try {
    await saveFeedback({ message, email, category, context, clientId, createdAt });
  } catch (e) {
    stored = false;
    console.warn("[feedback] save failed:", (e as Error).message);
  }

  // Best-effort notification email (sendEmail never throws; it logs + degrades).
  const subject = `[${SITE_NAME} · ${category}] ${message.slice(0, 64)}`;
  await sendEmail({
    to: CONTACT_EMAIL,
    subject,
    replyTo: email || undefined,
    html: `<h2>New ${escapeHtml(category)} feedback</h2>
      <p style="white-space:pre-wrap;font-size:15px">${escapeHtml(message)}</p>
      <hr/>
      <p><b>From:</b> ${email ? escapeHtml(email) : "(anonymous)"} &middot; <b>account:</b> ${escapeHtml(account)}</p>
      <p><b>clientId:</b> ${escapeHtml(clientId || "—")}</p>
      <p><b>context:</b> ${context ? escapeHtml(context) : "—"}</p>
      <p><b>at:</b> ${createdAt}${stored ? "" : " &middot; ⚠️ DB save failed (email only)"}</p>`,
    text:
      `${category}: ${message}\n\n` +
      `from: ${email || "(anonymous)"} / ${account}\n` +
      `clientId: ${clientId || "-"}\ncontext: ${context || "-"}\nat: ${createdAt}` +
      (stored ? "" : "\n⚠️ DB save failed (email only)"),
  });

  // If neither store nor email got it out, surface a soft error so the client can
  // suggest mailing us directly. (When email is just console-logged in dev,
  // `stored` is true and we still report success.)
  if (!stored) {
    return NextResponse.json(
      { ok: false, error: "Couldn't record that just now. Mind emailing us instead?" },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true });
}
