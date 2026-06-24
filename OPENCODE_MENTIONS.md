# OPENCODE_MENTIONS.md — PR #10790 (OpenCode v1.14.42 upstream merge)

## Methodology

Reviewed the new packages introduced by the OpenCode v1.14.42 upstream merge (PR #10790) for user-facing "OpenCode" branding or links to OpenCode web properties. Steps performed:

- Case-insensitive `grep` for `opencode` across `packages/llm/` and `packages/http-recorder/`.
- Inspected `packages/llm/package.json` and `packages/http-recorder/package.json` (name, description, visibility).
- Searched for URLs to `opencode.ai` / `opencode.com` and upstream GitHub orgs.
- Checked `packages/llm/AGENTS.md`, `packages/llm/example/tutorial.ts`, and `.opencode/plugins/tui-smoke.tsx`.
- Distinguished internal/developer references (npm org `@opencode-ai/*`, Effect service identifiers, dev docs, test fixtures) from user-visible strings (error messages, published metadata, end-user docs/links).

**Result: No user-facing OpenCode branding leaks or links to OpenCode web properties were found.** All matches are internal code/dev-doc references that are acceptable for upstream-derived code.

## Findings

All items below are **internal / non-user-facing** and are flagged only for completeness.

1. **npm org name `@opencode-ai/*` in package names and imports** — Internal/acceptable.
   - `packages/llm/package.json` → `"name": "@opencode-ai/llm"`
   - `packages/http-recorder/package.json` → `"name": "@opencode-ai/http-recorder"`
   - `packages/llm/package.json` → dependency `@opencode-ai/http-recorder`
   - Numerous imports in `packages/llm/test/*`, `packages/llm/example/tutorial.ts`, and `.opencode/plugins/tui-smoke.tsx`.
   - **Not user-facing.** Both packages are `"private": true`, so these names are never published to npm and never shown to end users. The `@opencode-ai` org is the upstream dependency namespace and is explicitly acceptable per the review criteria.

2. **Effect service identifiers using `@opencode/...`** — Internal/acceptable.
   - `packages/llm/src/route/transport/websocket.ts` → `"@opencode/LLM/WebSocketExecutor"`
   - `packages/llm/src/route/client.ts` → `"@opencode/LLMClient"`
   - `packages/llm/src/route/executor.ts` → `"@opencode/LLM/RequestExecutor"`
   - `packages/http-recorder/src/cassette.ts` → `"@opencode-ai/http-recorder/Cassette"`
   - **Not user-facing.** These are Effect `Context.Service` tags used for dependency injection identity; they never surface in UI or user-visible error text.

3. **Source-code comment in `packages/llm/src/providers/github-copilot.ts`** — Internal/acceptable.
   - `// GitHub Copilot has no canonical public URL — callers (opencode, etc.) must supply baseURL explicitly.`
   - **Not user-facing.** Developer comment only; "opencode" is cited as an example calling application.

4. **`AGENTS.md` references to `@opencode-ai/llm` / `@opencode-ai/http-recorder`** — Internal/acceptable.
   - `packages/llm/AGENTS.md` contains references to the package names (see finding 1).
   - **Not user-facing.** `AGENTS.md` is a contributor/agent-facing developer guide, not end-user documentation.

5. **Test fixture host `opencode-test.openai.azure.com`** — Internal/acceptable.
   - Appears in `packages/llm/test/` files as a placeholder Azure resource name in test fixtures; never shipped or displayed.

## Non-Findings (confirmed clean)

- **No links to OpenCode web properties.** No occurrences of `opencode.ai`, `opencode.com`, or upstream GitHub org URLs in either new package.
- **No user-facing error messages mentioning OpenCode.** Error strings in `packages/llm/src` contain no OpenCode branding.
- **No published package metadata leak.** Both `package.json` files are `"private": true` with no `description`, `homepage`, `repository`, or `author` fields referencing OpenCode.
- **`packages/llm/example/tutorial.ts`** contains only `@opencode-ai/llm` import paths; no user-facing OpenCode branding in comments or output strings.
- **`.opencode/plugins/tui-smoke.tsx`** contains only the `@opencode-ai/plugin/tui` import; no new user-facing strings mentioning OpenCode.
