import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAccess } from "@/core/prompts/admin-auth";

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({}));
  const result = verifyAdminAccess(
    req,
    typeof password === "string" ? password : "",
  );
  if (!result.ok) {
    if (result.reason === "not_configured") {
      return NextResponse.json(
        { error: "未配置管理员（ADMIN_EMAILS / ADMIN_PASSWORD），管理后台已禁用" },
        { status: 503 },
      );
    }
    if (result.reason === "not_admin") {
      return NextResponse.json(
        { error: "需要管理员账号登录后访问" },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }
  return NextResponse.json({ token: result.token });
}
