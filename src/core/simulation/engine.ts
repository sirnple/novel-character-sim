import type { CharacterProfile, SceneDefinition, SimulationRound, SimulationState, WritingStyle, ChannelMessage, SceneOutline } from "@/types";
import { generateId } from "@/lib/utils";
import { runDirector, runOutlineWriter, type DirectorDecision } from "./director";
import { runCharacterAgent } from "./character-agent";
import { runRecorder } from "./recorder";
import { ChannelManager } from "./channel";

const HARD_MAX_ROUNDS = 8;

export type SimulationEventCallback = (event: SimulationEvent) => void;

export type SimulationEvent =
  | { type: "round_start"; round: number }
  | { type: "outline"; outline: SceneOutline }
  | { type: "director"; decision: DirectorDecision }
  | { type: "character_responding"; characterName: string }
  | { type: "character_response"; characterName: string; dialogue: string; actions: string; innerThoughts: string; channelId: string }
  | { type: "recording" }
  | { type: "prose"; prose: string }
  | { type: "round_end"; round: number }
  | { type: "scene_end"; fullNovel: string }
  | { type: "error"; message: string };

export class SimulationEngine {
  private state: SimulationState;
  private onEvent: SimulationEventCallback;
  private writingStyle?: WritingStyle;
  private channels: ChannelManager;
  // Temp storage for director scheduling info (used by recorder this round)
  private _lastDirectorSummary = "";
  private _lastDirectorPacing = "";
  private _lastDirectorMood = "";
  private _lastDirectorConflict = 0;
  private _lastDirectorBeat = 0;

  constructor(
    novelTitle: string,
    characters: CharacterProfile[],
    scene: SceneDefinition,
    onEvent: SimulationEventCallback,
    writingStyle?: WritingStyle
  ) {
    this.writingStyle = writingStyle;
    this.onEvent = onEvent;
    this.channels = new ChannelManager();
    this.channels.initFromCharacters(characters);
    this.state = {
      id: generateId(),
      status: "idle",
      novelTitle,
      characters,
      scene,
      rounds: [],
      fullNovelOutput: "",
      createdAt: new Date().toISOString(),
    };
  }

  getState(): SimulationState { return { ...this.state }; }

