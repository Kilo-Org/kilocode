Splits the 2755-line `webview-ui/src/types/messages.ts` into 14 domain files under `types/messages/` with a barrel index. Type definitions are preserved byte-identically; consumer imports are unchanged thanks to the barrel.

## Context

`webview-ui/src/types/messages.ts` had grown to 2755 lines and was the single shared module for all webview ↔ extension message contracts (~50 import sites across the package). The size made it hard to navigate, review, and reason about ownership of individual message domains. This PR splits it into per-domain files without changing any types or any consumer code.

## Implementation

The original file is replaced by a flat folder `webview-ui/src/types/messages/` containing 13 leaf files plus a barrel `index.ts` that re-exports everything:

- `connection.ts` — `ConnectionState`, `SessionStatus`, `SessionStatusInfo`, `ServerInfo`, `DeviceAuth*`
- `parts.ts` — message `Part` union, `Tool*`, `File*`, `Reasoning*`, `Step*`, `TokenUsage`, `ContextUsage`, `FileAttachment`
- `sessions.ts` — `Message`, `SessionInfo`, `CloudSessionInfo`, `SessionFileDiff`, `MessageLoadMode`
- `permissions.ts` — `Permission*` types
- `questions.ts` — `TodoItem`, `Question*`, `Suggestion*`
- `providers.ts` — `Provider*`, `ProviderModel`, `ModelSelection`
- `agents.ts` — `AgentInfo`, `AgentConfig`, `SkillInfo`, `SlashCommandInfo`
- `config.ts` — `Config` and its sub-configs (`McpConfig`, `CommandConfig`, `SkillsConfig`, …)
- `profile.ts` — `ProfileData`, `KilocodeNotification*`, `KilocodeBalance`
- `agent-manager.ts` — Worktree, PR, run-status, branch-info and other Agent Manager state types
- `migration.ts` — `Migration*`/`Legacy*` types (preserves `// legacy-migration start/end` markers)
- `extension-messages.ts` — every extension→webview `*Message` interface and the `ExtensionMessage` union
- `webview-messages.ts` — every webview→extension `*Request`/`*Message` interface, the `WebviewMessage` union, the `VSCodeAPI` interface, and the `acquireVsCodeApi` global declaration

`index.ts` is a single barrel of `export * from "./<leaf>"` lines, so all existing `import { … } from "../types/messages"` sites continue to resolve unchanged.

Tradeoffs / things to pay attention to:

- **No code changes.** Definitions were moved verbatim. Diff size (≈2.8k insertions / 2.8k deletions) is dominated by the move itself — there is no semantic change to review.
- **Flat hierarchy.** No subfolders. Domain split is by concern, not by direction; bidirectional message types live in `extension-messages.ts` / `webview-messages.ts`.
- **Path depth.** Inside the new folder, relative paths gained one `../` (e.g. `../../../src/shared/stream-messages` → `../../../../src/shared/stream-messages`). One inline `import("../context/worktree-mode").SessionMode` was promoted to a top-level `import type` in `extension-messages.ts`.
- **Static contract tests.** Two unit tests read message types as raw text via `fs.readFileSync` rather than importing them. They were updated to read from the new folder:
  - `tests/unit/message-contract.test.ts` — replaced the `MESSAGES_FILE` constant with `MESSAGES_DIR` plus a small helper that concatenates every `.ts` file in the folder before running the union-extraction regex.
  - `tests/unit/settings-io.test.ts` — points the `Config`-keys drift guard at `messages/config.ts`.

## Screenshots

| before | after |
| ------ | ----- |
| `messages.ts` — 2755 lines, single file | `messages/` — 14 files, largest ≈ 700 lines |

## How to Test

1. Check out the branch and install: `bun install`.
2. Typecheck the whole repo: `bun turbo typecheck` — should be green.
3. Run unit tests from the extension package:
   ```sh
   cd packages/kilo-vscode
   bun run test:unit
   ```
   All tests should pass (1932/1932 on this branch).
4. Run knip to confirm no exports were dropped: `bun run knip` from `packages/kilo-vscode` — clean.
5. Optional smoke test: `bun run extension` and confirm the webview opens, sessions list, and you can send a message — exercises the message-contract end to end.

## Test Report

```
$ bun turbo typecheck
 Tasks:    12 successful, 12 total
Cached:    7 cached, 12 total
  Time:    19.751s

$ cd packages/kilo-vscode && bun run test:unit
 1932 pass
    0 fail
    0 skip

$ bun run knip
✔ No unused exports

$ bun run check-kilocode-change
✔ No `kilocode_change` markers found in disallowed paths
```

## Get in Touch

<!-- Add your Discord handle here if you'd like to chat about this change. -->
