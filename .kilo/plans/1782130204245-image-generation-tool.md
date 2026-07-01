# Image Generation Tool — Port from `kilocode-legacy`

Port the legacy `generate_image` tool to the opencode-based CLI as a Kilo-owned tool, gated by an experimental flag. The tool lets the LLM generate or edit images via the Kilo Gateway (or BYO OpenRouter key), writing the result to disk and rendering it inline in the chat.

## Status: IMPLEMENTED

All core tasks are complete. Build artifacts (CLI binary + VSIX) are produced. Remaining items are CI/compliance and manual verification.

## Context

The pre-opencode Kilo (`Kilo-Org/kilocode-legacy`, the Cline/Roo-derived VS Code extension) shipped a `generate_image` native tool with a hardcoded model catalog. It was never ported during the migration to the opencode base. This plan resurrects the feature with a key improvement: **dynamic model discovery from the Kilo Gateway** instead of a static list.

**Current architecture mapping:**
- Kilo tools live in `packages/opencode/src/kilocode/tool/` (no `kilocode_change` markers) and register via `KiloToolRegistry.extra()`.
- `Tool.define(id, Effect.gen(...))` returns `{ description, parameters, execute }`; `execute` returns `{ title, metadata, output, attachments? }`.
- `attachments` is `MessageV2.FilePart[]` — the native mechanism to surface an image inline.
- Config gating uses `experimental.<flag>` in `Config.Info`; Kilo keys need `kilocode_change` markers in shared files.
- The opencode server exposes `/kilo/*` routes via an Effect `HttpApiGroup` in `packages/opencode/src/kilocode/server/httpapi/groups/kilo-gateway.ts` with handlers in `handlers/kilo-gateway.ts`. The VS Code extension fetches these via the local `kilo serve` child process.
- The gateway package (`packages/kilo-gateway`) provides `fetchKiloImageModels()` which calls `https://api.kilo.ai/api/openrouter/models` and filters for `output_modalities.includes("image")`.

## Decisions

1. **Provider routing** — Kilo Gateway default (zero-config for logged-in users) + BYO OpenRouter key fallback (`OPENROUTER_API_KEY` env var).
2. **Result surface** — write image to disk at the LLM-chosen path **and** return a `FilePart` attachment for inline rendering.
3. **Editing** — v1 includes the optional `image` input param (read existing file as raw bytes, base64-encode, send multimodal text+image message).
4. **Gating** — `experimental.image_generation` (off by default), all clients.
5. **API mechanism** — chat-completions with `modalities: ["image", "text"]`.
6. **Model catalog** — **dynamic fetch from Kilo Gateway** (not hardcoded). The tool reads `experimental.image_generation_model` from config as the default; the VS Code settings UI fetches the live list via `/kilo/models/images`. A hardcoded `FALLBACK_IMAGE_MODELS` list is kept for offline/error resilience and test stability. Default model: `google/gemini-2.5-flash-image`.
7. **Permission** — `write` permission for the output file; `assertExternalDirectoryEffect` for input image path traversal protection.

## Completed Tasks

### 1. Tool implementation (Kilo-owned)
- [x] `packages/opencode/src/kilocode/tool/generate-image.ts` — `Tool.define("generate_image")` with params `{ prompt, path, image?, model? }`. Resolves provider via `Auth.Service`, builds chat-completions fetch with `modalities`, parses data-URL response, writes to disk via `AppFileSystem.writeWithDirs`, returns `FilePart` attachment.
- [x] Input image read via `fs/promises.readFile()` (raw bytes, not text-encoding) + `assertExternalDirectoryEffect` path guard.
- [x] Reads `experimental.image_generation_model` config key for default model.
- [x] `packages/opencode/src/kilocode/tool/generate-image.txt` — tool description.

### 2. Gateway model API
- [x] `packages/kilo-gateway/src/api/models.ts` — refactored shared `fetchRawKiloModels()`, added `fetchKiloImageModels()` (inverse filter: keeps only `output_modalities.includes("image")`).
- [x] Exported `fetchKiloImageModels`, `KiloImageModel`, `KiloImageModelsResult` from `packages/kilo-gateway/src/index.ts`.

