import fs from "fs";
import path from "path";

const DEBUG_LOG = path.join(process.cwd(), "debug.log");

export function debugLog(tag: string, message: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${tag}] ${message}\n`;
  try {
    fs.appendFileSync(DEBUG_LOG, line, "utf-8");
  } catch {
    // silently ignore log failures
  }
}
