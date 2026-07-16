import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIP, rateLimitMessage } from "@/lib/rate-limit";
import { attachSessionCookie, loginUser, publicUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ip = getClientIP(request);
  const rate = checkRateLimit(ip, "auth_login", { windowMs: 900_000, maxRequests: 30 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const result = loginUser(String(body.email || ""), String(body.password || ""));
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 401 });
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
