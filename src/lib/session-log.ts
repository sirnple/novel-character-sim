import fs from "fs";
import path from "path";

const SESSION_LOG = path.join(process.cwd(), "session.jsonl");

export function logSession(entry: Record<string, unknown>): void {
  try {
    fs.appendFileSync(SESSION_LOG, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // silently ignore log failures
  }
}
