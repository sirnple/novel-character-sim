# AGENTS.md

This file provides guidance for AI coding agents working with code in this repository.

## Commands

```bash
npm run dev      # Start Next.js dev server on port 3000
npm run build    # Production build (also used to verify type-checking)
npm run lint     # ESLint
npm run start    # Production server
```

## Architecture

This is a **Next.js 14 App Router** web app that extracts characters from novels via LLM, then runs multi-agent simulations where character agents perform scenes.

### Core engine (`src/core/`)

- **`llm/`** — Multi-provider abstraction. `factory.ts` reads env config and instantiates the active provider. `openai.ts` handles OpenAI + DeepSeek (both OpenAI-compatible), `claude.ts` handles Anthropic. Both share `extractJSON()` from `lib/utils.ts` for robust JSON parsing from LLM responses. The retry wrapper in `openai.ts` handles `Premature close` and other network errors with exponential backoff.
- **`parser/`** — TXT chunking with configurable overlap. `buildNovelContext()` selects representative chunks (first, evenly-spaced middle, last).
- **`extractor/`** — `CharacterExtractor` runs 3 passes (list → detail → relationships). Uses `isChinese()` to select zh/en prompts. `StoryExtractor` extracts plot, chapters, world setting. Pass 2 limited to top 5 characters (protagonists/antagonists first) to stay under API timeout.
- **`simulation/`** — `engine.ts` orchestrates Director → Character agents → Recorder rounds. Director advances plot, characters respond in-character, Recorder weaves prose. Up to 10 rounds. `types.ts` holds system prompt builders that embed full character profiles.

### API routes (`src/app/api/`)

| Route | Purpose |
|---|---|
| `novel/parse` | Upload TXT, auto-detect GBK→UTF-8 via `iconv-lite` |
| `characters/extract` | Runs StoryExtractor + CharacterExtractor, caches to SQLite via content fingerprint |
| `characters` | CRUD on character profiles |
| `novels` | List/load/delete saved novels |
| `scene/recommend` | AI-generated scene suggestions based on characters + story |
| `simulation/stream` | SSE endpoint for real-time simulation progress |
| `simulation/start` | Fire-and-forget simulation runner |
| `simulation/save` | Persist completed simulations |

### Persistence (`src/lib/db.ts`)

SQLite via `better-sqlite3` at `data/novels.db`. Tables: `novels`, `story_info`, `characters`, `simulations`. Content-based fingerprint (`novelFingerprint()` in `lib/utils.ts`) ensures same novel text → same cache key. Re-extraction requires explicit `forceRefresh` flag.

### Frontend (`src/app/page.tsx` + `src/components/`)

Single-page app with step flow: Upload → Characters → Scene → Simulation. State lives in `Home` component via `useState`. Components: `NovelUpload`, `CharacterCards` (with cancel), `CharacterEditor` (modal), `StoryInfoPanel`, `RelationshipGraph` (Canvas), `SceneSetup` (with AI recommendations), `SimulationRunner` (SSE live feed + Novel output), `NovelOutput` (with copy/download).

### LLM configuration

Provider selected via `LLM_PROVIDER` in `.env.local`. DeepSeek uses `OpenAIProvider` with `baseURL: https://api.deepseek.com/v1`. OpenCode Go (`LLM_PROVIDER=opencode-go`) uses `OpencodeGoProvider` against `https://opencode.ai/zen/go/v1` (OpenAI-compatible for most models; MiniMax/Qwen via Anthropic Messages). Role models stay on `DEEPSEEK_ANALYSIS_MODEL` / `DEEPSEEK_WRITE_MODEL`; with opencode-go put the OpenCode key in `DEEPSEEK_API_KEY` (or `OPENCODE_API_KEY`).

### Development rules

- All LLM calls must go through `createLLMProvider()` from `llm/factory.ts` — never call the Anthropic/OpenAI SDK directly.
- JSON from LLM responses must use `extractJSON()` from `lib/utils.ts`, not raw `JSON.parse()`. It handles bracket-depth matching, missing commas, markdown fences.
- Keep total extraction under 300s (Node.js HTTP server timeout). Limit context chunks, cap per-pass character count, use `forceRefresh` for re-extraction.
- Match prompts to novel language: use `isChinese()` from `lib/utils.ts` and provide bilingual (zh/en) prompts.
- `novelFingerprint()` serves as the novel's primary key for caching — same content = same ID. Don't use random IDs.
- Frontend is a single-page state machine in `page.tsx`. All shared state (novel, characters, story, scene) lives in `Home`; pass it down as props.
- DB at `data/novels.db` via `better-sqlite3`. Don't delete the `data/` directory.

### Common issues

- **DeepSeek "Premature close"**: Network error, retry logic in `openai.ts` handles it with exponential backoff (3 retries). If persistent, reduce context size in extractor constructor.
- **JSON parse failures**: `extractJSON()` bracket-matching usually covers it. Check server logs for the raw LLM output if a new failure pattern emerges.
- **300s timeout**: Node.js HTTP server has 5-min request timeout. The extractor limits (1-chunk Pass 1, 2-chunk Pass 2, 5-char detail cap) keep total under this.
- **GBK novels**: `novel/parse` route auto-detects garbled UTF-8 and re-decodes via `iconv-lite`. Chinese novels are commonly GBK-encoded.
