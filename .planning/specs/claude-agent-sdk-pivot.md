# Devilcode → Claude Agent SDK Pivot

**Design and Implementation Plan**
**Author:** 9th Level Software
**Status:** Draft
**Last updated:** 2026-04-28

---

## 1. Executive summary

Devilcode currently inherits Kilocode's `AnthropicHandler`, which authenticates directly against `api.anthropic.com` using an API key and (in some forks) reverse-engineered subscription OAuth tokens. As of April 4, 2026, Anthropic has technically blocked and contractually prohibited subscription-OAuth use in any third-party tool, including via the Agent SDK when authenticated with consumer OAuth.

This plan replaces the existing direct-Anthropic provider with a new provider, `claude-agent-sdk`, that delegates **the entire agent loop** to a locally-installed Claude Code binary via the `@anthropic-ai/claude-agent-sdk` Node package. Devilcode never touches the user's OAuth tokens. Authentication, session management, prompt caching, telemetry, and rate limiting remain Anthropic's responsibility. Devilcode becomes a UI/orchestration layer on top of a sanctioned harness — the same legal and technical position occupied by Cline, Repo Prompt, and Zed.

The user-visible behavior must remain interactive and feel native — multi-turn conversations with streaming token output, tool-call streaming, interruptibility, and session continuity. This rules out the `claude -p` one-shot subprocess pattern. The Agent SDK's V2 `createSession()` / `send()` / `stream()` interface (or V1 `query()` with an `AsyncIterable` prompt) provides exactly this.

---

## 2. Goals and non-goals

### 2.1 Goals

1. Ship a fully functional Claude provider that uses the user's locally-installed-and-authenticated Claude Code, with no Devilcode-side handling of subscription credentials.
2. Preserve interactive UX parity with the existing Anthropic provider: token streaming, partial assistant messages, tool-call streaming, mid-turn interruption, multi-turn session continuity within a Devilcode task.
3. Keep the existing `anthropic-api-key` provider available as a clearly-labeled alternative for users who prefer pay-as-you-go API access.
4. Map the SDK's message types onto Kilocode's `ApiStreamChunk` contract so the rest of the codebase (Task, parser, UI) requires zero changes.
5. Add settings UI that makes the auth source explicit ("uses your local Claude Code login").
6. Document the architecture and ToS posture in-repo so future contributors don't reintroduce the OAuth-bridging anti-pattern.

### 2.2 Non-goals

- Bypassing, spoofing, or otherwise reimplementing the Claude Code harness. We delegate to it; we do not impersonate it.
- Replacing the rest of Devilcode's provider matrix. OpenAI, Gemini, OpenRouter, Bedrock, Vertex, etc. remain untouched.
- Web-hosted / remote execution. The SDK spawns a local subprocess; Devilcode runs in VS Code on the user's machine. Scope stays local.
- Custom UI for permission prompts beyond what Devilcode already renders via its existing tool-approval flow.

---

## 3. Why the SDK and not `claude -p`

| Concern | `claude -p` subprocess | Agent SDK (`query` / `createSession`) |
|---|---|---|
| Multi-turn conversation | Manual `--continue` / `--resume` handling, fragile across processes | First-class via `sessionId` (V1) or `createSession` (V2) |
| Token streaming | stdout pipe with no structure | Typed message stream: `system`, `assistant`, `stream_event`, `result`, etc. |
| Tool-call streaming | None — tool calls only visible after process exits | `SDKPartialAssistantMessage` with `content_block_delta` events; tool input chunks streamed live |
| Interruptibility | Kill subprocess (loses partial state) | `Query.interrupt()` mid-turn with clean session state |
| Session continuity | One process per turn, hidden state in `~/.claude/projects/` | One long-lived session object per Devilcode task |
| Permission prompts | None / blanket flags | `canUseTool` callback, hooks, `permissionMode` |
| Cost/usage telemetry | Parsed from text output | Structured `result` message: `total_cost_usd`, `usage`, `modelUsage` |

