"use client";
import { useSearchParams } from "next/navigation";
import { useNovel } from "@/lib/novel-context";
import WritingWorkspace from "@/components/writing-workspace";
import type { SceneDefinition } from "@/types";
import { useState } from "react";

export default function WritePage() {
  const params = useSearchParams();
  const { novelId, novelTitle, novelText, characters, storyInfo, timeline, lastChapterStates, setNovelText } = useNovel();
  const offset = params.get("offset");
  const label = params.get("label");

  const [scene, setScene] = useState<SceneDefinition>({
    location: "", timeOfDay: "afternoon", weather: "clear", atmosphere: "tense", initialSituation: "", characterIds: characters.map(c => c.id),
    narrativeStyle: { pointOfView: "third-person-close", tone: "dramatic", targetLength: "medium", followOriginalStyle: true },
    plot: { conflictType: "", storyBeat: "", emotionalArc: "", keyEvent: "", stakes: "" }, mode: "director",
  });

  return (
    <div className="h-full">
      <WritingWorkspace
        novelId={novelId}
        novelTitle={novelTitle}
        characters={characters}
        scene={scene}
        onSceneChange={setScene}
        writingStyle={storyInfo?.writingStyle}
        storyInfo={storyInfo}
        onBack={() => window.location.href = `/novel/${novelId}`}
        initialFullNovel={novelText}
        onNovelSaved={setNovelText}
        timeline={timeline}
        lastChapterStates={lastChapterStates}
        presetContinueOffset={offset ? parseInt(offset) : undefined}
        presetContinueLabel={label || undefined}
        onReaderContinueUsed={() => {}}
        onTaskCreated={() => {}}
      />
    </div>
  );
}
