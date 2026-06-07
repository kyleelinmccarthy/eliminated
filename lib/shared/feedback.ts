// Player feedback: shapes + a pure validator shared by the client form and the
// /api/feedback route, so both agree on what's acceptable before anything is
// stored or emailed. No I/O here — just validation and normalization.

export const FEEDBACK_CATEGORIES = ["bug", "idea", "praise", "other"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: "🐞 Something's broken",
  idea: "💡 Idea / request",
  praise: "💖 Praise",
  other: "💬 Something else",
};

export const FEEDBACK_LIMITS = {
  messageMin: 3,
  messageMax: 4000,
  email: 200,
  context: 600,
};

export interface FeedbackInput {
  message?: unknown;
  email?: unknown;
  category?: unknown;
  context?: unknown; // free-form client-built context (page / game / clientId / UA)
}

export interface FeedbackRecord {
  message: string;
  email: string | null;
  category: FeedbackCategory;
  context: string | null;
}

export interface FeedbackValidation {
  ok: boolean;
  error?: string;
  value?: FeedbackRecord;
}

// Deliberately lenient — we want a real local-part@domain.tld, but not a regex
// that rejects valid addresses. Empty email is fine (anonymous feedback).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateFeedback(input: FeedbackInput): FeedbackValidation {
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (message.length < FEEDBACK_LIMITS.messageMin) {
    return { ok: false, error: "Tell us a little more — what happened or what would you change?" };
  }
  if (message.length > FEEDBACK_LIMITS.messageMax) {
    return { ok: false, error: "That's a whole novel. Please keep it under 4000 characters." };
  }

  let email: string | null = null;
  if (typeof input.email === "string" && input.email.trim()) {
    const e = input.email.trim();
    if (e.length > FEEDBACK_LIMITS.email || !EMAIL_RE.test(e)) {
      return { ok: false, error: "That email doesn't look right. Fix it, or leave it blank to stay anonymous." };
    }
    email = e;
  }

  const category: FeedbackCategory = FEEDBACK_CATEGORIES.includes(input.category as FeedbackCategory)
    ? (input.category as FeedbackCategory)
    : "other";

  let context: string | null = null;
  if (typeof input.context === "string" && input.context.trim()) {
    context = input.context.trim().slice(0, FEEDBACK_LIMITS.context);
  }

  return { ok: true, value: { message, email, category, context } };
}