### 3. Server endpoints (opencode HttpApiGroup)
- [x] `packages/opencode/src/kilocode/server/httpapi/groups/kilo-gateway.ts` — added `GET /kilo/models/images` endpoint + `ImageModel` schema.
- [x] `packages/opencode/src/kilocode/server/httpapi/handlers/kilo-gateway.ts` — added `imageModels` handler calling `fetchKiloImageModels()` with proxy auth.
- [x] `packages/kilo-gateway/src/server/routes.ts` — added `POST /image/generations` Hono route (for standalone gateway usage) + `GET /models/images` route.

### 4. Registry wiring
- [x] `packages/opencode/src/kilocode/tool/registry.ts` — added `GenerateImageTool` to `infos()`, `build()`, `extra()` (gated by `experimental.image_generation`).
- [x] `packages/opencode/src/tool/registry.ts` (shared, `kilocode_change` markers) — added `Auth.Service` dependency + `Auth.defaultLayer` provision.

### 5. Config
- [x] `packages/opencode/src/config/config.ts` (shared, `kilocode_change` markers) — added `image_generation` and `image_generation_model` to the `experimental` struct.

### 6. VS Code extension
- [x] `packages/kilo-vscode/webview-ui/src/types/messages/config.ts` — added `image_generation` + `image_generation_model` to `ExperimentalConfig`.
- [x] `packages/kilo-vscode/webview-ui/src/components/settings/ExperimentalTab.tsx` — Image Generation toggle + conditional model dropdown (fetched live via context).
- [x] `packages/kilo-vscode/webview-ui/src/context/image-models.tsx` — `ImageModelsProvider` context that sends `requestImageModels` and listens for `imageModelsLoaded`.
- [x] `packages/kilo-vscode/webview-ui/src/App.tsx` — registered `ImageModelsProvider` in the provider tree.
- [x] `packages/kilo-vscode/src/image-generation/models.ts` — `fetchImageModels()` helper (calls `/kilo/models/images` via the local connection service).
- [x] `packages/kilo-vscode/src/KiloProvider.ts` — `fetchAndSendImageModels()` handler + `requestImageModels` case + cached message.
- [x] Message types: `RequestImageModelsMessage` (webview→extension) + `ImageModelsLoadedMessage` (extension→webview).
- [x] i18n strings added to all 20 locales (`imageGeneration.*` + `imageGenerationModel.*`).

### 7. Tests (TDD)
- [x] `packages/opencode/test/kilocode/tool/generate-image.test.ts` — 21 tests: response parser (data-URL extraction, format detection, edge cases), provider resolver (kilo-auth/api-key/BYO-key/none/preference), path extension logic, model catalog.
- [x] Updated affected test files for `image` tool field + `Auth.defaultLayer` dependency: `tool-registry-indexing.test.ts`, `tool-registry-indexing-import-failure.test.ts`, `tool-registry-semantic-import-failure.test.ts`, `registry.test.ts`, `prompt.test.ts`, `snapshot-tool-race.test.ts`, `session-compaction-cap.test.ts`, `session-prompt-compaction-safety.test.ts`, `session-prompt-permission-refresh.test.ts`.

### 8. Changeset
- [x] `.changeset/image-generation.md` — `minor` for `kilo-code`.

## Remaining Tasks

