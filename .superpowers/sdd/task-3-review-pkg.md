# Review package Task 3
Base: 99e12ceae46d3a1258e719a48860bf94f071ed44
Head: f3b94a0fb11fa06eebb1f5803a393ca21911453a

## Commits
f3b94a0 feat(agents): outline/writer consume novel form chaptering rules

## Stat
 src/core/agents/agents/writer.ts           |  8 +++++---
 src/core/prompts/outline-agent-contract.md |  7 ++++++-
 src/core/prompts/outline-system.md         |  6 ++++--
 src/core/prompts/writer-create-system.md   | 14 +++++++++-----
 src/core/prompts/writer-create-user.md     |  2 +-
 src/core/prompts/writer-rewrite-system.md  |  4 ++++
 6 files changed, 29 insertions(+), 12 deletions(-)

## Diff
diff --git a/src/core/agents/agents/writer.ts b/src/core/agents/agents/writer.ts
index d287c1b..c0d5ecb 100644
--- a/src/core/agents/agents/writer.ts
+++ b/src/core/agents/agents/writer.ts
@@ -38,32 +38,34 @@ const FS_READ = foreshadowTools
     t.name === "get_foreshadowing_plan",
   )
   .map(t => ({
     name: t.name,
     description: t.description,
     parameters: t.parameters as Record<string, unknown>,
   }));
 
-/** Create: outline + branch + foreshadow + save_prose */
+/** Create: outline + branch + form + foreshadow + save_prose */
 const CREATE_TOOLS = [
   ...schemas([
     "get_outline",
     "get_branch_text",
     "get_branch_characters",
     "get_branch_timeline",
     "get_branch_world",
+    "get_branch_meta",
+    "get_novel_form",
   ]),
   ...FS_READ,
   SAVE_SCHEMA,
 ];
 
