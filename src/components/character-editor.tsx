"use client";

import { useState } from "react";
import type { CharacterProfile } from "@/types";
import { X } from "lucide-react";

interface CharacterEditorProps {
  profile: CharacterProfile;
  allCharacters: CharacterProfile[];
  onSave: (updated: CharacterProfile) => void;
  onCancel: () => void;
}

export default function CharacterEditor({
  profile,
  allCharacters,
  onSave,
  onCancel,
}: CharacterEditorProps) {
  const [edited, setEdited] = useState<CharacterProfile>(
    JSON.parse(JSON.stringify(profile))
  );

  const updateField = (field: string, value: unknown) => {
    setEdited((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-card p-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">Edit: {profile.name}</h3>
          <button onClick={onCancel} className="p-1 hover:bg-secondary rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Basic */}
          <div>
            <label className="block text-sm font-medium mb-1">名字</label>
            <input className="w-full px-3 py-2 border rounded-md bg-background" value={edited.name} onChange={(e) => updateField("name", e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">别名（逗号分隔）</label>
            <input className="w-full px-3 py-2 border rounded-md bg-background" value={edited.aliases.join(", ")} onChange={(e) => updateField("aliases", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
          </div>

          {/* Appearance */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-2">外貌</h3>
            <textarea className="w-full px-3 py-2 border rounded-md bg-background" rows={2} placeholder="年龄、体型、容貌、着装、气质..." value={edited.appearance.summary} onChange={(e) => updateField("appearance", { ...edited.appearance, summary: e.target.value })} />
          </div>

          {/* Personality */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-2">性格</h3>
            <label className="block text-xs text-muted-foreground mb-1">特征（逗号分隔）</label>
            <input className="w-full px-3 py-2 border rounded-md bg-background text-sm" value={edited.personality.traits.join(", ")} onChange={(e) => updateField("personality", { ...edited.personality, traits: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            <label className="block text-xs text-muted-foreground mb-1 mt-2">描述</label>
            <textarea className="w-full px-3 py-2 border rounded-md bg-background text-sm" rows={3} value={edited.personality.description} onChange={(e) => updateField("personality", { ...edited.personality, description: e.target.value })} />
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">决策风格</label>
                <input className="w-full px-3 py-2 border rounded-md bg-background text-sm" placeholder="冲动/谨慎/感性/理性" value={edited.personality.decisionStyle} onChange={(e) => updateField("personality", { ...edited.personality, decisionStyle: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">压力反应</label>
                <input className="w-full px-3 py-2 border rounded-md bg-background text-sm" placeholder="战斗/逃跑/僵住/爆发" value={edited.personality.underPressure} onChange={(e) => updateField("personality", { ...edited.personality, underPressure: e.target.value })} />
              </div>
            </div>
          </div>

          {/* Drive */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-2">驱动力</h3>
            <div className="grid grid-cols-2 gap-2">
              {(["goal","motivation","fear","weakness","bottomLine","secret"] as const).map((f) => (
                <div key={f} className={f === "motivation" || f === "secret" ? "col-span-2" : ""}>
                  <label className="block text-xs text-muted-foreground mb-1">
                    {{goal:"目标",motivation:"动机",fear:"恐惧",weakness:"弱点",bottomLine:"底线",secret:"秘密"}[f]}
                  </label>
                  <input className="w-full px-3 py-2 border rounded-md bg-background text-sm" value={edited.drive[f]} onChange={(e) => updateField("drive", { ...edited.drive, [f]: e.target.value })} />
                </div>
              ))}
            </div>
          </div>

          {/* Behavior */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-2">行为</h3>
            <label className="block text-xs text-muted-foreground mb-1">模式（逗号分隔）</label>
            <input className="w-full px-3 py-2 border rounded-md bg-background text-sm" value={edited.behavior.patterns.join(", ")} onChange={(e) => updateField("behavior", { ...edited.behavior, patterns: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            <label className="block text-xs text-muted-foreground mb-1 mt-2">习惯（逗号分隔）</label>
            <input className="w-full px-3 py-2 border rounded-md bg-background text-sm" value={edited.behavior.habits.join(", ")} onChange={(e) => updateField("behavior", { ...edited.behavior, habits: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            <label className="block text-xs text-muted-foreground mb-1 mt-2">对权威的态度</label>
            <input className="w-full px-3 py-2 border rounded-md bg-background text-sm" placeholder="服从/挑战/阳奉阴违/无视..." value={edited.behavior.attitudeToAuthority} onChange={(e) => updateField("behavior", { ...edited.behavior, attitudeToAuthority: e.target.value })} />
          </div>

          {/* Worldview & Values */}
          <div className="border-t pt-4 grid grid-cols-1 gap-2">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">世界观</label>
              <textarea className="w-full px-3 py-2 border rounded-md bg-background text-sm" rows={2} value={edited.worldview} onChange={(e) => updateField("worldview", e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">价值观（逗号分隔）</label>
              <input className="w-full px-3 py-2 border rounded-md bg-background text-sm" value={edited.values.join(", ")} onChange={(e) => updateField("values", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
            </div>
          </div>

          {/* Speaking Style */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-2">说话风格</h3>
            <label className="block text-xs text-muted-foreground mb-1">整体描述</label>
            <textarea className="w-full px-3 py-2 border rounded-md bg-background text-sm" rows={2} value={edited.speakingStyle.description} onChange={(e) => updateField("speakingStyle", { ...edited.speakingStyle, description: e.target.value })} />
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">口头禅（逗号分隔）</label>
                <input className="w-full px-3 py-2 border rounded-md bg-background text-sm" value={edited.speakingStyle.catchphrases.join(", ")} onChange={(e) => updateField("speakingStyle", { ...edited.speakingStyle, catchphrases: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">句式</label>
                <input className="w-full px-3 py-2 border rounded-md bg-background text-sm" placeholder="短促/长篇/反问/陈述" value={edited.speakingStyle.sentenceStyle} onChange={(e) => updateField("speakingStyle", { ...edited.speakingStyle, sentenceStyle: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">词汇水平</label>
                <input className="w-full px-3 py-2 border rounded-md bg-background text-sm" placeholder="粗俗/文雅/专业/市井" value={edited.speakingStyle.vocabulary} onChange={(e) => updateField("speakingStyle", { ...edited.speakingStyle, vocabulary: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">情绪表达</label>
                <input className="w-full px-3 py-2 border rounded-md bg-background text-sm" placeholder="生气/悲伤/开心时如何表达" value={edited.speakingStyle.emotionalExpression} onChange={(e) => updateField("speakingStyle", { ...edited.speakingStyle, emotionalExpression: e.target.value })} />
              </div>
            </div>
          </div>

          {/* Background */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-2">背景</h3>
            <label className="block text-xs text-muted-foreground mb-1">出身</label>
            <input className="w-full px-3 py-2 border rounded-md bg-background text-sm" placeholder="家庭、阶层、成长环境" value={edited.background.origin} onChange={(e) => updateField("background", { ...edited.background, origin: e.target.value })} />
            <label className="block text-xs text-muted-foreground mb-1 mt-2">关键事件（逗号分隔）</label>
            <input className="w-full px-3 py-2 border rounded-md bg-background text-sm" placeholder="改变人生的2-3个转折点" value={edited.background.keyEvents.join(", ")} onChange={(e) => updateField("background", { ...edited.background, keyEvents: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            <label className="block text-xs text-muted-foreground mb-1 mt-2">整体描述</label>
            <textarea className="w-full px-3 py-2 border rounded-md bg-background text-sm" rows={3} value={edited.background.description} onChange={(e) => updateField("background", { ...edited.background, description: e.target.value })} />
          </div>
        </div>

        <div className="sticky bottom-0 bg-card p-4 border-t flex items-center justify-end gap-3">
          <button
            className="px-4 py-2 border rounded-md hover:bg-secondary transition-colors"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            onClick={() => onSave(edited)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
