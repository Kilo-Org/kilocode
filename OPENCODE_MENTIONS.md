# OpenCode Mentions Review

**Verdict: safe after specific fixes.**

## Method

Reviewed PR #12901 at exact head `c69ce6caf638617169509f09e3f5d620eb702146` against merge base `b135b4e10a9028983497bf69cded47b6ce4572ff` and pristine upstream v1.18.0 `32696c425fc0fa1ec285389346cfa1fbe22b670a`. I searched added and current literals across UI, locales, docs/help, package metadata, URLs, config/schema text, generated API, errors, model prompts, and rendered assets. Base-to-head established newly exposed behavior; upstream-to-head distinguished incomplete Kilo adaptation from internal identifiers and genuine OpenCode services.

## Findings

### P2: Muse Spark sessions identify Kilo as OpenCode and use OpenCode docs

- **Location and exact text:** `packages/opencode/src/session/prompt/meta.txt:1,3,10,17` says `You are OpenCode`, directs the model to `identify yourself as OpenCode`, calls Kilo features OpenCode features, and tells it to answer second-person product questions from `https://opencode.ai/docs`. `packages/opencode/src/session/system.ts:14,76` imports and selects that prompt.
- **Exposure:** any model whose API ID contains `muse-spark` receives this system prompt. It directly governs the assistant's displayed identity and where it gets product guidance, so ordinary Kilo questions such as “can you do ...” can produce the wrong product identity, documentation, and feature advice.
- **Provenance:** introduced relative to the Kilo merge base by upstream v1.18.0. The selector and OpenCode text match pristine upstream; head adapted only the feedback repository to `https://github.com/Kilo-Org/kilocode`.
- **Fix:** adapt the prompt through a Kilo-owned prompt or narrow transform: identify the product as Kilo powered by Meta Muse Spark, refer to Kilo features, and use the approved Kilo docs entry point. Preserve the Meta model attribution and already-correct Kilo feedback URL.

### P2: the new translation command is an unadapted OpenCode command and cannot run in this fork

- **Location and exact text:** root `package.json:19` exposes `translate:app`. Its help at `script/translate-app.ts:203-206` prints `Maximum parallel OpenCode runs`, `OpenCode model`, and `without running OpenCode`; errors at `script/translate-app.ts:112,118,122,260` also name OpenCode. It injects `https://opencode.ai/config.json` at line 148 and spawns `opencode` at lines 377, 409, and 470. The model prompt at `script/translate-app.md:17` instructs translators to preserve `OpenCode` exactly.
- **Exposure and proof:** `bun run translate:app -- --help` renders those OpenCode labels. `bun run translate:app -- fr --check` exits 1 immediately because `targetFiles()` still requires removed upstream `packages/app/src/i18n/en.ts`; this Kilo tree has neither `packages/app` nor `packages/desktop`. If targets are repaired, the execution paths still fail because `@kilocode/cli` exposes only `kilo` and `kilocode` (`packages/opencode/package.json:19-22`), no workspace `opencode` shim exists, and `opencode --version` returns `command not found` in the review environment.
- **Provenance:** the command and both script files are new relative to the Kilo merge base and inherited from pristine upstream. Head changed only `OPENCODE_*` environment variables to `KILO_*`; it retained upstream product copy, schema, executable, and app/desktop targets. The default `opencode/gpt-5.5` model is a genuine retained provider ID and is not itself the defect.
- **Fix:** either omit this upstream-only command from the fork merge or adapt it end to end: target only locale packages Kilo ships, invoke `kilo`, use Kilo wording and config schema, and update the translation instruction without rewriting genuine provider IDs or deliberately supported legacy artifacts.

### P3 / human verification: newly tracked media visibly promotes OpenCode Go

