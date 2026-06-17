"use client";

import { useState, useRef, useEffect } from "react";
import type { CharacterProfile, SceneDefinition, StoryInfo } from "@/types";
import NovelUpload from "@/components/novel-upload";
import CharacterCards from "@/components/character-cards";
import RelationshipGraph from "@/components/relationship-graph";
import SceneSetup from "@/components/scene-setup";
import SimulationRunner from "@/components/simulation-runner";
import StoryInfoPanel from "@/components/story-info-panel";
import { novelFingerprint } from "@/lib/utils";
import { BookOpen, Users, Clapperboard, Play, RefreshCw } from "lucide-react";

type AppStep = "upload" | "characters" | "scene" | "simulation";

interface SavedNovel {
  id: string;
  title: string;
  total_length: number;
  created_at: string;
}

export default function Home() {
  const [step, setStep] = useState<AppStep>("upload");
  const [novelTitle, setNovelTitle] = useState("");
  const [novelText, setNovelText] = useState("");
  const [novelPreview, setNovelPreview] = useState("");
  const [novelId, setNovelId] = useState("default");
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [storyInfo, setStoryInfo] = useState<StoryInfo | null>(null);
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [scene, setScene] = useState<SceneDefinition>({
    location: "",
    timeOfDay: "afternoon",
    weather: "clear",
    atmosphere: "tense",
    initialSituation: "",
    characterIds: [],
    narrativeStyle: {
      pointOfView: "third-person-close",
      tone: "dramatic",
      targetLength: "medium",
      followOriginalStyle: true,
    },
    plot: { conflictType: "", storyBeat: "", emotionalArc: "", keyEvent: "", stakes: "" },
    mode: "director",
  });
  const [savedNovels, setSavedNovels] = useState<SavedNovel[]>([]);
  const [simState, setSimState] = useState<{
    novelTitle: string;
    characters: CharacterProfile[];
    scene: SceneDefinition;
    fullNovel: string;
    status: string;
  } | null>(null);

  // Cache AI scene recommendations so they survive step switching
  const [sceneRecommendations, setSceneRecommendations] = useState<{
    key: string; // novelId — invalidate when novel changes
    recommendations: Array<{
      location: string; timeOfDay: string; weather: string; atmosphere: string;
      initialSituation: string; whyGood: string; suggestedCharacters: string[];
    }>;
  } | null>(null);

  // Cache simulation outline so it survives step switching
  const [cachedOutline, setCachedOutline] = useState<{
    key: string; // cache key based on scene — invalidate when scene changes
    outline: import("@/types").SceneOutline;
  } | null>(null);

  // Build a cache key from scene settings
  const outlineCacheKey = `${novelId}|${scene.location}|${scene.initialSituation}|${scene.characterIds.join(",")}|${scene.plot.conflictType}|${scene.plot.keyEvent}`;

  const abortRef = useRef<AbortController | null>(null);

  // Load saved novels on mount
  useEffect(() => {
    fetch("/api/novels")
      .then((r) => r.json())
      .then((d) => setSavedNovels(d.novels || []))
      .catch(() => {});
  }, []);

  const loadNovel = async (id: string) => {
    const res = await fetch(`/api/novels?id=${id}`);
    const data = await res.json();
    if (res.ok) {
      setNovelId(id);
      setNovelTitle(data.title);
      setNovelText(data.text);
      setNovelPreview(data.text.substring(0, 500));
      if (data.storyInfo) setStoryInfo(data.storyInfo);
      if (data.characters?.length) setCharacters(data.characters);
      if (data.characters?.length) setStep("characters");
      else setStep("characters");
    }
  };

  const handleNovelParsed = (title: string, fullText: string, preview: string) => {
    const id = novelFingerprint(fullText);
    setNovelId(id);
    setNovelTitle(title);
    setNovelText(fullText);
    setNovelPreview(preview);
    setCharacters([]);
    setStoryInfo(null);
    setExtractError("");
    setStep("characters");

    // Check if we already have cached results for this novel
    fetch(`/api/novels?id=${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.storyInfo) setStoryInfo(data.storyInfo);
        if (data.characters?.length) setCharacters(data.characters);
      })
      .catch(() => {});
  };

  const handleExtractCharacters = async (text: string, forceRefresh = false) => {
    setExtractLoading(true);
    setExtractError("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/characters/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: novelId, text, forceRefresh }),
        signal: controller.signal,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed");

      setCharacters(data.characters);
      if (data.storyInfo) setStoryInfo(data.storyInfo);
      if (!data.fromCache) {
        // Refresh saved novels list
        fetch("/api/novels")
          .then((r) => r.json())
          .then((d) => setSavedNovels(d.novels || []))
          .catch(() => {});
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setExtractError(e instanceof Error ? e.message : "Failed to extract characters");
    } finally {
      setExtractLoading(false);
      abortRef.current = null;
    }
  };

  const handleCancelExtraction = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setExtractLoading(false);
    }
  };

  const handleStartSimulation = (sceneDef: SceneDefinition) => {
    setScene(sceneDef);
    setSimState(null); // Clear previous simulation results
    setStep("simulation");
  };

  const handleGoToScene = () => {
    // Populate character IDs when entering scene step
    if (scene.characterIds.length === 0 && characters.length > 0) {
      setScene((s) => ({ ...s, characterIds: characters.map((c) => c.id) }));
    }
    setStep("scene");
  };

  const handleSimulationComplete = (fullNovel: string) => {
    setSimState({
      novelTitle,
      characters: characters.filter((c) => scene!.characterIds.includes(c.id)),
      scene: scene!,
      fullNovel,
      status: "completed",
    });
  };

  const canGoToStep = (targetStep: AppStep): boolean => {
    switch (targetStep) {
      case "upload": return true;
      case "characters": return !!novelText;
      case "scene": return characters.length > 0;
      case "simulation": return characters.length > 0 && !!scene && scene.location.trim() !== "";
      default: return false;
    }
  };

  const steps = [
    { key: "upload" as AppStep, label: "上传", icon: <BookOpen className="w-4 h-4" /> },
    { key: "characters" as AppStep, label: "角色", icon: <Users className="w-4 h-4" /> },
    { key: "scene" as AppStep, label: "场景", icon: <Clapperboard className="w-4 h-4" /> },
    { key: "simulation" as AppStep, label: "模拟", icon: <Play className="w-4 h-4" /> },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-foreground mb-2">
          📖 小说角色模拟器
        </h1>
        <p className="text-muted-foreground">
          提取角色，构建角色代理，在自定义场景中进行剧情演绎
        </p>
      </div>

      {/* Saved Novels Quick Load */}
      {step === "upload" && savedNovels.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">📚 已保存的小说</h3>
          <div className="flex flex-wrap gap-2">
            {savedNovels.map((n) => (
              <button
                key={n.id}
                className="px-3 py-1.5 border rounded-lg text-sm hover:bg-secondary transition-colors"
                onClick={() => loadNovel(n.id)}
              >
                {n.title} ({n.total_length.toLocaleString()} chars)
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step Indicator */}
      {step !== "simulation" && (
        <div className="flex items-center justify-center mb-8">
          {steps.map((s, i) => {
            const isActive = step === s.key;
            const isPast = steps.findIndex((st) => st.key === step) > i;
            const clickable = canGoToStep(s.key) || isPast;
            return (
              <div key={s.key} className="flex items-center">
                <button
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors ${
                    isActive ? "bg-primary text-primary-foreground"
                    : isPast ? "bg-secondary text-secondary-foreground cursor-pointer hover:bg-secondary/80"
                    : clickable ? "bg-muted text-muted-foreground cursor-pointer hover:bg-secondary/60"
                    : "bg-muted text-muted-foreground/50"
                  }`}
                  onClick={() => { if (clickable) setStep(s.key); }}
                >
                  {s.icon} {s.label}
                </button>
                {i < steps.length - 1 && (
                  <div className={`w-8 h-0.5 mx-1 ${isPast ? "bg-primary" : "bg-border"}`} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Main Content */}
      <div className="bg-card border rounded-xl shadow-sm p-6">
        {step === "upload" && (
          <div className="space-y-4">
            <NovelUpload onParsed={handleNovelParsed} />
            {novelText && (
              <div className="p-4 border rounded-lg bg-secondary/30">
                <p className="text-sm text-muted-foreground">
                  📄 当前加载：<span className="font-medium text-foreground">{novelTitle}</span>{" "}
                  ({novelText.length.toLocaleString()} characters)
                </p>
                <button
                  className="mt-2 px-4 py-1.5 bg-primary text-primary-foreground rounded-md text-sm"
                  onClick={() => setStep("characters")}
                >
                  Continue to Character Extraction →
                </button>
              </div>
            )}
          </div>
        )}

        {step === "characters" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>📄 {novelTitle} ({novelText.length.toLocaleString()} chars)</span>
              <div className="flex gap-2">
                <button className="px-3 py-1 border rounded-md text-sm hover:bg-secondary transition-colors" onClick={() => setStep("upload")}>← 返回上传</button>
                {characters.length > 0 && (
                  <button
                    className="text-primary hover:underline flex items-center gap-1"
                    onClick={() => handleExtractCharacters(novelText, true)}
                  >
                    <RefreshCw className="w-3 h-3" /> 重新提取
                  </button>
                )}
              </div>
            </div>

            <CharacterCards
              characters={characters}
              loading={extractLoading}
              error={extractError}
              onExtract={(t) => handleExtractCharacters(t, false)}
              onCancelExtraction={handleCancelExtraction}
              onUpdate={setCharacters}
              novelText={novelText}
            />

            {storyInfo && <StoryInfoPanel storyInfo={storyInfo} />}
            {characters.length > 1 && <RelationshipGraph characters={characters} />}

            {characters.length > 0 && (
              <div className="sticky bottom-4 flex justify-end z-10">
                <button
                  className="px-8 py-3 bg-primary text-primary-foreground rounded-lg shadow-lg hover:bg-primary/90 transition-colors font-semibold"
                  onClick={handleGoToScene}
                >
                  进入场景设置 →
                </button>
              </div>
            )}
          </div>
        )}

        {step === "scene" && (
          <div className="space-y-6">
            <div className="text-sm text-muted-foreground flex justify-between">
              <span>👥 {characters.length} 个角色已就绪</span>
              <button className="px-3 py-1 border rounded-md text-sm hover:bg-secondary transition-colors" onClick={() => setStep("characters")}>← 返回角色</button>
            </div>
            <SceneSetup
              characters={characters}
              storyInfo={storyInfo}
              scene={scene}
              onSceneChange={setScene}
              onStartSimulation={handleStartSimulation}
              disabled={characters.length === 0}
              cachedRecommendations={sceneRecommendations?.key === novelId ? sceneRecommendations.recommendations : null}
              onCacheRecommendations={(recs) => setSceneRecommendations({ key: novelId, recommendations: recs })}
            />
          </div>
        )}

        {step === "simulation" && scene && (
          <SimulationRunner
            novelTitle={novelTitle}
            characters={characters.filter((c) => scene.characterIds.includes(c.id))}
            scene={scene}
            writingStyle={storyInfo?.writingStyle}
            onBack={() => setStep("scene")}
            onComplete={handleSimulationComplete}
            initialFullNovel={simState?.fullNovel}
            cachedOutline={cachedOutline?.key === outlineCacheKey ? cachedOutline.outline : null}
            onCacheOutline={(outline) => setCachedOutline({ key: outlineCacheKey, outline })}
          />
        )}
      </div>
    </div>
  );
}
