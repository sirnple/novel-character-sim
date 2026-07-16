import { NextRequest, NextResponse } from "next/server";
import { publicUser, resolveAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = resolveAuth(request);
  return NextResponse.json(publicUser(auth.user, auth));
}
