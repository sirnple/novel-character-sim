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
  /** Writing: selected style from global library (single) */
  selectedStyleId?: string | null;
  /** Outline: selected idea ids (max 3) */
  selectedIdeaIds?: string[];
  /** Outline agent may auto-pick ideas if none selected */
  autoPickIdeas?: boolean;
}

interface NovelContextType extends NovelState {
  setNovel: (data: Partial<NovelState>) => void;
  clearNovel: () => void;
  setCharacters: (chars: CharacterProfile[]) => void;
  setStoryInfo: (info: StoryInfo | null) => void;
  setTimeline: (tl: ChapterTimeline | null) => void;
  setBranches: (b: Branch[]) => void;
  setActiveBranchId: (id: string | undefined) => void;
  setNovelText: (text: string) => void;
  setSelectedStyleId: (id: string | null) => void;
  setSelectedIdeaIds: (ids: string[]) => void;
  setAutoPickIdeas: (v: boolean) => void;
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
  selectedStyleId: null,
  selectedIdeaIds: [],
  autoPickIdeas: true,
};

export function NovelProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NovelState>(DEFAULT);

  const setNovel = useCallback((data: Partial<NovelState>) => {
    setState(prev => {
      const next = { ...prev, ...data };
      // Switching novel: clear style selection so sidebar defaults to the new book's style
      if (data.novelId && data.novelId !== prev.novelId) {
        next.selectedStyleId = null;
        next.selectedIdeaIds = [];
      }
      return next;
    });
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

  const setActiveBranchId = useCallback((id: string | undefined) => {
    setState(prev => ({ ...prev, activeBranchId: id || "main" }));
  }, []);

  const setNovelText = useCallback((text: string) => {
    setState(prev => ({ ...prev, novelText: text }));
  }, []);

  const setSelectedStyleId = useCallback((id: string | null) => {
    setState(prev => ({ ...prev, selectedStyleId: id }));
  }, []);

  const setSelectedIdeaIds = useCallback((ids: string[]) => {
    setState(prev => ({ ...prev, selectedIdeaIds: ids.slice(0, 3) }));
  }, []);

  const setAutoPickIdeas = useCallback((v: boolean) => {
    setState(prev => ({ ...prev, autoPickIdeas: v }));
  }, []);

  return (
    <NovelContext.Provider value={{
      ...state,
      setNovel, clearNovel, setCharacters, setStoryInfo, setTimeline,
      setBranches, setActiveBranchId, setNovelText,
      setSelectedStyleId, setSelectedIdeaIds, setAutoPickIdeas,
    }}>
      {children}
    </NovelContext.Provider>
  );
}

export function useNovel() {
  const ctx = useContext(NovelContext);
  if (!ctx) throw new Error("useNovel must be used within NovelProvider");
  return ctx;
}
