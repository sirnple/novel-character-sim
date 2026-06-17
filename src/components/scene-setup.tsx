"use client";

import { useState } from "react";
import type { CharacterProfile, SceneDefinition, StoryInfo } from "@/types";
import { Clapperboard, Play, Sparkles, Loader2 } from "lucide-react";
import { useRateLimitCooldown } from "@/lib/rate-limit-ui";

interface SceneSetupProps {
  characters: CharacterProfile[];
  storyInfo?: StoryInfo | null;
  scene: SceneDefinition;
  onSceneChange: (scene: SceneDefinition) => void;
  onStartSimulation: (scene: SceneDefinition) => void;
  disabled: boolean;
  /** Cached recommendations from parent — survive step switching */
  cachedRecommendations: Recommendation[] | null;
  onCacheRecommendations: (recs: Recommendation[]) => void;
}

interface Recommendation {
  location: string; timeOfDay: string; weather: string; atmosphere: string;
  initialSituation: string; whyGood: string; suggestedCharacters: string[];
}

export default function SceneSetup({ characters, storyInfo, scene, onSceneChange, onStartSimulation, disabled, cachedRecommendations, onCacheRecommendations }: SceneSetupProps) {
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState("");
  const rateLimitHint = useRateLimitCooldown(recError);
  const recommendations = cachedRecommendations || [];

  const update = (patch: Partial<SceneDefinition>) => onSceneChange({ ...scene, ...patch });
  const updateNarrative = (patch: Partial<SceneDefinition["narrativeStyle"]>) =>
    onSceneChange({ ...scene, narrativeStyle: { ...scene.narrativeStyle, ...patch } });
  const updatePlot = (patch: Partial<SceneDefinition["plot"]>) =>
    onSceneChange({ ...scene, plot: { ...scene.plot, ...patch } });

  const toggleCharacter = (id: string) => {
    onSceneChange({
      ...scene,
      characterIds: scene.characterIds.includes(id)
        ? scene.characterIds.filter((c) => c !== id)
        : [...scene.characterIds, id],
    });
  };

  const applyRecommendation = (rec: Recommendation) => {
    const ids = characters.filter((c) => rec.suggestedCharacters.includes(c.name)).map((c) => c.id);
    onSceneChange({
      ...scene, location: rec.location, timeOfDay: rec.timeOfDay, weather: rec.weather,
      atmosphere: rec.atmosphere, initialSituation: rec.initialSituation,
      characterIds: ids.length > 0 ? ids : scene.characterIds,
    });
  };

  const fetchRecommendations = async () => {
    setRecLoading(true);
    setRecError("");
    try {
      const res = await fetch("/api/scene/recommend", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characters, storyInfo }),
      });
      const data = await res.json();
      if (res.ok) onCacheRecommendations(data.recommendations || []);
      else setRecError(data.error || "生成失败");
    } catch { setRecError("网络错误"); } finally { setRecLoading(false); }
  };

  const canStart = scene.location.trim() && scene.initialSituation.trim() && scene.characterIds.length > 0 && !disabled;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Clapperboard className="w-5 h-5 text-primary" />
        <h2 className="text-xl font-semibold">第三步：场景设置</h2>
      </div>

      {/* AI 推荐 */}
      <div>
        <button className="flex items-center gap-2 px-4 py-2 border rounded-md text-sm hover:bg-secondary disabled:opacity-50"
          onClick={fetchRecommendations} disabled={recLoading}>
          {recLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {recLoading ? "生成中..." : "AI 推荐场景"}
        </button>
        {recError && (
          <p className={`text-xs mt-1 ${rateLimitHint ? "text-amber-600" : "text-destructive"}`}>
            {rateLimitHint || recError}
          </p>
        )}
        {recommendations.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            {recommendations.map((rec, i) => (
              <button key={i} className="p-3 border rounded-lg text-left hover:border-primary/50 text-sm"
                onClick={() => applyRecommendation(rec)}>
                <p className="font-medium">{rec.location} · {rec.atmosphere}</p>
                <p className="text-muted-foreground text-xs mt-1">{rec.initialSituation}</p>
                <p className="text-primary/60 text-xs mt-1 italic">{rec.whyGood}</p>
                <p className="text-muted-foreground/60 text-xs mt-1">👥 {rec.suggestedCharacters.join(", ")}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">地点</label>
          <input className="w-full px-3 py-2 border rounded-md bg-background" placeholder="例如：小镇边缘的昏暗酒馆"
            value={scene.location} onChange={(e) => update({ location: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">时间</label>
          <select className="w-full px-3 py-2 border rounded-md bg-background"
            value={scene.timeOfDay} onChange={(e) => update({ timeOfDay: e.target.value })}>
            <option value="dawn">黎明</option><option value="morning">早晨</option>
            <option value="afternoon">下午</option><option value="dusk">黄昏</option>
            <option value="night">夜晚</option><option value="midnight">午夜</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">天气</label>
          <select className="w-full px-3 py-2 border rounded-md bg-background"
            value={scene.weather} onChange={(e) => update({ weather: e.target.value })}>
            <option value="clear">晴朗</option><option value="rainy">下雨</option>
            <option value="stormy">暴风雨</option><option value="snowy">下雪</option>
            <option value="foggy">大雾</option><option value="windy">大风</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">氛围</label>
          <select className="w-full px-3 py-2 border rounded-md bg-background"
            value={scene.atmosphere} onChange={(e) => update({ atmosphere: e.target.value })}>
            <option value="tense">紧张</option><option value="romantic">浪漫</option>
            <option value="mysterious">神秘</option><option value="joyful">欢快</option>
            <option value="melancholic">忧伤</option><option value="dangerous">危险</option>
            <option value="peaceful">平静</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">初始情境</label>
        <textarea className="w-full px-3 py-2 border rounded-md bg-background" rows={3}
          placeholder="描述场景开始时的情境..."
          value={scene.initialSituation} onChange={(e) => update({ initialSituation: e.target.value })} />
      </div>

      {/* 模拟模式 */}
      <div className="flex items-center gap-4 p-3 border rounded-lg bg-secondary/20">
        <span className="text-sm font-medium">模拟模式</span>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" name="mode" className="w-4 h-4"
            checked={scene.mode === "director"}
            onChange={() => update({ mode: "director" })} />
          <span className="text-sm">导演模式</span>
          <span className="text-xs text-muted-foreground">导演推进剧情，角色依次回应</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" name="mode" className="w-4 h-4"
            checked={scene.mode === "free"}
            onChange={() => update({ mode: "free" })} />
          <span className="text-sm">自由对话</span>
          <span className="text-xs text-muted-foreground">角色之间直接自由对话</span>
        </label>
      </div>

      {/* 情节结构 */}
      <div className="border-t pt-4">
        <h3 className="text-sm font-medium mb-3">情节结构</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">冲突类型</label>
            <input className="w-full px-3 py-2 border rounded-md bg-background text-sm"
              placeholder="例如：内心挣扎、人物对峙、意外发现"
              value={scene.plot.conflictType} onChange={(e) => updatePlot({ conflictType: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">故事节点</label>
            <select className="w-full px-3 py-2 border rounded-md bg-background text-sm"
              value={scene.plot.storyBeat} onChange={(e) => updatePlot({ storyBeat: e.target.value })}>
              <option value="">--</option>
              <option value="铺垫">铺垫</option><option value="转折">转折</option>
              <option value="高潮">高潮</option><option value="收尾">收尾</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">情感弧线</label>
            <input className="w-full px-3 py-2 border rounded-md bg-background text-sm"
              placeholder="例如：紧张→爆发→缓和"
              value={scene.plot.emotionalArc} onChange={(e) => updatePlot({ emotionalArc: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">赌注</label>
            <input className="w-full px-3 py-2 border rounded-md bg-background text-sm"
              placeholder="角色面临的风险是什么？"
              value={scene.plot.stakes} onChange={(e) => updatePlot({ stakes: e.target.value })} />
          </div>
        </div>
        <div className="mt-2">
          <label className="block text-xs text-muted-foreground mb-1">关键事件</label>
          <input className="w-full px-3 py-2 border rounded-md bg-background text-sm"
            placeholder="本场景应该发生的关键事件"
            value={scene.plot.keyEvent} onChange={(e) => updatePlot({ keyEvent: e.target.value })} />
        </div>
      </div>

      {/* 文风开关 */}
      {storyInfo?.writingStyle?.styleDescription && (
        <div className="flex items-center gap-3 p-3 border rounded-lg bg-secondary/20">
          <input type="checkbox" id="followStyle" className="w-4 h-4"
            checked={scene.narrativeStyle.followOriginalStyle}
            onChange={(e) => updateNarrative({ followOriginalStyle: e.target.checked })} />
          <label htmlFor="followStyle" className="text-sm cursor-pointer">
            遵循原著文风（{storyInfo.writingStyle.genre} · {storyInfo.writingStyle.styleDescription}）
          </label>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-2">出场角色</label>
        <div className="flex flex-wrap gap-2">
          {characters.map((char) => {
            const selected = scene.characterIds.includes(char.id);
            return (
              <button key={char.id}
                className={`px-3 py-1.5 rounded-full text-sm border ${selected ? "bg-primary text-primary-foreground border-primary" : "bg-secondary text-secondary-foreground border-border hover:border-primary/50"}`}
                onClick={() => toggleCharacter(char.id)}>{char.name}</button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">视角</label>
          <select className="w-full px-3 py-2 border rounded-md bg-background text-sm"
            value={scene.narrativeStyle.pointOfView} onChange={(e) => updateNarrative({ pointOfView: e.target.value as any })}>
            <option value="third-person-close">第三人称近视角</option>
            <option value="third-person-omniscient">第三人称全知</option>
            <option value="first-person">第一人称</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">基调</label>
          <select className="w-full px-3 py-2 border rounded-md bg-background text-sm"
            value={scene.narrativeStyle.tone} onChange={(e) => updateNarrative({ tone: e.target.value })}>
            <option value="dramatic">戏剧性</option><option value="dark">黑暗</option>
            <option value="humorous">幽默</option><option value="romantic">浪漫</option>
            <option value="suspenseful">悬疑</option><option value="literary">文学性</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">篇幅</label>
          <select className="w-full px-3 py-2 border rounded-md bg-background text-sm"
            value={scene.narrativeStyle.targetLength} onChange={(e) => updateNarrative({ targetLength: e.target.value as any })}>
            <option value="short">短篇</option><option value="medium">中篇</option>
            <option value="long">长篇</option>
          </select>
        </div>
      </div>

      <button
        className="w-full py-3 bg-primary text-primary-foreground rounded-md font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
        disabled={!canStart} onClick={() => onStartSimulation(scene)}>
        <Play className="w-5 h-5" /> 开始模拟
      </button>
    </div>
  );
}
