import { NextRequest, NextResponse } from "next/server";
import {
  getBranch,
  listBranches,
  appendBranchContent,
  copyForeshadowingLedger,
  getBranchProse,
  ensureMainBranch,
  deleteBranch,
  createCowBranch,
  resolveBranchText,
} from "@/lib/db";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";

/** Safe basename for Content-Disposition / download attribute */
function branchTxtFilename(name: string, branchId: string): string {
  const base = (name || branchId || "branch")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 80) || "branch";
  return base.endsWith(".txt") ? base : `${base}.txt`;
}

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "branches_get", { windowMs: 60_000, maxRequests: 30 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  const novelId = request.nextUrl.searchParams.get("novelId");
  const branchId = request.nextUrl.searchParams.get("branchId");
  const download =
    request.nextUrl.searchParams.get("download") === "1" ||
    request.nextUrl.searchParams.get("format") === "txt";

  if (branchId) {
    if (!novelId) return NextResponse.json({ error: "novelId required with branchId" }, { status: 400 });
    if (branchId === "main") ensureMainBranch(userId, novelId);
    const branch = getBranch(userId, novelId, branchId);
    if (!branch) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const fullText = resolveBranchText(userId, novelId, branchId);

    // Download branch body as UTF-8 .txt (resolved full body)
    if (download) {
      const filename = branchTxtFilename(branch.name || branch.id, branch.id);
      const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_") || "branch.txt";
      return new NextResponse(fullText, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition":
            `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
          "Cache-Control": "no-store",
          "X-Branch-Id": branch.id,
          "X-Branch-Name": encodeURIComponent(branch.name || branch.id),
        },
      });
    }

    return NextResponse.json({
      branch: {
        id: branch.id,
        novel_id: branch.novel_id,
        name: branch.name,
        parent_offset: branch.parent_offset,
        parent_branch_id: branch.parent_branch_id,
        storage: branch.storage,
        char_count: fullText.length,
        text: fullText,
        created_at: branch.created_at,
        updated_at: branch.updated_at,
      },
    });
  }

  if (novelId) {
    // Metadata only — full body via ?branchId=
    const branches = listBranches(userId, novelId);
    return NextResponse.json({ branches });
  }

  return NextResponse.json({ error: "novelId or branchId required" }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "branches_post", { windowMs: 60_000, maxRequests: 20 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  const { novelId, branchId, name, parentOffset, content, append, parentBranchId } = await request.json();

  if (!novelId || !name) {
    return NextResponse.json({ error: "novelId and name are required" }, { status: 400 });
  }

  if (append && branchId) {
    appendBranchContent(userId, novelId, branchId, content || "");
    const { text, branch: row } = getBranchProse(userId, novelId, branchId);
    return NextResponse.json({
      success: true,
      branch: row
        ? {
            ...row,
            text,
            char_count: text.length,
          }
        : null,
    });
  }

  // New IF branch: CoW — store only suffix after parent_offset (initially empty)
  const id = branchId || `branch_${Date.now()}`;
  const parentId = String(parentBranchId || "main");
  const offset = typeof parentOffset === "number" ? parentOffset : Number(parentOffset) || 0;

  ensureMainBranch(userId, novelId);
  const row = createCowBranch(userId, novelId, id, name, parentId, offset);
  try {
    copyForeshadowingLedger(userId, novelId, parentId, id);
  } catch (e) {
    console.warn("[branches] copy foreshadowing ledger failed:", (e as Error).message);
  }
  const fullText = resolveBranchText(userId, novelId, id);
  return NextResponse.json({
    success: true,
    branch: {
      id: row.id,
      novel_id: row.novel_id,
      name: row.name,
      parent_offset: row.parent_offset,
      parent_branch_id: row.parent_branch_id,
      storage: row.storage,
      char_count: fullText.length,
      text: fullText,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  });
}

/** DELETE ?novelId=&branchId= — remove IF branch (not main) */
export async function DELETE(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "branches_delete", { windowMs: 60_000, maxRequests: 30 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  const novelId =
    request.nextUrl.searchParams.get("novelId") ||
    "";
  const branchId =
    request.nextUrl.searchParams.get("branchId") ||
    "";

  // Also accept JSON body
  let bodyNovel = novelId;
  let bodyBranch = branchId;
  try {
    const body = await request.json();
    if (body?.novelId) bodyNovel = String(body.novelId);
    if (body?.branchId) bodyBranch = String(body.branchId);
  } catch {
    /* query only */
  }

  if (!bodyNovel || !bodyBranch) {
    return NextResponse.json({ error: "novelId and branchId required" }, { status: 400 });
  }

  const result = deleteBranch(userId, bodyNovel, bodyBranch);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ success: true, novelId: bodyNovel, branchId: bodyBranch });
}