### CI / Contributing compliance
- [ ] **SDK regen**: `./script/generate.ts` — the new `/kilo/models/images` endpoint was added to the HttpApiGroup; regenerate SDK types.
- [ ] **Source links**: `bun run script/extract-source-links.ts` — new files under `packages/opencode/src/` and `packages/kilo-vscode/`.
- [ ] **opencode annotation check**: `bun run script/check-opencode-annotations.ts` — verify markers on shared file edits.
- [ ] **Cloud config-schema mirror**: add `image_generation` + `image_generation_model` to `apps/web/src/app/config.json/extras.ts` in the [cloud repo](https://github.com/Kilo-Org/cloud).
- [ ] **Issue-first**: create/link a feature issue in the PR.

### Manual verification (before PR)
- [ ] Confirm the model dropdown populates in VS Code (requires Kilo login + running `kilo serve`).
- [ ] Confirm an actual image generation call succeeds end-to-end (prompt → image file on disk + inline render).
- [ ] Confirm image editing works (input image → transformed output).
- [ ] Confirm the BYO OpenRouter key path works with `OPENROUTER_API_KEY` set.
- [ ] Confirm the tool does NOT appear when the flag is off.
- [ ] Verify TUI behavior: inline image render may degrade to a path note.

## Risks & Assumptions

- **Cloud backend dependency:** The Kilo cloud must support chat-completions-with-modalities at `${KILO_API_BASE}/api/openrouter/chat/completions`. The BYO-OpenRouter-key path works regardless.
- **TUI image rendering:** Unverified whether the TUI renders `FilePart` image attachments inline. The file write + path output guarantees correctness regardless.
- **Cost:** Image generation is a paid external call. The opt-in flag (off by default) is the primary guard.

## Architecture (as implemented)

```
User enables flag (VS Code settings or kilo.json)
    │
    ├── VS Code: toggle writes experimental.image_generation to config
    │           model dropdown fetches GET /kilo/models/images → fetchKiloImageModels()
    │
    └── CLI: reads experimental.image_generation from config

LLM calls generate_image tool
    │
    ├── resolveProvider(): Auth.Service → Kilo token? → Kilo cloud URL
    │                       else OPENROUTER_API_KEY → openrouter.ai URL
    │
    ├── fetch chat-completions with modalities:["image","text"]
    │   (+ optional input image as base64 data URL for editing)
    │
    ├── parse response → choices[0].message.images[0].image_url.url (data URL)
    │
    ├── write image bytes to disk (AppFileSystem.writeWithDirs)
    │
    └── return { output: path, attachments: [FilePart] }
```

## Files Changed

**New files (Kilo-owned):**
| File | Purpose |
|---|---|
| `packages/opencode/src/kilocode/tool/generate-image.ts` | Tool implementation |
| `packages/opencode/src/kilocode/tool/generate-image.txt` | Tool description |
| `packages/opencode/test/kilocode/tool/generate-image.test.ts` | TDD tests (21) |
| `packages/kilo-vscode/src/image-generation/models.ts` | VS Code fetch helper |
| `packages/kilo-vscode/webview-ui/src/context/image-models.tsx` | Image models context provider |
| `.changeset/image-generation.md` | Changeset |

**Shared files (with `kilocode_change` markers):**
| File | Change |
|---|---|
| `packages/opencode/src/config/config.ts` | `image_generation` + `image_generation_model` config keys |
| `packages/opencode/src/tool/registry.ts` | `Auth.Service` dependency + layer |

**Kilo-owned files modified:**
| File | Change |
|---|---|
| `packages/opencode/src/kilocode/tool/registry.ts` | Tool registration + flag gating |
| `packages/opencode/src/kilocode/server/httpapi/groups/kilo-gateway.ts` | `GET /kilo/models/images` endpoint |
| `packages/opencode/src/kilocode/server/httpapi/handlers/kilo-gateway.ts` | `imageModels` handler |
| `packages/kilo-gateway/src/api/models.ts` | `fetchKiloImageModels()` + refactored shared fetch |
| `packages/kilo-gateway/src/server/routes.ts` | Standalone gateway routes |
| `packages/kilo-gateway/src/index.ts` | Exports |
| `packages/kilo-vscode/webview-ui/src/types/messages/config.ts` | Config type |
| `packages/kilo-vscode/webview-ui/src/types/messages/webview-messages.ts` | `RequestImageModelsMessage` |
| `packages/kilo-vscode/webview-ui/src/types/messages/extension-messages.ts` | `ImageModelsLoadedMessage` |
| `packages/kilo-vscode/webview-ui/src/components/settings/ExperimentalTab.tsx` | Toggle + dropdown UI |
| `packages/kilo-vscode/webview-ui/src/App.tsx` | Provider registration |
| `packages/kilo-vscode/src/KiloProvider.ts` | Handler + cache |
| `packages/kilo-vscode/webview-ui/src/i18n/*.ts` | 20 locale files |
| 9 test files | `Auth.defaultLayer` + `image` tool field |