  async run(existingOutline?: SceneOutline | null): Promise<SimulationState> {
    this.state.status = "running";
    const isFreeMode = this.state.scene.mode === "free";
    const presentChars = this.state.characters.filter((c) => this.state.scene.characterIds.includes(c.id));
    const sceneDesc = this.buildSceneDescription();
    const zh = presentChars.length > 0 && /[一-鿿]/.test(presentChars[0].personality.description);
    let lastTimestamp = 0;

    try {
      // --- Director Mode: Write scene outline first (or reuse cached) ---
      let outline: SceneOutline | null = null;
      if (!isFreeMode) {
        if (existingOutline) {
          outline = existingOutline;
          this.onEvent({ type: "outline", outline });
        } else {
          try {
            this.onEvent({ type: "character_responding", characterName: "导演（编写大纲）" });
            outline = await runOutlineWriter(
              presentChars,
              this.state.scene,
              this.state.fullNovelOutput || undefined
            );
            this.onEvent({ type: "outline", outline });
          } catch (e) {
            // Outline failed — continue without it, director will improvise
            console.warn("[Engine] Outline writer failed, continuing without outline:", e);
          }
        }
      }

      // Dynamic max rounds: follow outline estimate + 2 buffer, capped at 8
      const maxRounds = outline?.estimatedRounds
        ? Math.min(outline.estimatedRounds + 2, HARD_MAX_ROUNDS)
        : HARD_MAX_ROUNDS;

      for (let roundNum = 0; roundNum < maxRounds; roundNum++) {
        this.onEvent({ type: "round_start", round: roundNum + 1 });
        let roundMessages: ChannelMessage[] = [];

        if (isFreeMode) {
          // --- Free Mode ---
          // Characters take turns; each decides which channel to speak on (or pass)
          for (const char of presentChars) {
            this.onEvent({ type: "character_responding", characterName: char.name });

            const visibleChannels = this.channels.getCharChannels(char.id);
            const charMessages = this.channels.getForCharacter(char.id, lastTimestamp);
            const charPrivateMsgs = charMessages.filter((m) => m.channelId !== "public");
            const publicMsgs = charMessages.filter((m) => m.channelId === "public");

            const channelInfo = visibleChannels
              .map((ch) => {
                if (ch.id === "public") return "公共频道（所有人可见）";
                const other = ch.participants.find((p) => p !== char.id);
                const otherChar = presentChars.find((c) => c.id === other);
                return `私信频道 → ${otherChar?.name || other}（只有你俩可见）`;
              })
              .join("\n");

            const fullContext = [
              `公共频道：\n${publicMsgs.slice(-5).map((m) => `[${m.fromCharacterName}]：${m.dialogue}`).join("\n")}`,
              charPrivateMsgs.length > 0 ? `你的私信：\n${charPrivateMsgs.map((m) => `[${m.fromCharacterName} → 你]：${m.dialogue}`).join("\n")}` : "",
            ].filter(Boolean).join("\n\n");

            const response = await runCharacterAgent(
              char, sceneDesc,
              `可用频道：\n${channelInfo}\n\n${fullContext}`,
              charMessages,
              roundMessages
            );

            if (response.dialogue) {
              // Resolve private channel if targeting a specific character
              let chId = "public";
              if (response.channelId !== "public") {
                const target = presentChars.find((c) => c.name === response.channelId || c.name.includes(response.channelId));
                if (target) {
                  const privCh = this.channels.getPrivateChannel(char.id, target.id);
                  chId = privCh ? privCh.id : "public";
                }
              }

              const msg = this.channels.send(char.id, char.name, chId, {
                dialogue: response.dialogue,
                actions: response.actions,
                innerThoughts: response.innerThoughts,
              });
              roundMessages.push(msg);

              this.onEvent({
                type: "character_response",
                characterName: char.name,
                dialogue: response.dialogue,
                actions: response.actions,
                innerThoughts: response.innerThoughts,
                channelId: chId,
              });
            }
          }
        } else {
          // --- Director Mode ---
          const directorDecision = await runDirector(this.state.characters, this.state.scene, this.state.rounds, outline);
          this.onEvent({ type: "director", decision: directorDecision });

          // Build scheduling summary for channel + round record
          const scheduleSummary = zh
            ? `节拍${directorDecision.beatNumber} | 聚焦${directorDecision.focusCharacter} | ${directorDecision.moodTone} | 冲突${directorDecision.conflictIntensity}/10 | ${directorDecision.pacing === "fast" ? "快节奏" : directorDecision.pacing === "slow" ? "慢节奏" : "中速"}`
            : `Beat ${directorDecision.beatNumber} | Focus ${directorDecision.focusCharacter} | ${directorDecision.moodTone} | Conflict ${directorDecision.conflictIntensity}/10 | ${directorDecision.pacing}`;

          this.channels.send("director", "导演", "public", {
            dialogue: `[调度] ${scheduleSummary}`,
            actions: "",
            innerThoughts: "",
          });

          // Store for recorder use
          this._lastDirectorSummary = scheduleSummary;
          this._lastDirectorPacing = directorDecision.pacing;
          this._lastDirectorMood = directorDecision.moodTone;
          this._lastDirectorConflict = directorDecision.conflictIntensity;
          this._lastDirectorBeat = directorDecision.beatNumber;

          const activeNames = directorDecision.activeCharacters;
          for (const char of presentChars) {
            const isActive = activeNames.length === 0 || activeNames.includes(char.name);
            if (!isActive) continue;

            this.onEvent({ type: "character_responding", characterName: char.name });

            const visibleChannels = this.channels.getCharChannels(char.id);
            const charMessages = this.channels.getForCharacter(char.id, lastTimestamp);
            const charPrivateMsgs = charMessages.filter((m) => m.channelId !== "public");
            const publicMsgs = charMessages.filter((m) => m.channelId === "public");

            const channelInfo = visibleChannels
              .map((ch) => {
                if (ch.id === "public") return "公共频道（所有人可见）";
                const other = ch.participants.find((p) => p !== char.id);
                const otherChar = presentChars.find((c) => c.id === other);
                return `私信频道 → ${otherChar?.name || other}（只有你俩可见）`;
              })
              .join("\n");

            const fullContext = [
              `公共频道：\n${publicMsgs.slice(-5).map((m) => `[${m.fromCharacterName}]：${m.dialogue}`).join("\n")}`,
              charPrivateMsgs.length > 0 ? `你的私信：\n${charPrivateMsgs.map((m) => `[${m.fromCharacterName} → 你]：${m.dialogue}`).join("\n")}` : "",
            ].filter(Boolean).join("\n\n");

            const response = await runCharacterAgent(
              char, sceneDesc,
              `可用频道：\n${channelInfo}\n\n${fullContext}`,
              charMessages,
              roundMessages
            );

            if (response.dialogue) {
              let chId = "public";
              if (response.channelId !== "public") {
                const target = presentChars.find((c) => c.name === response.channelId || c.name.includes(response.channelId));
                if (target) {
                  const privCh = this.channels.getPrivateChannel(char.id, target.id);
                  chId = privCh ? privCh.id : "public";
                }
              }

              const msg = this.channels.send(char.id, char.name, chId, {
                dialogue: response.dialogue,
                actions: response.actions,
                innerThoughts: response.innerThoughts,
              });
              roundMessages.push(msg);

              this.onEvent({
                type: "character_response",
                characterName: char.name,
                dialogue: response.dialogue,
                actions: response.actions,
                innerThoughts: response.innerThoughts,
                channelId: chId,
              });
            }
          }

          if (directorDecision.isSceneEnd) break;
        }

        // Writer sees all channels
        this.onEvent({ type: "recording" });
        const allNewMsgs = this.channels.getNewMessages(lastTimestamp);
        lastTimestamp = Date.now();

        const prose = await runRecorder(
          this.state.scene, roundNum + 1,
          allNewMsgs,
          this.state.fullNovelOutput,
          this.writingStyle,
          isFreeMode ? undefined : {
            summary: this._lastDirectorSummary,
            pacing: this._lastDirectorPacing as "fast" | "medium" | "slow",
            mood: this._lastDirectorMood,
            conflict: this._lastDirectorConflict,
            beat: this._lastDirectorBeat,
          }
        );
        this.onEvent({ type: "prose", prose });

        const round: SimulationRound = {
          roundNumber: roundNum + 1,
          directorAction: isFreeMode ? "" : this._lastDirectorSummary,
          channelMessages: allNewMsgs,
          characterResponses: allNewMsgs.map((m) => ({
            characterId: m.fromCharacterId,
            characterName: m.fromCharacterName,
            dialogue: m.dialogue,
            actions: m.actions,
            innerThoughts: m.innerThoughts,
          })),
          proseOutput: prose,
        };
        this.state.rounds.push(round);
        this.state.fullNovelOutput += (this.state.fullNovelOutput ? "\n\n" : "") + prose;
        this.onEvent({ type: "round_end", round: roundNum + 1 });
      }

      this.state.status = "completed";
      this.onEvent({ type: "scene_end", fullNovel: this.state.fullNovelOutput });
    } catch (error) {
      this.state.status = "error";
      this.onEvent({ type: "error", message: error instanceof Error ? error.message : "Unknown error" });
    }

    return this.state;
  }

  private buildSceneDescription(): string {
    const s = this.state.scene;
    return `地点：${s.location}\n时间：${s.timeOfDay}\n天气：${s.weather}\n氛围：${s.atmosphere}\n情境：${s.initialSituation}`;
  }
}