-/** Rewrite: prose + findings + save_prose */
+/** Rewrite: prose + findings + form + save_prose */
 const REWRITE_TOOLS = [
-  ...schemas(["get_prose", "get_findings", "get_branch_text"]),
+  ...schemas(["get_prose", "get_findings", "get_branch_text", "get_novel_form"]),
   ...FS_READ,
   SAVE_SCHEMA,
 ];
 
 /** Did the agent successfully call save_prose? (tool_result in trail) */
 function findSaveProseOutcome(trail: TrailMessage[]): {
   called: boolean;
   accepted: boolean;
diff --git a/src/core/prompts/outline-agent-contract.md b/src/core/prompts/outline-agent-contract.md
index a859b68..8ff3040 100644
--- a/src/core/prompts/outline-agent-contract.md
+++ b/src/core/prompts/outline-agent-contract.md
@@ -1,27 +1,32 @@
 ## 宸ュ叿涓庢搷浣滄楠わ紙Agent 妗嗘灦锛? 
-### 姝ラ 1锛氬彇璇锛堟寜闇€锛?+### 姝ラ 1锛氬彇璇锛堟寜闇€锛岀珷娉曞繀鍙栵級
 闈欓粯璋冪敤锛?+- **`get_novel_form`**锛堝繀鍋氫竴娆★級锛氭槸鍚﹀垎绔犮€佺珷鍚?samples銆乧ontinuationRules銆佺珷杈圭晫
 - `get_branch_text` / `get_branch_characters` / `get_branch_timeline` / `get_branch_world`
 - `get_foreshadowing_ledger`锛堣嫢鏈夋椿璺冧紡绗旓級
 
+鑻?`forbidInventChapterTitles=true`锛氬ぇ绾蹭腑绂佹瑙勫垝銆岀N绔犮€嶆爣棰橈紝闄ら潪鐢ㄦ埛鏄庣‘瑕佹眰鍒嗙珷銆?+鑻?`chapteringEnabled=true`锛氬繀椤诲啓娓?`缁啓鏈珷` / `鏀舵潫鏈珷骞舵柊寮€` / `鏂板紑涓€绔燻锛屾柊绔犳爣棰樿创鍚?samples銆?+
 ### 姝ラ 2锛氳惤鐩橈紙蹇呴』锛岀▼搴忓彧璁ゅ伐鍏凤級
 1. **`save_outline`**锛歚content` = **瀹屾暣澶х翰姝ｆ枃**锛堢粨鏋勬竻鏅扮殑鑷劧璇█锛?*涓嶆槸 JSON**锛? 2. **`save_foreshadowing_plan`**锛歚plan` = JSON 瀛楃涓? 
    `{ "plant":[], "advance":[], "reveal":[], "abandon":[], "rationale":"" }`
 
 ### 姝ラ 3锛氭敹灏? - 宸ュ叿鎴愬姛鍚庡彧闇€涓€鍙ョ‘璁わ紱**涓嶈**鍐嶅湪鑱婂ぉ閲岃创鏁翠唤澶х翰鎴?JSON
 - 涓?agent / 鐢ㄦ埛閫氳繃 `get_outline` 璇诲叏鏂? 
 ## 鍙敤宸ュ叿
 | 宸ュ叿 | 鐢ㄩ€?|
 |------|------|
+| **get_novel_form** | 褰㈡€?绔犳硶锛堝繀鍋氫竴娆★級 |
 | get_branch_* | 璇 |
 | get_foreshadowing_ledger | 娲昏穬浼忕瑪 |
 | list_ideas / get_ideas | 鐐瑰瓙搴?|
 | **save_outline** | **淇濆瓨澶х翰锛堝繀鍋氾級** |
 | **save_foreshadowing_plan** | **淇濆瓨浼忕瑪鎰忓浘锛堝繀鍋氾級** |
 
 ## 绂佹
 - 涓嶈璋冪敤 get_prose / get_findings / save_prose
diff --git a/src/core/prompts/outline-system.md b/src/core/prompts/outline-system.md
index 0b63013..fa9ee6b 100644
--- a/src/core/prompts/outline-system.md
+++ b/src/core/prompts/outline-system.md
@@ -6,23 +6,25 @@
 
 {{#selectionInstruction}}
 
 ## 澶х翰鏍稿績瑕佺礌
 
 涓€涓畬鏁寸殑缁啓澶х翰锛屽繀椤绘槑纭互涓嬩俊鎭細
 
 ### 1. 绡囧箙涓庣珷鑺傝鍒?+- **鍏堣皟鐢?`get_novel_form`锛堟垨璇?`get_branch_meta.form`锛?* 鍐嶅啓绔犺妭瑙勫垝
 - 棰勮缁啓瀛楁暟锛堟牴鎹墠鏂囬暱搴﹀拰鎯呰妭闇€瑕侊紝寤鸿2000-8000瀛楋級
 - 棰勮鍒嗕负鍑犵珷锛堝缓璁?-3绔狅紝濡傛灉鎯呰妭璺ㄥ害杈冨ぇ鍙€傚綋澧炲姞锛?-- **蹇呴』鍐欐竻鏈珷绛栫暐**锛堜笁閫変竴鎴栫粍鍚堬級锛?+- 鑻?`chapteringEnabled=false` / `forbidInventChapterTitles=true`锛氫笉瑕佺紪閫犮€岀N绔犮€嶏紝鐢ㄥ満鏅?娈佃惤瑙勫垝鍗冲彲
+- 鑻?`chapteringEnabled=true`锛氭柊绔犳爣棰樺繀椤昏创杩?`chapterTitleSamples` 鐨勬牸寮忥紱骞堕伒瀹?`continuationRules`
+- **蹇呴』浣跨敤鍙绱㈠叧閿瘝涔嬩竴鍐欐竻绛栫暐**锛歚缁啓鏈珷` / `鏀舵潫鏈珷` / `鏂板紑涓€绔燻锛坅ccept 杈圭晫鍚彂寮忎緷璧栬繖浜涜瘝锛?   - `缁啓鏈珷`锛氫笉鏂拌捣绔犳爣棰?   - `鏀舵潫鏈珷骞舵柊寮€`锛氬啓瀹屽綋鍓嶇珷鍚庢柊寮€绔狅紝骞剁粰鍑烘柊绔犳爣棰橈紙鏍煎紡璐村悎鍘熻憲锛屽銆岀N绔?鏍囬銆嶏級
   - `鏂板紑涓€绔?澶氱珷`锛氬垪鍑烘瘡绔犳嫙瀹氭爣棰樹笌涓€鍙ヨ瘽鑺傛媿
-- 鑻ュ師钁楀急鍒嗙珷/涓嶅垎绔狅細涓嶈缂栭€犮€岀N绔犮€? 
 ### 2. 鏃堕棿
 鏈缁啓鍙戠敓鍦ㄤ粈涔堟椂闂达紵绱ф帴鍓嶆枃杩樻槸璺宠穬浜嗗嚑澶?鍑犱釜鏈?鍑犲勾锛熶粈涔堝鑺傦紵鐧藉ぉ杩樻槸澶滄櫄锛? 
 ### 3. 绌洪棿
 鏈缁啓鍙戠敓鍦ㄥ摢閲岋紵涓€涓湴鐐硅繕鏄涓湴鐐癸紵鍦扮偣涔嬮棿濡備綍杩囨浮锛熶笌鍘熸枃鐩告瘮绌洪棿鍙戠敓浜嗘€庢牱鐨勫彉鍖栵紵
 鑷冲皯鍒楀嚭 1-2 涓叿浣撶殑鍦扮偣銆? 
diff --git a/src/core/prompts/writer-create-system.md b/src/core/prompts/writer-create-system.md
index d3e6224..6502117 100644
--- a/src/core/prompts/writer-create-system.md
+++ b/src/core/prompts/writer-create-system.md
@@ -8,31 +8,35 @@
 ### 1. 鍙栧ぇ绾诧紙蹇呭仛锛? - 璋冪敤 `get_outline`
 - 鑻ャ€屽ぇ绾叉湭鐢熸垚銆嶁啋 鍋滄锛屼笉瑕佺瀻缂? 
 ### 2. 琛ュ厖璇锛堟寜闇€锛? 鍙€夛細`get_branch_text` / `get_branch_characters` / `get_branch_timeline` / `get_branch_world`  
 璋冨伐鍏锋椂涓嶈鍐欒繃绋嬫梺鐧姐€? 
+### 2b. 褰㈡€?绔犳硶锛堝繀鍋氫竴娆★級
+- 璋冪敤 `get_novel_form`锛堟垨 `get_branch_meta` 涓殑 form锛?+- 鑻?`forbidInventChapterTitles=true`锛?*绂佹**鍦ㄦ鏂囦腑鍐欍€岀N绔犫€︺€嶆爣棰樿锛岄櫎闈炵敤鎴?prompt 鏄庣‘瑕佹眰鍒嗙珷
+- 鑻?`chapteringEnabled=true`锛?+  - 澶х翰鍐欍€屾柊寮€銆嶁啋 姝ｆ枃浠ヤ笌 `chapterTitleSamples` 涓€鑷寸殑鏍囬璧风瑪锛堢嫭鍗犱竴琛岋級
+  - 澶х翰鍐欍€岀画鍐欐湰绔犮€嶁啋 **涓嶈**鏃犳晠鏂拌捣绔犳爣棰?+  - 閬靛畧 `continuationRules` 鍏ㄦ枃
+
 ### 3. 鍐欎綔骞朵繚瀛橈紙蹇呭仛锛? 1. 鍦ㄥ績涓紙鎴栬崏绋夸腑锛夊畬鎴?*瀹屾暣鍙欎簨姝ｆ枃**
 2. **蹇呴』璋冪敤** `save_prose`锛屽弬鏁?`content` = **瀹屾暣灏忚姝ｆ枃鍏ㄦ枃**
 3. 绛夊緟宸ュ叿杩斿洖銆屾鏂囧凡瀛橈紙N 瀛楋級銆嶆墠绠楁垚鍔? 4. 鑻ヨ繑鍥炪€屾嫆缁濅繚瀛樸€嶁啋 鎸夋彁绀轰慨姝?content锛屽啀娆?`save_prose`
 
-### 绔犳爣棰橈紙鑻ユ湰涔﹀垎绔狅級
-- 鑻ュぇ绾叉爣鏄?*鏂板紑绔?/ 绗?N 绔?*锛屾鏂囬』浠ヤ笌鍘熻憲涓€鑷寸殑绔犳爣棰樿捣绗旓紙濡?`绗?2绔?闆ㄥ`锛夛紝鐙崰涓€琛?-- 鑻ュぇ绾叉爣鏄?*缁啓鏈珷 / 鍚屼竴绔?*锛?*涓嶈**鏃犳晠鏂拌捣銆岀N绔犮€?-- 鑻ヨ澧冩樉绀烘湰涔﹀急鍒嗙珷/涓嶅垎绔狅紝涓嶈纭姞绔犳爣棰?-
 ## 鍙敤宸ュ叿
 | 宸ュ叿 | 鐢ㄩ€?|
 |------|------|
 | get_outline | 澶х翰锛堝繀鍋氾級 |
+| **get_novel_form** / get_branch_meta | 褰㈡€?绔犳硶锛堝繀鍋氫竴娆★級 |
 | get_branch_text / characters / timeline / world | 璇锛堝彲閫夛級 |
 | **save_prose** | **淇濆瓨瀹屾暣姝ｆ枃锛堝繀鍋氾紝浠诲姟瀹屾垚鐨勬爣蹇楋級** |
 
 ## 绂佹
 - 涓嶈璋冪敤 get_prose / get_findings
 - 涓嶈鍙緭鍑烘鏂囧嵈涓嶈皟鐢?save_prose锛堢▼搴忓彧璁?save 鎴愬姛锛? - content 绂佹锛氬垱浣滆鍒掋€佸垎鐐规彁绾层€佷慨鏀规柟鍚戙€併€屼互涓嬫槸姝ｆ枃銆? - content 蹇呴』鏄彲鐩存帴闃呰鐨勫皬璇村彊浜?diff --git a/src/core/prompts/writer-create-user.md b/src/core/prompts/writer-create-user.md
index e2cb47c..8b9c86f 100644
--- a/src/core/prompts/writer-create-user.md
+++ b/src/core/prompts/writer-create-user.md
@@ -1,6 +1,6 @@
 {{prompt}}
 
 ## 褰撳墠缁戝畾鍒嗘敮
 novelId={{novelId}}, branchId={{branchId}}
 
-鎸夋楠わ細get_outline 鈫掞紙鍙€?get_branch_*锛夆啋 **save_prose(瀹屾暣姝ｆ枃)**銆備换鍔′互 save_prose 鎴愬姛涓哄噯銆?+鎸夋楠わ細get_outline 鈫?get_novel_form 鈫掞紙鍙€?get_branch_*锛夆啋 **save_prose(瀹屾暣姝ｆ枃)**銆備换鍔′互 save_prose 鎴愬姛涓哄噯銆?diff --git a/src/core/prompts/writer-rewrite-system.md b/src/core/prompts/writer-rewrite-system.md
index c1825b4..4fdc56b 100644
--- a/src/core/prompts/writer-rewrite-system.md
+++ b/src/core/prompts/writer-rewrite-system.md
@@ -10,29 +10,33 @@
 - 鑻ャ€屾鏂囨湭鐢熸垚銆嶁啋 鍋滄
 
 ### 2. 鍙栧鏌ラ棶棰橈紙蹇呭仛锛? - 璋冪敤 `get_findings`锛堟爣璁颁负銆屽鏌ラ棶棰樻竻鍗曘€嶏紝鍙綔淇敼渚濇嵁锛? 
 ### 3. 鎸夐渶瀵圭収
 鍙€夛細`get_branch_text`
 
+## 绔犳硶
+鏀瑰啓鏃惰皟鐢?`get_novel_form` 涓€娆°€傝嫢 `forbidInventChapterTitles=true`锛屼笉瑕佹柊澧炪€岀N绔犮€嶆爣棰樿銆傝嫢鍘熻崏绋垮凡鏈夌珷鏍囬锛屼繚鎸佹牸寮忎竴鑷达紝鍕挎敼鎴愬彟涓€绉嶇紪鍙蜂綋绯汇€?+
 ### 4. 淇敼骞朵繚瀛橈紙蹇呭仛锛? 1. 鍦ㄦ楠?1 鐨勬鏂囦笂锛屽彧鏀规楠?2 鎸囧嚭鐨勯棶棰? 2. 寰楀埌**淇敼鍚庣殑瀹屾暣绔犺妭**锛堥暱搴︽帴杩戝師鏂囷紝涓嶆槸鍑犳潯瑕佺偣锛? 3. **蹇呴』璋冪敤** `save_prose`锛宍content` = 淇敼鍚庣殑**瀹屾暣灏忚姝ｆ枃**
 4. 鐪嬪埌銆屾鏂囧凡瀛橈紙N 瀛楋級銆嶆墠绠楀畬鎴? 5. 鑻ャ€屾嫆缁濅繚瀛樸€嶁啋 璇存槑 content 浠嶆槸璁″垝/娓呭崟/杩囩煭锛屾敼鎴愬畬鏁村彊浜嬪悗鍐?save
 
 ## 鍙敤宸ュ叿
 | 宸ュ叿 | 鐢ㄩ€?|
 |------|------|
 | get_prose | 寰呮敼姝ｆ枃锛堝繀鍋氾級 |
 | get_findings | 闂娓呭崟锛堝繀鍋氾級 |
 | get_branch_text | 鍙€?|
+| **get_novel_form** | 褰㈡€?绔犳硶锛堟敼鍐欐椂鍋氫竴娆★級 |
 | **save_prose** | **淇濆瓨淇敼鍚庢鏂囷紙蹇呭仛锛屼换鍔″畬鎴愮殑鏍囧織锛?* |
 
 ## 绂佹锛堣繚鍙嶅垯 save 浼氳鎷掔粷 / 浠诲姟澶辫触锛? `save_prose` 鐨?content **缁濆涓嶈兘**鏄細
 - 銆岀幇鍦ㄦ垜宸茶幏鍙栤€﹀紑濮嬩慨鏀规鏂囥€? - 銆屾牳蹇冧慨鏀规柟鍚?/ 淇敼瑕佺偣銆嶅垎鐐瑰垪琛? - findings銆丣SON銆併€屽叡 N 涓棶棰樸€? - 浠讳綍缂栬緫鎶ュ憡鍙ｅ惢

