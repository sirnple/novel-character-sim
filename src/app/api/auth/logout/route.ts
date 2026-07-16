import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, logoutSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  logoutSession(request);
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res, request);
  return res;
}
