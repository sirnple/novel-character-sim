import { NextRequest, NextResponse } from "next/server";
import {
  getShareOverviewByToken,
  revokeShareOverview,
  updateShareVisibility,
} from "@/lib/db";
import { resolveAuth } from "@/lib/auth";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { isShareVisibility } from "@/lib/share-payload";

type Ctx = { params: { token: string } };

export async function GET(request: NextRequest, { params }: Ctx) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "share_get", { windowMs: 60_000, maxRequests: 120 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }
  const token = params.token;
  if (!token) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const row = getShareOverviewByToken(token);
  if (!row || row.revokedAt) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (row.visibility === "auth") {
    const auth = resolveAuth(request);
    if (auth.kind !== "user") {
      return NextResponse.json({ error: "auth_required" }, { status: 401 });
    }
  }
  // Never return ownerUserId or novelId
  return NextResponse.json({
    payload: row.payload,
    visibility: row.visibility,
    createdAt: row.createdAt,
  });
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const userId = getUserId(request);
  let body: { visibility?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!isShareVisibility(body.visibility)) {
    return NextResponse.json({ error: "invalid_visibility" }, { status: 400 });
  }
  const result = updateShareVisibility(params.token, userId, body.visibility);
  if (!result.ok) {
    if (result.reason === "forbidden") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (result.reason === "revoked") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ success: true, visibility: body.visibility });
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const userId = getUserId(request);
  const result = revokeShareOverview(params.token, userId);
  if (!result.ok) {
    if (result.reason === "forbidden") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
