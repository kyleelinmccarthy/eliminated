"use client";
// Better Auth browser client. Same-origin, so baseURL is inferred. Used by the
// account UI for email/password + Google sign-in, sign-out, and session state.
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
