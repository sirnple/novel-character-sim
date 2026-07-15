/**
 * Structural verification for mobile layout adaptation.
 * Asserts presentation patterns exist without changing product gates.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fail = (msg) => {
  console.error("FAIL:", msg);
  process.exit(1);
};
const ok = (msg) => console.log("OK:", msg);

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

// 1) Viewport + safe area
const layout = read("src/app/layout.tsx");
if (!layout.includes("export const viewport") && !layout.includes("viewport:")) {
  fail("root layout missing viewport export");
}
ok("viewport export present");

const css = read("src/app/globals.css");
if (!css.includes("safe-area-inset") && !css.includes("100dvh") && !css.includes("app-shell-height")) {
  fail("globals.css missing safe-area / app-shell-height helpers");
}
ok("safe-area / shell height styles present");

// 2) Global library: desktop rail + mobile drawer
const lib = read("src/components/global-library-sidebar.tsx");
if (!lib.includes("hidden lg:flex") && !lib.includes("lg:flex")) {
  fail("library sidebar missing desktop-only rail classes");
}
if (!lib.includes("mobileOpen") || !lib.includes("lg:hidden fixed")) {
  fail("library sidebar missing mobile drawer pattern");
}
ok("library: desktop rail + mobile drawer");

const shell = read("src/components/app-shell.tsx");
if (!shell.includes("libraryMobileOpen") && !shell.includes("setLibraryMobileOpen")) {
  fail("app-shell missing mobile library open control");
}
if (!shell.includes("lg:hidden") || !shell.includes("PanelLeft")) {
  fail("app-shell missing mobile library toggle");
}
ok("app-shell mobile library toggle");

// 3) Agent gate unchanged + mobile overlay
const novelLayout = read("src/app/novel/[id]/layout.tsx");
if (!novelLayout.includes("agentAvailable = onWritePage && !!activeBranchId")) {
  fail("agentAvailable gate must remain write-page + activeBranchId");
}
if (!novelLayout.includes("lg:hidden fixed") || !novelLayout.includes("AgentPanel")) {
  fail("agent panel missing mobile full-screen overlay");
}
if (!novelLayout.includes("hidden lg:flex") && !novelLayout.includes("hidden lg:flex shrink-0")) {
  // accept hidden lg:flex on aside
  if (!/hidden lg:flex/.test(novelLayout) && !/className="hidden lg:flex/.test(novelLayout)) {
    if (!novelLayout.includes("hidden lg:flex") && !novelLayout.includes("hidden lg:flex shrink-0 border-l")) {
      // check alternate
      if (!novelLayout.includes("className=\"hidden lg:flex")) {
        if (!novelLayout.includes("hidden lg:flex shrink-0") && !novelLayout.includes("hidden lg:flex")) {
          // freer check
          if (!/hidden lg:flex/.test(novelLayout)) {
            fail("agent desktop rail missing hidden lg:flex");
          }
        }
      }
    }
  }
}
if (!/hidden lg:flex/.test(novelLayout)) {
  fail("agent desktop rail missing hidden lg:flex");
}
ok("agent: gate intact + mobile overlay + desktop rail");

// 4) Write branches drawer
const write = read("src/app/novel/[id]/write/page.tsx");
if (!write.includes("branchDrawerOpen") || !write.includes("lg:hidden fixed")) {
  fail("write page missing branch mobile drawer");
}
if (!write.includes("hidden lg:flex") && !/hidden lg:flex/.test(write)) {
  fail("write page missing desktop branch rail");
}
ok("write: branch rail + mobile drawer");

// 5) No business API files in this mobile pass (spot-check we didn't touch extract)
// just ensure agent gate not always true
if (novelLayout.includes("agentAvailable = true") || novelLayout.includes("const agentAvailable = true")) {
  fail("agentAvailable must not be hard-coded true");
}
ok("agent not always-on");

console.log("\nAll mobile layout structural checks passed.");
