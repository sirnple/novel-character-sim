import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "@/core/prompts/admin-auth";

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({}));
  const result = verifyPassword(typeof password === "string" ? password : "");
  if (!result.ok) {
    if (result.reason === "not_configured") {
      return NextResponse.json(
        { error: "未配置 ADMIN_PASSWORD，管理后台已禁用" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }
  return NextResponse.json({ token: result.token });
}
