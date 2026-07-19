/**
 * User + guest identity resolution.
 * - Logged-in: session cookie → user_id
 * - Guest: stable UUID in httpOnly cookie (set by middleware)
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import {
  GUEST_COOKIE,
  SESSION_COOKIE,
  GUEST_ID_HEADER,
  GUEST_ID_RE,
  GUEST_MAX_AGE_SEC,
  SESSION_MAX_AGE_SEC,
} from "@/lib/auth-constants";
import {
  createSession,
  deleteSession,
  getSessionUser,
  createUser,
  getUserByEmail,
  getUserById,
  type AuthUser,
} from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth-password";
import { adminEmailsConfiguredCount } from "@/lib/admin-users";

export type { AuthUser };

export interface AuthContext {
  userId: string;
  kind: "user" | "guest";
  user: AuthUser | null;
}

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const parts = header.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k !== name) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function mintGuestId(): string {
  return `guest_${randomUUID().replace(/-/g, "")}`;
}

export function mintUserId(): string {
  return `user_${randomUUID().replace(/-/g, "")}`;
}

export function mintSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function isValidGuestId(id: string): boolean {
  return GUEST_ID_RE.test(id);
}

/** Cookie options for guest / session (Node + middleware). */
export function guestCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: GUEST_MAX_AGE_SEC,
    secure,
  };
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
    secure,
  };
}

function isSecureRequest(request: Request): boolean {
  const proto = request.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

/**
 * Resolve effective user id for data isolation.
 * Prefer logged-in session; else guest cookie / middleware header.
 */
export function resolveAuth(request: Request): AuthContext {
  const cookieHeader = request.headers.get("cookie");
  const sessionToken = parseCookie(cookieHeader, SESSION_COOKIE);
  if (sessionToken) {
    const user = getSessionUser(sessionToken);
    if (user) {
      return { userId: user.id, kind: "user", user };
    }
  }

  const fromHeader = request.headers.get(GUEST_ID_HEADER);
  const fromCookie = parseCookie(cookieHeader, GUEST_COOKIE);
  const guest =
    (fromHeader && isValidGuestId(fromHeader) && fromHeader) ||
    (fromCookie && isValidGuestId(fromCookie) && fromCookie) ||
    null;

  if (guest) {
    return { userId: guest, kind: "guest", user: null };
  }

  // Should be rare if middleware ran; ephemeral id (won't persist this response)
  return { userId: mintGuestId(), kind: "guest", user: null };
}

/** Drop-in replacement for previous getUserId(). */
export function getUserId(request: Request): string {
  return resolveAuth(request).userId;
}

export function registerUser(
  email: string,
  password: string,
  displayName?: string,
): { ok: true; user: AuthUser; sessionToken: string } | { ok: false; error: string } {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { ok: false, error: "邮箱格式不正确" };
  }
  if (password.length < 8) {
    return { ok: false, error: "密码至少 8 位" };
  }
  if (getUserByEmail(normalized)) {
    return { ok: false, error: "该邮箱已注册" };
  }
  const id = mintUserId();
  const user = createUser({
    id,
    email: normalized,
    passwordHash: hashPassword(password),
    displayName: (displayName || "").trim() || normalized.split("@")[0],
  });
  const sessionToken = mintSessionToken();
  createSession(sessionToken, user.id, SESSION_MAX_AGE_SEC);
  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
    },
    sessionToken,
  };
}

export function loginUser(
  email: string,
  password: string,
): { ok: true; user: AuthUser; sessionToken: string } | { ok: false; error: string } {
  const normalized = email.trim().toLowerCase();
  const row = getUserByEmail(normalized);
  if (!row || !verifyPassword(password, row.passwordHash)) {
    return { ok: false, error: "邮箱或密码错误" };
  }
  const sessionToken = mintSessionToken();
  createSession(sessionToken, row.id, SESSION_MAX_AGE_SEC);
  return {
    ok: true,
    user: {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      isAdmin: row.isAdmin,
    },
    sessionToken,
  };
}

export function logoutSession(request: Request): void {
  const token = parseCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (token) deleteSession(token);
}

export function attachSessionCookie(res: NextResponse, request: Request, sessionToken: string): void {
  res.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions(isSecureRequest(request)));
}

export function clearSessionCookie(res: NextResponse, request: Request): void {
  res.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(isSecureRequest(request)),
    maxAge: 0,
  });
}

export function publicUser(user: AuthUser | null, auth: AuthContext) {
  return {
    userId: auth.userId,
    kind: auth.kind,
    /** True when ADMIN_EMAILS / ADMIN_EMAIL is set on the server. */
    adminConfigured: adminEmailsConfiguredCount() > 0,
    user: user
      ? {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          isAdmin: !!user.isAdmin,
        }
      : null,
  };
}

/** True when the request is from a logged-in admin user. */
export function isAuthAdmin(request: Request): boolean {
  const auth = resolveAuth(request);
  return !!auth.user?.isAdmin;
}

export function getAuthUserById(id: string): AuthUser | null {
  return getUserById(id);
}

/** For NextRequest cookie helpers in route handlers */
export function getSessionTokenFromRequest(request: NextRequest): string | null {
  return request.cookies.get(SESSION_COOKIE)?.value || null;
}
