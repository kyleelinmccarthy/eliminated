// Transactional email via Resend — the single sender shared by auth flows
// (lib/server/auth.ts) and anything else that needs to send mail. Degrades
// gracefully: with no RESEND_API_KEY set, it logs the email to the console
// instead of sending, so local dev and CI never need a real key or a verified
// domain.
//
// Env:
//   RESEND_API_KEY  - enables real sending; unset = console-log fallback
//   EMAIL_FROM      - verified Resend sender, e.g. "Eliminated <support@eliminatedgame.com>"
import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
const client = apiKey ? new Resend(apiKey) : null;

// Resend's sandbox sender works without a verified domain; override via EMAIL_FROM
// in production (e.g. a support@ on your verified domain).
const DEFAULT_FROM = process.env.EMAIL_FROM ?? "Eliminated <onboarding@resend.dev>";

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  /** HTML body. Required — every transactional email we send is HTML. */
  html: string;
  /** Optional plaintext alternative for clients that don't render HTML. */
  text?: string;
  /** Override the sender for this message; defaults to EMAIL_FROM. */
  from?: string;
  /** Where replies should go (e.g. route a user's "contact us" reply back to them). */
  replyTo?: string;
}

export interface SendEmailResult {
  ok: boolean;
  /** Resend message id, when sent. */
  id?: string;
  /** Error message, when the send failed. */
  error?: string;
  /** True when there was no API key, so the email was logged but not sent. */
  skipped?: boolean;
}

/** Whether real email sending is configured (an API key is present). */
export function emailEnabled(): boolean {
  return client !== null;
}

export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  const { to, subject, html, text, from = DEFAULT_FROM, replyTo } = opts;
  const recipients = Array.isArray(to) ? to.join(", ") : to;

  if (!client) {
    console.warn(`[email] RESEND_API_KEY unset — suppressed: "${subject}" → ${recipients}`);
    return { ok: false, skipped: true };
  }

  try {
    const { data, error } = await client.emails.send({
      from,
      to,
      subject,
      html,
      ...(text ? { text } : {}),
      ...(replyTo ? { replyTo } : {}),
    });
    if (error) {
      console.warn("[email] send failed:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id };
  } catch (e) {
    console.warn("[email] send threw:", (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }
}
