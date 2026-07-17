# Review package Task 2
Base: 5edf6a0a061a1c62e0726502d310e826879d2a40
Head: 99e12ceae46d3a1258e719a48860bf94f071ed44

## Commits
99e12ce feat(agents): get_novel_form tool and form-aware branch meta


## Stat
 src/app/api/agent/chat/route.ts        |  1 +
 src/components/agent-panel.tsx         |  1 +
 src/core/agents/agents/branch-tools.ts | 79 ++++++++++++++++++++++++++++++----
 3 files changed, 73 insertions(+), 8 deletions(-)


## Diff
diff --git a/src/app/api/agent/chat/route.ts b/src/app/api/agent/chat/route.ts
index 958b7d9..39997df 100644
--- a/src/app/api/agent/chat/route.ts
+++ b/src/app/api/agent/chat/route.ts
@@ -42,20 +42,21 @@ export async function POST(request: NextRequest) {
   const autoPass = !!autoPassCheckpoints;
   const llm = createLLMProvider();
   const encoder = new TextEncoder();
   // 涓?agent 鍙皟搴︿笌灞曠ず鎽樿锛涙鏂囩敱瀛?agent 鑷彇锛屼笉鍚戜富 agent 鏆撮湶 get_prose / save_*
   const MASTER_TOOL_ALLOW = new Set([
     "agent",
     "ask_question",
     "run_reviews",
     "accept_continuation",
     "get_branch_text", "get_branch_characters", "get_branch_timeline", "get_branch_world", "get_branch_meta",
+    "get_novel_form",
     "get_outline", "get_findings", "clear_findings",
   ]);
   const toolSchemas: ToolSchema[] = buildToolSchemas().filter(t => MASTER_TOOL_ALLOW.has(t.name));
   const baseSys = resolveAgentSystem("master", "zh", { novelId, branchId });
   const sysPrompt = autoPass
     ? `${baseSys}\n\n${ONE_CLICK_CONTINUE_SYSTEM_APPEND}`
     : baseSys;
 
   const stream = new ReadableStream({
     async start(controller) {
diff --git a/src/components/agent-panel.tsx b/src/components/agent-panel.tsx
index 1a4f042..c831e21 100644
--- a/src/components/agent-panel.tsx
+++ b/src/components/agent-panel.tsx
@@ -82,20 +82,21 @@ interface AgentMessage {
 
 const TOOL_LABELS: Record<string, string> = {
   get_outline: "鑾峰彇澶х翰",
   get_prose: "鑾峰彇姝ｆ枃",
   get_findings: "鑾峰彇瀹℃煡鍙戠幇",
   get_branch_text: "鑾峰彇鍒嗘敮鍓嶆枃",
   get_branch_characters: "鑾峰彇瑙掕壊",
   get_branch_timeline: "鑾峰彇鏃堕棿绾?,
   get_branch_world: "鑾峰彇涓栫晫瑙?,
   get_branch_meta: "鑾峰彇鍒嗘敮淇℃伅",
+  get_novel_form: "鑾峰彇褰㈡€?绔犳硶",
   save_outline: "淇濆瓨澶х翰",
   save_prose: "淇濆瓨姝ｆ枃",
   save_findings: "淇濆瓨瀹℃煡鍙戠幇",
   clear_findings: "娓呯┖瀹℃煡鍙戠幇",
 };
 
 function toolLabel(name?: string) {
   if (!name) return "tool";
   return TOOL_LABELS[name] || name;
 }
diff --git a/src/core/agents/agents/branch-tools.ts b/src/core/agents/agents/branch-tools.ts
index 593619e..3ccac4c 100644
--- a/src/core/agents/agents/branch-tools.ts
+++ b/src/core/agents/agents/branch-tools.ts
@@ -1,12 +1,23 @@
 import type { ToolDefinition } from "../types";
-import { getBranchProse, getCharacters, getTimeline, getStoryInfo } from "@/lib/db";
+import {
+  getBranchProse,
+  getCharacters,
+  getTimeline,
+  getStoryInfo,
+  getNovelForm,
+  getBranchChapterMeta,
+} from "@/lib/db";
+import {
+  buildFormAgentContext,
+  formatFormAgentContextForTool,
+} from "@/core/form/form-context";
 import { formatCriticalMiss } from "../critical-miss";
 
 const TEXT_TAIL = 30000;
 
 /** Rough genre 鈫?logic strictness for review agents (prompt hint only). */
 function inferLogicStrictnessHint(genre: string, themes?: string[]): string {
   const g = `${genre} ${(themes || []).join(" ")}`.toLowerCase();
   const has = (...keys: string[]) => keys.some((k) => g.includes(k));
   if (
     has(
@@ -144,37 +155,89 @@ export const branchTools: ToolDefinition[] = [
           },
           null,
           2,
         ),
         messages: [],
       };
     },
   },
   {
     name: "get_branch_meta",
-    description: "鑾峰彇鍒嗘敮鍏冧俊鎭細name/parent_offset/鎬诲瓧鏁般€?,
+    description:
+      "鑾峰彇鍒嗘敮鍏冧俊鎭細name/瀛楁暟锛屼互鍙婂舰鎬?绔犳硶鎽樿锛堟槸鍚﹀垎绔犮€佺珷鍚嶆牱渚嬨€乧ontinuationRules銆佺珷寮€闂竟鐣屻€佺洰褰曟潯鏁帮級銆傚ぇ绾蹭笌鍐欐墜缁啓鍓嶅簲璋冪敤銆?,
     parameters: {
       type: "object",
       properties: {
         novelId: { type: "string", description: "灏忚 ID" },
         branchId: { type: "string", description: "鍒嗘敮 ID锛堜富绾夸负 main锛? },
       },
       required: ["novelId", "branchId"],
     },
     execute: async (args, ctx) => {
       const userId = ctx.userId || "guest";
       const novelId = (ctx.novelId || args.novelId || "") as string;
       const branchId = (ctx.branchId || args.branchId || "main") as string;
       const { text, branch } = getBranchProse(userId, novelId, branchId);
       if (!branch) return { content: "鍒嗘敮涓嶅瓨鍦?, messages: [] };
+
+      const form = getNovelForm(userId, novelId);
+      const chapterMeta = getBranchChapterMeta(userId, novelId, branchId);
+      const formCtx = buildFormAgentContext({
+        form,
+        chapterMeta,
+        novelId,
+        branchId,
+      });
+
+      return {
+        content: JSON.stringify(
+          {
+            name: branch.name,
+            parent_offset: branch.parent_offset,
+            novel_id: branch.novel_id,
+            total_chars: text.length,
+            form: formCtx,
+          },
+          null,
+          2,
+        ),
+        messages: [],
+      };
+    },
+  },
+  {
+    name: "get_novel_form",
+    description:
+      "鑾峰彇灏忚褰㈡€?绔犳硶锛堥锛夛細formType銆佹槸鍚﹀垎绔犮€佺珷鍚?samples銆乧ontinuationRules銆佸垎鏀珷杈圭晫涓庣洰褰曟憳瑕併€傚ぇ绾蹭笌鍐欐墜鍦ㄨ鍒掔珷鑺傚墠搴旇皟鐢紱寮卞垎绔犳椂蹇呴』閬靛畧 forbidInventChapterTitles銆?,
+    parameters: {
+      type: "object",
+      properties: {
+        novelId: { type: "string", description: "灏忚 ID" },
+        branchId: { type: "string", description: "鍒嗘敮 ID锛堢敤浜庤竟鐣?鐩綍锛涗富绾?main锛? },
+      },
+      required: ["novelId", "branchId"],
+    },
+    execute: async (args, ctx) => {
+      const userId = ctx.userId || "guest";
+      const novelId = (ctx.novelId || args.novelId || "") as string;
+      const branchId = (ctx.branchId || args.branchId || "main") as string;
+      if (!novelId) {
+        return {
+          content: formatCriticalMiss("novelId", "缂哄皯 novelId锛屾棤娉曡鍙栧舰鎬佸垎鏋愩€?),
+          messages: [],
+        };
+      }
+      const form = getNovelForm(userId, novelId);
+      const chapterMeta = getBranchChapterMeta(userId, novelId, branchId);
+      const formCtx = buildFormAgentContext({
+        form,
+        chapterMeta,
+        novelId,
+        branchId,
+      });
       return {
-        content: JSON.stringify({
-          name: branch.name,
-          parent_offset: branch.parent_offset,
-          novel_id: branch.novel_id,
-          total_chars: text.length,
-        }, null, 2),
+        content: formatFormAgentContextForTool(formCtx),
         messages: [],
       };
     },
   },
 ];

