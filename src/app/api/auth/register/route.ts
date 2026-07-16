import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIP, rateLimitMessage } from "@/lib/rate-limit";
import { attachSessionCookie, publicUser, registerUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ip = getClientIP(request);
  const rate = checkRateLimit(ip, "auth_register", { windowMs: 3600_000, maxRequests: 10 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "");
  const password = String(body.password || "");
  const displayName = body.displayName != null ? String(body.displayName) : undefined;

  const result = registerUser(email, password, displayName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const res = NextResponse.json({
    ok: true,
    ...publicUser(result.user, {
      userId: result.user.id,
      kind: "user",
      user: result.user,
    }),
  });
  attachSessionCookie(res, request, result.sessionToken);
  return res;
}
