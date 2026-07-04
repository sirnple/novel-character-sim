import { NextRequest } from "next/server";

const ADMIN_SECRET = process.env.ADMIN_PASSWORD || "admin";

// Simple in-memory session — resets on server restart
let activeToken: string | null = null;

export function verifyPassword(password: string): string | null {
  if (password !== ADMIN_SECRET) return null;
  activeToken = "admin_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  return activeToken;
}

export function isAdmin(req: NextRequest): boolean {
  const token = req.headers.get("x-admin-token");
  return token === activeToken && activeToken !== null;
}