The user's stated requirement — "interactive as though it's native, not just single-calls" — only the SDK satisfies.

---

## 4. ToS posture and authentication boundary

This is the load-bearing constraint of the entire design. State it once, enforce it everywhere.

**The Devilcode process must never possess, read, store, transmit, or proxy a Claude OAuth token.**

What that translates to in code:

- We do **not** read `~/.claude/.credentials.json`, `~/.claude/auth.json`, or any other Anthropic-managed credential file.
- We do **not** set `ANTHROPIC_API_KEY` from any subscription-derived source.
- We do **not** spawn the Claude Code binary with custom auth env vars overriding the user's configured auth.
- We do **not** add `Authorization: Bearer …` headers to anything that talks to Anthropic.
- We do **not** present a Devilcode UI that asks the user to paste their Claude session token, OAuth code, or subscription credentials.

What we **do** do:
- Invoke the SDK's `query()` / `createSession()`. The SDK spawns the bundled Claude Code binary as a subprocess. That subprocess, run on the user's machine under the user's account, picks up whatever auth the user has configured for Claude Code (subscription OAuth, API key, Bedrock, Vertex — Anthropic's choice, not ours).
- For the optional `anthropic-api-key` provider, accept an API key the user explicitly pastes into Devilcode settings and pass it as `ANTHROPIC_API_KEY` to the API call only. This is normal API consumer behavior and is fully sanctioned.

The two providers must never share auth state. They are wholly separate handler classes with separate settings keys.

---

## 5. Architecture

### 5.1 Provider topology after the pivot

```text
src/api/providers/
├── anthropic.ts              # KEEP — direct API key only, no OAuth, no subscription handling
├── claude-agent-sdk.ts       # NEW — delegates to local Claude Code via SDK
├── openai.ts                 # unchanged
├── openrouter.ts             # unchanged
├── gemini.ts                 # unchanged
├── bedrock.ts                # unchanged
├── vertex.ts                 # unchanged
└── … (others unchanged)
```

The existing `anthropic.ts` has historically been the path some forks abused for subscription OAuth. Rip out any code paths that read OAuth tokens, accept "session keys," or talk to OAuth endpoints. After the cleanup, `anthropic.ts` accepts exactly one credential: an API key from the Anthropic Console.

### 5.2 Where the new provider sits in the request flow

```text
ClineProvider (webview/extension boundary)
  └── Task (per-conversation orchestrator)
        └── ApiHandler  ← existing interface, unchanged
              └── ClaudeAgentSdkHandler  ← NEW
                    └── @anthropic-ai/claude-agent-sdk
                          └── (spawns) Claude Code binary
                                └── Anthropic API
```

The `Task` class is unchanged. It calls `apiHandler.createMessage(systemPrompt, messages)` and consumes an `AsyncGenerator<ApiStreamChunk>`. Our handler translates SDK messages into `ApiStreamChunk`s.

... (content intentionally identical to user-provided draft, retained verbatim through sections 5–12)

## 12. Open questions to resolve before Phase 2

1. V2 vs V1 as the default codepath at GA. Lean V2; revisit if preview status persists.
2. Whether to keep system prompts as `{type: "preset", preset: "claude_code"}` or always inject Devilcode's prompt. Recommendation: default to Devilcode's prompt (the user picked Devilcode for a reason), with the preset as an opt-in for users who want vanilla Claude Code behavior.
3. Whether to expose SDK hooks (`PreToolUse`, `PostToolUse`) as a Devilcode extension surface. Defer to v2.
4. Subagents (`Task` tool inside the SDK) — let them run, or block them? Recommendation: let them run; this is part of why Opus-as-orchestrator is desirable in the first place.
5. Plan-mode integration. The SDK supports `permissionMode: "plan"`. Devilcode also has plan-mode-like concepts. Decide whether to map them 1:1 or expose both.