- **Location and exact text:** `artifacts/glm52-rise-video/src/flash.tsx:76,180`, `june.tsx:95,139`, `minimax.tsx:77,196`, `novel.tsx:103,129`, `sheep.tsx:107,133`, and `video.tsx:248` render `OPENCODE GO ...` and/or `opencode.ai/data`. The committed `out/june-totals.png` visibly contains `OPENCODE GO · JUNE 2026` and `opencode.ai/data`; five committed MP4s accompany the other compositions.
- **Exposure:** these are publication-ready image/video outputs, not implementation identifiers. They become newly tracked Kilo repository assets in this PR.
- **Provenance:** source and PNG match pristine upstream. The five MP4 blobs differ from pristine upstream while their render sources do not; all six outputs are new relative to the Kilo base. OpenCode Go is a real upstream service, so replacing its name mechanically could misrepresent the underlying statistics.
- **Human verification/fix:** confirm whether Kilo intentionally wants to retain and potentially publish upstream OpenCode Go campaign assets. If not, omit this artifact directory. If the campaign is meant to be Kilo-branded and the data permits that claim, update the source and regenerate every output.

## Notable Non-Findings

- The apparent OpenCode CLI, config, container, and URL tips in `packages/tui/src/feature-plugins/home/tips-view.tsx:168-292` remain inside a block comment. Runtime tips use `KILO_TIPS`, an empty `TIPS`, and one platform shortcut, so those strings are not displayed.
- All 20 changed `packages/ui/src/i18n/*.ts` locale files and `packages/sdk/openapi.json` contain no reviewed OpenCode product/domain/repository literals. No files changed under Kilo docs, VS Code, JetBrains, translated READMEs, or root README.
- The MCP OAuth callback remains visibly Kilo-branded. No newly added OpenCode `User-Agent`, originator, telemetry identity, or MCP client name was found.
- `@opencode-ai/*` private workspace packages/imports, Effect service tags, CSS/storage/keybind IDs, test fixtures, the CodeMode “OpenCode adapter” documentation, and the selectable pre-existing OpenCode theme are implementation or provenance identifiers, not claims that Kilo is OpenCode.
- Legacy `opencode.json`/`.opencode` compatibility references are intentional where supported. `opencode`, `opencode-go`, `OpenCode Zen`, `OpenCode Go`, `OPENCODE_API_KEY`, and `https://opencode.ai/zen...` can legitimately identify retained upstream services; they were not blanket-renamed.

## Commands And Results

- `git rev-parse HEAD` and the live PR API both returned `c69ce6caf638617169509f09e3f5d620eb702146`; `origin/johnnyeric/kilo-opencode-v1.18.0` matched. `git merge-base HEAD b135...` returned the specified base.
- `git ls-remote upstream refs/tags/v1.18.0` and local `v1.18.0^{}` both resolved to `32696c425fc0fa1ec285389346cfa1fbe22b670a`. Merge commit `2847475275e2eb68bdefda2296c38a96c0d76c68` has parents `b135...` and `32696...`.
- `git rev-list --count b135...c69c...` returned `297`; `git diff --shortstat` returned `262 files changed, 169695 insertions(+), 70035 deletions(-)`.
- Targeted `rg`/`git diff` scans found the active Muse prompt, translation command, and media strings above. The same scans returned no matches in changed locales or public OpenAPI and no new protocol identity literals.
- `bun run translate:app -- --help` reproduced the OpenCode help copy. `bun run translate:app -- fr --check` failed on missing `packages/app/src/i18n/en.ts`; `opencode --version` failed with `command not found`.
- The PR API reported `mergeable: true`, head unchanged, and no outstanding or failed check runs at final recheck; GitHub still reported `mergeable_state: blocked`.

## Limitations

- This was a static branding/provenance audit plus safe local command execution. I did not run a live Muse Spark session, use credentials, or open external links.
- I visually verified the committed PNG and traced every composition to source. I confirmed all five MP4s are valid MP4 files but did not inspect them frame by frame, so the source-to-binary visual correspondence remains a human verification item.
- Five unrelated reviewer reports were already untracked in this shared worktree and were left untouched. Only `OPENCODE_MENTIONS.md` was authored; no source, GitHub state, or user data was modified.
