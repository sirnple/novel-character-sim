import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "@/core/prompts/admin-auth";

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({}));
  const token = verifyPassword(password);
  if (!token) {
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }
  return NextResponse.json({ token });
}
