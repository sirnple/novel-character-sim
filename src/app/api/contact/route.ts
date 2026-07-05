import { NextResponse } from "next/server";

/**
 * Expose author contact channels configured via environment variables.
 * All fields are optional — only set fields are returned. This lets the
 * deployer (e.g. Railway Variables) control contact info at runtime
 * without touching code or rebuilding.
 *
 * Supported env vars:
 *   AUTHOR_NAME     — display name shown as the heading
 *   AUTHOR_EMAIL    — becomes a mailto: link
 *   AUTHOR_GITHUB   — GitHub username or full URL
 *   AUTHOR_WECHAT   — WeChat ID, shown as copyable text
 *   AUTHOR_WEBSITE  — personal site URL
 *   AUTHOR_NOTE     — free-text footnote (e.g. "欢迎提 issue 反馈")
 */
function normalizeGitHub(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  // Bare username → full URL
  return `https://github.com/${v.replace(/^@/, "")}`;
}

function normalizeUrl(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

export async function GET() {
  const contact = {
    name: (process.env.AUTHOR_NAME || "").trim() || null,
    email: (process.env.AUTHOR_EMAIL || "").trim() || null,
    github: normalizeGitHub(process.env.AUTHOR_GITHUB || ""),
    wechat: (process.env.AUTHOR_WECHAT || "").trim() || null,
    website: normalizeUrl(process.env.AUTHOR_WEBSITE || ""),
    note: (process.env.AUTHOR_NOTE || "").trim() || null,
  };

  const hasAny = Object.values(contact).some(Boolean);
  if (!hasAny) {
    return NextResponse.json({ configured: false });
  }

  return NextResponse.json({ configured: true, ...contact });
}
