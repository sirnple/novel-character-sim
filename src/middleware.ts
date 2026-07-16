import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  GUEST_COOKIE,
  GUEST_ID_HEADER,
  GUEST_ID_RE,
  GUEST_MAX_AGE_SEC,
} from "@/lib/auth-constants";

function mintGuestId(): string {
  // Edge-compatible UUID
  const id = crypto.randomUUID().replace(/-/g, "");
  return `guest_${id}`;
}

export function middleware(request: NextRequest) {
  const existing = request.cookies.get(GUEST_COOKIE)?.value;
  const valid = existing && GUEST_ID_RE.test(existing) ? existing : null;
  const guestId = valid || mintGuestId();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(GUEST_ID_HEADER, guestId);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  if (!valid) {
    const secure =
      request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" ||
      request.nextUrl.protocol === "https:";
    response.cookies.set(GUEST_COOKIE, guestId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: GUEST_MAX_AGE_SEC,
      secure,
    });
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * All app routes except static assets and Next internals.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
