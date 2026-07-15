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
if (!css.includes("app-shell-height") || !css.includes("100dvh")) {
  fail("globals.css missing app-shell-height / 100dvh");
}
if (!css.includes("safe-area-inset") || !css.includes("safe-drawer-pad")) {
  fail("globals.css missing safe-area on shell or drawers");
}
// Body must not pad + 100dvh (double clip)
if (/body\s*\{[^}]*padding:\s*env\(safe-area/s.test(css)) {
  fail("body must not apply safe-area padding when shell uses 100dvh + pad");
}
ok("safe-area on shell/drawers without body+100dvh double pad");

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

// 3) Agent gate + single AgentPanel instance
const novelLayout = read("src/app/novel/[id]/layout.tsx");
if (!novelLayout.includes("agentAvailable = onWritePage && !!activeBranchId")) {
  fail("agentAvailable gate must remain write-page + activeBranchId");
}
const agentMounts = (novelLayout.match(/<AgentPanel[\s>]/g) || []).length;
if (agentMounts !== 1) {
  fail(`expected exactly one <AgentPanel mount, found ${agentMounts}`);
}
if (!novelLayout.includes("isLg") || !novelLayout.includes("matchMedia")) {
  fail("agent layout should branch desktop/mobile chrome via matchMedia (single panel)");
}
if (!novelLayout.includes("absolute inset-0") && !novelLayout.includes("isLg")) {
  fail("mobile agent sheet should cover main only (absolute under sub-nav)");
}
// Auto-open only on desktop
if (!novelLayout.includes("if (isLg) setShowRightPanel(true)")) {
  fail("mobile must not auto-open agent full-screen; only isLg auto-open");
}
ok("agent: gate + single mount + desktop auto-open only");

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
