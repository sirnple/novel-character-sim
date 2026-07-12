"use client";
import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { CharacterProfile, StoryInfo, ChapterTimeline, CharacterChapterState, Branch } from "@/types";

interface NovelState {
  novelId: string;
  novelTitle: string;
  novelText: string;
  characters: CharacterProfile[];
  storyInfo: StoryInfo | null;
  timeline: ChapterTimeline | null;
  lastChapterStates: CharacterChapterState[];
  branches: Branch[];
  activeBranchId: string;
  sessionNovelText?: string;
  sessionContinueOffset?: number;
  sessionContinueLabel?: string;
  generatedProse?: string;
}

interface NovelContextType extends NovelState {
  setNovel: (data: Partial<NovelState>) => void;
  clearNovel: () => void;
  setCharacters: (chars: CharacterProfile[]) => void;
  setStoryInfo: (info: StoryInfo | null) => void;
  setTimeline: (tl: ChapterTimeline | null) => void;
  setBranches: (b: Branch[]) => void;
  setNovelText: (text: string) => void;
}

const NovelContext = createContext<NovelContextType | null>(null);

const DEFAULT: NovelState = {
  novelId: "",
  novelTitle: "",
  novelText: "",
  characters: [],
  storyInfo: null,
  timeline: null,
  lastChapterStates: [],
  branches: [],
  activeBranchId: "main",
};

export function NovelProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NovelState>(DEFAULT);

  const setNovel = useCallback((data: Partial<NovelState>) => {
    setState(prev => ({ ...prev, ...data }));
  }, []);

  const clearNovel = useCallback(() => setState(DEFAULT), []);

  const setCharacters = useCallback((chars: CharacterProfile[]) => {
    setState(prev => ({ ...prev, characters: chars }));
  }, []);

  const setStoryInfo = useCallback((info: StoryInfo | null) => {
    setState(prev => ({ ...prev, storyInfo: info }));
  }, []);

  const setTimeline = useCallback((tl: ChapterTimeline | null) => {
    setState(prev => ({ ...prev, timeline: tl }));
  }, []);

  const setBranches = useCallback((b: Branch[]) => {
    setState(prev => ({ ...prev, branches: b }));
  }, []);

  const setNovelText = useCallback((text: string) => {
    setState(prev => ({ ...prev, novelText: text }));
  }, []);

  return (
    <NovelContext.Provider value={{ ...state, setNovel, clearNovel, setCharacters, setStoryInfo, setTimeline, setBranches, setNovelText }}>
      {children}
    </NovelContext.Provider>
  );
}

export function useNovel() {
  const ctx = useContext(NovelContext);
  if (!ctx) throw new Error("useNovel must be used within NovelProvider");
  return ctx;
}
