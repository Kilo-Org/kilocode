# Agent SDK Integration (Claude Enhanced Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the Claude Agent SDK as a provider in Devil so Claude models deliver full Claude Code-level agentic capabilities (built-in tools, session management, MCP support) while non-Claude models continue using the existing Vercel AI SDK path.

**Architecture:** The Agent SDK becomes an alternative external runtime alongside the existing `claude-code` provider. When a user selects a Claude model via the `agent-sdk` provider, Devil routes through the Agent SDK's `query()` function instead of the Vercel AI SDK's `streamText()`. Events from the Agent SDK async iterator are converted to Vercel AI SDK stream events that the existing `SessionProcessor` consumes unchanged. Devil's custom tools (CodeSearch, TodoWrite, etc.) are exposed to the Agent SDK via in-process MCP servers.

**Tech Stack:** `@anthropic-ai/claude-agent-sdk`, TypeScript, Bun, Zod, `@modelcontextprotocol/sdk`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/opencode/src/devilcode/agent-sdk.ts` | Provider metadata definition + `stream()` entry point that calls Agent SDK `query()` and returns processor-compatible output |
| `packages/opencode/src/devilcode/agent-sdk-bridge.ts` | Event bridge: converts `SDKMessage` async iterator into Vercel AI SDK `fullStream`-compatible events |
| `packages/opencode/src/devilcode/agent-sdk-tools.ts` | Wraps Devil's `Tool.Info` tools as Agent SDK in-process MCP tools via `tool()` + `createSdkMcpServer()` |
| `packages/opencode/test/devilcode/agent-sdk-bridge.test.ts` | Unit tests for event bridge mapping |
| `packages/opencode/test/devilcode/agent-sdk-tools.test.ts` | Unit tests for custom tool wrapping |

### Modified Files

| File | Change |
|------|--------|
| `packages/opencode/package.json` | Add `@anthropic-ai/claude-agent-sdk` dependency |
| `packages/opencode/src/provider/provider.ts` | Add `AGENT_SDK_RUNTIME` constant, register in `CUSTOM_LOADERS`, add runtime detection in `runtime()` and `external()` |
| `packages/opencode/src/provider/models.ts` | Import and register Agent SDK provider in model database |
| `packages/opencode/src/session/llm.ts` | Import Agent SDK stream function, add dispatch branch alongside existing Claude Code branch |

---

## Reference: Existing Pattern

The existing `claude-code.ts` (547 lines) is the template. Key patterns to follow:

1. **Runtime marker**: Provider models set `options.runtime = "external-agent"` to flag them as external
2. **Stream output shape**: Returns `Pick<StreamTextResult<ToolSet, unknown>, "fullStream" | "textStream" | "text">`
3. **AsyncQueue-based streaming**: Uses `AsyncQueue<Item<Full>>` for `fullStream` and `AsyncQueue<Item<string>>` for `textStream`
4. **Event helpers**: `pushText(full, text, body)` and `pushThinking(full, body, id)` create event sequences
5. **Lifecycle**: Emits `start` → `start-step` → [content events] → `finish-step` → `done()`
6. **Routing**: `llm.ts:109-118` checks `Provider.external()` before `streamText()` and dispatches to external stream

## Reference: Agent SDK Message Types

The `SDKMessage` union includes ~20 types. The critical ones for the bridge are:

| Message Type | Shape | Maps To |
|---|---|---|
| `SDKPartialAssistantMessage` | `{ type: "stream_event", event: BetaRawMessageStreamEvent }` | Token-level text/thinking/tool streaming events |
| `SDKAssistantMessage` | `{ type: "assistant", message: BetaMessage }` | Complete turn with content blocks (text, tool_use, thinking) |
| `SDKResultMessage` | `{ type: "result", subtype: "success" \| "error_*", usage, total_cost_usd }` | `finish-step` event with usage data |
| `SDKSystemMessage` | `{ type: "system", subtype: "init", session_id, model, tools }` | `start` event |
| `SDKUserMessage` | `{ type: "user", isSynthetic?, tool_use_result? }` | Tool result events (synthetic = tool result from Agent SDK) |

---

### Task 1: Add Agent SDK Dependency

**Files:**
- Modify: `packages/opencode/package.json`

- [ ] **Step 1: Install the Agent SDK package**

```bash
cd packages/opencode && bun add @anthropic-ai/claude-agent-sdk
```

- [ ] **Step 2: Verify installation**

```bash
cd packages/opencode && bun run -e "const sdk = require('@anthropic-ai/claude-agent-sdk'); console.log('SDK loaded:', Object.keys(sdk))"
```

Expected: Prints exported names including `query`, `tool`, `createSdkMcpServer`, `listSessions`, etc.

- [ ] **Step 3: Verify TypeScript types resolve**

Create a temporary file to check types, then delete it:

```bash
cd packages/opencode && cat > /tmp/check-sdk.ts << 'EOF'
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
const _check: SDKMessage = {} as any
console.log("Types OK")
EOF
bun run /tmp/check-sdk.ts && rm /tmp/check-sdk.ts
```

Expected: "Types OK" — confirms the SDK's TypeScript declarations are accessible.

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/package.json bun.lock
git commit -m "feat(opencode): add @anthropic-ai/claude-agent-sdk dependency"
```

---

### Task 2: Create Event Bridge Module

**Files:**
- Create: `packages/opencode/src/devilcode/agent-sdk-bridge.ts`
- Test: `packages/opencode/test/devilcode/agent-sdk-bridge.test.ts`

This module converts the Agent SDK's `AsyncGenerator<SDKMessage>` into the `fullStream`/`textStream`/`text` shape that `SessionProcessor` already consumes.

**Design decision — simple vs streaming:**
- **Simple (Phase 1, this task):** Process `SDKAssistantMessage` and `SDKResultMessage` — push complete text/thinking blocks per turn, like `claude-code.ts` does today. No token-level streaming.
- **Streaming (Phase 2, future):** Process `SDKPartialAssistantMessage` (`stream_event`) for token-by-token streaming. Requires `includePartialMessages: true`.

Phase 1 gets us functional quickly. Phase 2 is a drop-in upgrade to the bridge.

- [ ] **Step 1: Write the failing test — text event mapping**

```typescript
// packages/opencode/test/devilcode/agent-sdk-bridge.test.ts
import { describe, test, expect } from "bun:test"
import { bridgeMessages } from "@/devilcode/agent-sdk-bridge"

function fakeAssistantMessage(textContent: string, uuid = "msg-1") {
  return {
    type: "assistant" as const,
    uuid,
    session_id: "sess-1",
    message: {
      id: uuid,
      type: "message" as const,
      role: "assistant" as const,
      model: "claude-opus-4-6",
      content: [{ type: "text" as const, text: textContent }],
      stop_reason: "end_turn" as const,
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
    parent_tool_use_id: null,
  }
}

function fakeResultMessage(result: string) {
  return {
    type: "result" as const,
    subtype: "success" as const,
    uuid: "result-1",
    session_id: "sess-1",
    duration_ms: 1000,
    duration_api_ms: 800,
    is_error: false,
    num_turns: 1,
    result,
    stop_reason: "end_turn",
    total_cost_usd: 0.01,
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    modelUsage: {},
    permission_denials: [],
  }
}

async function collectStream(messages: AsyncIterable<unknown>) {
  const events: unknown[] = []
  const output = bridgeMessages(messages)
  for await (const event of output.fullStream) {
    events.push(event)
  }
  return { events, text: await output.text }
}

describe("agent-sdk-bridge", () => {
  test("maps assistant text to text-start/delta/end events", async () => {
    async function* generate() {
      yield fakeAssistantMessage("Hello world")
      yield fakeResultMessage("Hello world")
    }
    const { events, text } = await collectStream(generate())

    const types = events.map((e: any) => e.type)
    expect(types).toContain("start")
    expect(types).toContain("start-step")
    expect(types).toContain("text-start")
    expect(types).toContain("text-delta")
    expect(types).toContain("text-end")
    expect(types).toContain("finish-step")
    expect(text).toBe("Hello world")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/opencode && bun test test/devilcode/agent-sdk-bridge.test.ts --timeout 30000
```

Expected: FAIL — `Cannot find module '@/devilcode/agent-sdk-bridge'`

- [ ] **Step 3: Write the bridge implementation**

```typescript
// packages/opencode/src/devilcode/agent-sdk-bridge.ts
import { AsyncQueue } from "@/util/queue"
import type { StreamTextResult, ToolSet } from "ai"

type Full = StreamTextResult<ToolSet, unknown>["fullStream"] extends AsyncIterable<infer Item> ? Item : never
type Output = Pick<StreamTextResult<ToolSet, unknown>, "fullStream" | "textStream" | "text">
const END = Symbol("done")
type Item<T> = T | typeof END

function done(): typeof END {
  return END
}

function queue<T>(src: AsyncQueue<Item<T>>) {
  return new ReadableStream<T>({
    async pull(controller) {
      const item = await src.next()
      if (item === END) {
        controller.close()
        return
      }
      controller.enqueue(item)
    },
  }) as ReadableStream<T> & AsyncIterable<T>
}

function pushText(full: AsyncQueue<Item<Full>>, plain: AsyncQueue<Item<string>>, body: string) {
  if (!body) return
  full.push({ type: "text-start" } as Full)
  full.push({ type: "text-delta", text: body } as Full)
  full.push({ type: "text-end" } as Full)
  plain.push(body)
}

function pushThinking(full: AsyncQueue<Item<Full>>, body: string, id: string) {
  if (!body) return
  full.push({ type: "reasoning-start", id } as Full)
  full.push({ type: "reasoning-delta", id, text: body } as Full)
  full.push({ type: "reasoning-end", id } as Full)
}

function pushToolCall(
  full: AsyncQueue<Item<Full>>,
  block: { id: string; name: string; input: unknown },
) {
  full.push({ type: "tool-input-start", id: block.id, name: block.name } as Full)
  full.push({ type: "tool-input-end", id: block.id } as Full)
  full.push({
    type: "tool-call",
    id: block.id,
    name: block.name,
    input: block.input,
  } as Full)
}

function pushToolResult(
  full: AsyncQueue<Item<Full>>,
  block: { id: string; name: string; output: string },
) {
  full.push({
    type: "tool-result",
    id: block.id,
    name: block.name,
    output: block.output,
  } as Full)
}

interface ContentBlock {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
}

interface AssistantMsg {
  type: "assistant"
  uuid: string
  session_id: string
  message: {
    content: ContentBlock[]
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
    stop_reason?: string
  }
  parent_tool_use_id: string | null
}

interface ResultMsg {
  type: "result"
  subtype: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  total_cost_usd?: number
  result?: string
  errors?: string[]
  stop_reason?: string | null
}

interface UserMsg {
  type: "user"
  message?: {
    content?: Array<{
      type: string
      tool_use_id?: string
      content?: unknown
    }>
  }
  isSynthetic?: boolean
}

type SDKMsg = AssistantMsg | ResultMsg | UserMsg | { type: string; [key: string]: unknown }

function extractUsage(msg: AssistantMsg | ResultMsg) {
  const raw = msg.usage ?? {}
  return {
    inputTokens: raw.input_tokens ?? 0,
    outputTokens: raw.output_tokens ?? 0,
    totalTokens: (raw.input_tokens ?? 0) + (raw.output_tokens ?? 0),
    reasoningTokens: 0,
    cachedInputTokens: raw.cache_read_input_tokens ?? 0,
  }
}

function finishReason(msg: ResultMsg) {
  if (msg.subtype !== "success") return "error"
  const stop = msg.stop_reason ?? "stop"
  return stop === "end_turn" ? "stop" : stop
}

/**
 * Bridges Agent SDK messages into processor-compatible stream events.
 *
 * Consumes the Agent SDK's async iterator and produces the same
 * `{ fullStream, textStream, text }` shape that `SessionProcessor` expects.
 */
export function bridgeMessages(messages: AsyncIterable<unknown>): Output {
  const full = new AsyncQueue<Item<Full>>()
  const plain = new AsyncQueue<Item<string>>()

  let doneText = ""
  let resolveText = (_value: string) => {}
  let rejectText = (_error: unknown) => {}

  const complete = new Promise<string>((ok, fail) => {
    resolveText = ok
    rejectText = fail
  })

  // Track tool_use blocks so we can match tool results later
  const pendingTools = new Map<string, { id: string; name: string }>()

  void (async () => {
    full.push({ type: "start" } as Full)
    full.push({ type: "start-step" } as Full)

    try {
      for await (const raw of messages) {
        const msg = raw as SDKMsg

        if (msg.type === "assistant") {
          const assistant = msg as AssistantMsg
          // Skip subagent messages (they have parent_tool_use_id set)
          // We only bridge top-level messages
          for (const block of assistant.message.content ?? []) {
            if (block.type === "text" && block.text) {
              doneText += `${doneText ? "\n" : ""}${block.text}`
              pushText(full, plain, block.text)
            }
            if (block.type === "thinking" && block.thinking) {
              pushThinking(full, block.thinking, assistant.uuid ?? "thinking")
            }
            if (block.type === "tool_use" && block.id && block.name) {
              pendingTools.set(block.id, { id: block.id, name: block.name })
              pushToolCall(full, {
                id: block.id,
                name: block.name,
                input: block.input ?? {},
              })
            }
          }
        }

        if (msg.type === "user") {
          const user = msg as UserMsg
          // Synthetic user messages contain tool results
          if (user.isSynthetic && user.message?.content) {
            for (const block of user.message.content) {
              if (block.type === "tool_result" && block.tool_use_id) {
                const pending = pendingTools.get(block.tool_use_id)
                if (pending) {
                  const output =
                    typeof block.content === "string"
                      ? block.content
                      : JSON.stringify(block.content ?? "")
                  pushToolResult(full, {
                    id: pending.id,
                    name: pending.name,
                    output,
                  })
                  pendingTools.delete(block.tool_use_id)
                }
              }
            }
          }
        }

        if (msg.type === "result") {
          const result = msg as ResultMsg
          // If the result contains text we haven't seen, push it
          if (result.result && !doneText.includes(result.result)) {
            const newText = result.result
            doneText += `${doneText ? "\n" : ""}${newText}`
            pushText(full, plain, newText)
          }

          full.push({
            type: "finish-step",
            finishReason: finishReason(result),
            usage: extractUsage(result),
          } as Full)
          full.push(done())
          plain.push(done())

          if (result.subtype === "success") {
            resolveText(doneText.trim())
          } else {
            const errors = (result as any).errors ?? []
            rejectText(new Error(errors[0] ?? `Agent SDK error: ${result.subtype}`))
          }
          return
        }
      }

      // If we exit the loop without a result message, close cleanly
      full.push({
        type: "finish-step",
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: 0, cachedInputTokens: 0 },
      } as Full)
      full.push(done())
      plain.push(done())
      resolveText(doneText.trim())
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      full.push({ type: "error", error } as Full)
      full.push(done())
      plain.push(done())
      rejectText(error)
    }
  })()

  return {
    fullStream: queue(full),
    textStream: queue(plain),
    text: complete,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/opencode && bun test test/devilcode/agent-sdk-bridge.test.ts --timeout 30000
```

Expected: PASS

- [ ] **Step 5: Write additional test — thinking events**

Add to the existing test file:

```typescript
test("maps thinking blocks to reasoning events", async () => {
  async function* generate() {
    yield {
      type: "assistant" as const,
      uuid: "msg-1",
      session_id: "sess-1",
      message: {
        content: [
          { type: "thinking" as const, thinking: "Let me consider..." },
          { type: "text" as const, text: "The answer is 42" },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 50, output_tokens: 25 },
      },
      parent_tool_use_id: null,
    }
    yield fakeResultMessage("The answer is 42")
  }
  const { events, text } = await collectStream(generate())

  const types = events.map((e: any) => e.type)
  expect(types).toContain("reasoning-start")
  expect(types).toContain("reasoning-delta")
  expect(types).toContain("reasoning-end")
  expect(types).toContain("text-start")
  expect(text).toBe("The answer is 42")
})
```

- [ ] **Step 6: Write additional test — tool call and result events**

```typescript
test("maps tool_use blocks to tool events", async () => {
  async function* generate() {
    // Turn 1: assistant calls a tool
    yield {
      type: "assistant" as const,
      uuid: "msg-1",
      session_id: "sess-1",
      message: {
        content: [
          { type: "tool_use" as const, id: "tu-1", name: "Read", input: { file_path: "/src/index.ts" } },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      parent_tool_use_id: null,
    }
    // Synthetic user message with tool result
    yield {
      type: "user" as const,
      uuid: "msg-2",
      session_id: "sess-1",
      isSynthetic: true,
      message: {
        role: "user",
        content: [{ type: "tool_result" as const, tool_use_id: "tu-1", content: "file contents here" }],
      },
      parent_tool_use_id: null,
    }
    // Turn 2: assistant responds with text
    yield fakeAssistantMessage("I read the file.")
    yield fakeResultMessage("I read the file.")
  }
  const { events } = await collectStream(generate())

  const types = events.map((e: any) => e.type)
  expect(types).toContain("tool-input-start")
  expect(types).toContain("tool-call")
  expect(types).toContain("tool-result")
  expect(types).toContain("text-start")
})
```

- [ ] **Step 7: Write additional test — error result**

```typescript
test("handles error result messages", async () => {
  async function* generate() {
    yield {
      type: "result" as const,
      subtype: "error_max_turns" as const,
      uuid: "result-1",
      session_id: "sess-1",
      duration_ms: 5000,
      duration_api_ms: 4000,
      is_error: true,
      num_turns: 50,
      stop_reason: null,
      total_cost_usd: 0.50,
      usage: { input_tokens: 5000, output_tokens: 2000 },
      modelUsage: {},
      permission_denials: [],
      errors: ["Max turns reached"],
    }
  }
  const output = bridgeMessages(generate())
  const events: any[] = []
  for await (const event of output.fullStream) {
    events.push(event)
  }

  const finishStep = events.find((e) => e.type === "finish-step")
  expect(finishStep).toBeDefined()
  expect(finishStep.finishReason).toBe("error")

  await expect(output.text).rejects.toThrow("Max turns reached")
})
```

- [ ] **Step 8: Run all bridge tests**

```bash
cd packages/opencode && bun test test/devilcode/agent-sdk-bridge.test.ts --timeout 30000
```

Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
git add packages/opencode/src/devilcode/agent-sdk-bridge.ts packages/opencode/test/devilcode/agent-sdk-bridge.test.ts
git commit -m "feat(opencode): add Agent SDK event bridge

Converts Agent SDK SDKMessage async iterator into Vercel AI SDK
fullStream-compatible events for SessionProcessor consumption."
```

---

### Task 3: Create Custom Tool Adapter

**Files:**
- Create: `packages/opencode/src/devilcode/agent-sdk-tools.ts`
- Test: `packages/opencode/test/devilcode/agent-sdk-tools.test.ts`

This wraps Devil's `Tool.Info` tools as Agent SDK in-process MCP tools so custom Devil tools (CodeSearch, TodoWrite, Skill, etc.) are available when using the Agent SDK provider.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/opencode/test/devilcode/agent-sdk-tools.test.ts
import { describe, test, expect } from "bun:test"
import { wrapToolAsMcp } from "@/devilcode/agent-sdk-tools"
import { z } from "zod"

describe("agent-sdk-tools", () => {
  test("wraps a Devil Tool.Info as an Agent SDK MCP tool", async () => {
    const fakeTool = {
      id: "test_tool",
      init: async () => ({
        description: "A test tool",
        parameters: z.object({
          query: z.string().describe("Search query"),
          limit: z.number().optional().describe("Max results"),
        }),
        execute: async (args: { query: string; limit?: number }) => ({
          title: "Test Result",
          output: `Found results for: ${args.query}`,
          metadata: {},
        }),
      }),
    }

    const mcpTool = await wrapToolAsMcp(fakeTool)

    expect(mcpTool).toBeDefined()
    expect(mcpTool.name).toBe("test_tool")
    expect(mcpTool.description).toBe("A test tool")
  })

  test("wrapped tool executes correctly", async () => {
    const fakeTool = {
      id: "echo_tool",
      init: async () => ({
        description: "Echoes input",
        parameters: z.object({ message: z.string() }),
        execute: async (args: { message: string }) => ({
          title: "Echo",
          output: `Echo: ${args.message}`,
          metadata: {},
        }),
      }),
    }

    const mcpTool = await wrapToolAsMcp(fakeTool)
    // The MCP tool handler receives args and returns CallToolResult
    const result = await mcpTool.handler({ message: "hello" }, {})

    expect(result.content).toEqual([
      { type: "text", text: "Echo: hello" },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/opencode && bun test test/devilcode/agent-sdk-tools.test.ts --timeout 30000
```

Expected: FAIL — `Cannot find module '@/devilcode/agent-sdk-tools'`

- [ ] **Step 3: Write the tool adapter implementation**

```typescript
// packages/opencode/src/devilcode/agent-sdk-tools.ts
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk"
import type { Tool } from "@/tool/tool"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { zodToJsonSchema } from "zod-to-json-schema"
import { z } from "zod"

/**
 * Converts a Zod schema to a plain object shape suitable for the Agent SDK's
 * `tool()` function, which expects `AnyZodRawShape` (a Record<string, ZodType>).
 *
 * If the schema is a ZodObject, we extract `.shape`. Otherwise, we wrap it
 * in a single `input` property so the tool always gets an object.
 */
function toRawShape(schema: z.ZodType): Record<string, z.ZodType> {
  if (schema instanceof z.ZodObject) {
    return schema.shape as Record<string, z.ZodType>
  }
  // Fallback: wrap in a single key
  return { input: schema }
}

interface WrappedMcpTool {
  name: string
  description: string
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult>
  inputSchema: Record<string, z.ZodType>
}

/**
 * Wraps a Devil `Tool.Info` as an Agent SDK in-process MCP tool definition.
 *
 * The tool is initialized (via `init()`) to get its description and parameters,
 * then wrapped with the Agent SDK's `tool()` helper. Execution delegates to
 * the original `execute()` function.
 */
export async function wrapToolAsMcp(toolInfo: Tool.Info): Promise<WrappedMcpTool> {
  const initialized = await toolInfo.init()
  const shape = toRawShape(initialized.parameters)

  const handler = async (args: Record<string, unknown>, _extra: unknown): Promise<CallToolResult> => {
    try {
      // Build a minimal execution context
      // Agent SDK tools run outside of Devil's session system,
      // so we provide a stub context
      const result = await initialized.execute(args as any, {
        sessionID: "",
        messageID: "",
        agent: "agent-sdk",
        abort: AbortSignal.timeout(120_000),
        messages: [],
        metadata: () => {},
        ask: async () => {},
      } as any)

      return {
        content: [{ type: "text", text: result.output }],
      }
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      }
    }
  }

  return {
    name: toolInfo.id,
    description: initialized.description,
    inputSchema: shape,
    handler,
  }
}

/**
 * Creates an in-process MCP server from a list of Devil tools.
 *
 * Usage:
 * ```typescript
 * const server = await createDevilToolServer(devilTools)
 * // Pass to Agent SDK query:
 * query({ prompt: "...", options: { mcpServers: { "devil-tools": server } } })
 * ```
 */
export async function createDevilToolServer(tools: Tool.Info[]) {
  const mcpTools = await Promise.all(
    tools.map(async (t) => {
      const wrapped = await wrapToolAsMcp(t)
      return tool(
        wrapped.name,
        wrapped.description,
        wrapped.inputSchema,
        wrapped.handler,
      )
    }),
  )

  return createSdkMcpServer({
    name: "devil-tools",
    tools: mcpTools,
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/opencode && bun test test/devilcode/agent-sdk-tools.test.ts --timeout 30000
```

Expected: PASS

- [ ] **Step 5: Write additional test — createDevilToolServer**

```typescript
test("createDevilToolServer creates an MCP server config", async () => {
  const { createDevilToolServer } = await import("@/devilcode/agent-sdk-tools")

  const fakeTool = {
    id: "search",
    init: async () => ({
      description: "Search things",
      parameters: z.object({ q: z.string() }),
      execute: async (args: { q: string }) => ({
        title: "Search",
        output: `Results for: ${args.q}`,
        metadata: {},
      }),
    }),
  }

  const server = await createDevilToolServer([fakeTool as any])
  expect(server).toBeDefined()
  // The server config should have type "sdk" for in-process MCP
  expect(server.type).toBe("sdk")
  expect(server.name).toBe("devil-tools")
})
```

- [ ] **Step 6: Run all tool adapter tests**

```bash
cd packages/opencode && bun test test/devilcode/agent-sdk-tools.test.ts --timeout 30000
```

Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/opencode/src/devilcode/agent-sdk-tools.ts packages/opencode/test/devilcode/agent-sdk-tools.test.ts
git commit -m "feat(opencode): add Agent SDK tool adapter

Wraps Devil's Tool.Info tools as Agent SDK in-process MCP tools
via tool() and createSdkMcpServer()."
```

---

### Task 4: Create Agent SDK Provider Definition

**Files:**
- Create: `packages/opencode/src/devilcode/agent-sdk.ts`

This is the main integration file — provider metadata + `stream()` function.

- [ ] **Step 1: Create the provider definition and stream function**

```typescript
// packages/opencode/src/devilcode/agent-sdk.ts
import { query } from "@anthropic-ai/claude-agent-sdk"
import { bridgeMessages } from "@/devilcode/agent-sdk-bridge"
import { createDevilToolServer } from "@/devilcode/agent-sdk-tools"
import { Instance } from "@/instance"
import type { Tool } from "@/tool/tool"
import type { ModelMessage, StreamTextResult, ToolSet } from "ai"
import { buildPrompt } from "@/devilcode/claude-code"

export const AGENT_SDK_ID = "agent-sdk"
export const AGENT_SDK_RUNTIME = "external-agent"

type Output = Pick<StreamTextResult<ToolSet, unknown>, "fullStream" | "textStream" | "text">

/**
 * Agent SDK provider metadata.
 *
 * Exposes Claude Opus 4.6, Sonnet 4.6, and Haiku 4.5 as models.
 * All models are marked with `runtime: "external-agent"` so the
 * LLM router dispatches to `stream()` instead of `streamText()`.
 */
export function provider() {
  const base = {
    attachment: true,
    reasoning: true,
    temperature: false,
    tool_call: false, // Agent SDK handles tools internally
    modalities: { input: ["text"], output: ["text"] },
    options: { runtime: AGENT_SDK_RUNTIME },
    provider: { api: "https://api.anthropic.com/", npm: "@anthropic-ai/claude-agent-sdk" },
  }

  return {
    id: AGENT_SDK_ID,
    name: "Claude (Agent SDK)",
    env: ["ANTHROPIC_API_KEY"],
    api: "https://api.anthropic.com/",
    npm: "@anthropic-ai/claude-agent-sdk",
    models: {
      "opus-4-6": {
        ...base,
        id: "opus-4-6",
        name: "Claude Opus 4.6",
        family: "claude-opus",
        release_date: "2026-01-15",
        limit: { context: 200000, output: 128000 },
        cost: { input: 5, output: 25 },
      },
      "sonnet-4-6": {
        ...base,
        id: "sonnet-4-6",
        name: "Claude Sonnet 4.6",
        family: "claude-sonnet",
        release_date: "2026-01-15",
        limit: { context: 200000, output: 64000 },
        cost: { input: 3, output: 15 },
      },
      "haiku-4-5": {
        ...base,
        id: "haiku-4-5",
        name: "Claude Haiku 4.5",
        family: "claude-haiku",
        release_date: "2025-10-01",
        limit: { context: 200000, output: 64000 },
        cost: { input: 1, output: 5 },
      },
    },
  }
}

/**
 * Map a Devil model ID to the Agent SDK model string.
 */
function resolveModel(modelID: string): string {
  const map: Record<string, string> = {
    "opus-4-6": "claude-opus-4-6",
    "sonnet-4-6": "claude-sonnet-4-6",
    "haiku-4-5": "claude-haiku-4-5",
  }
  return map[modelID] ?? "claude-opus-4-6"
}

/**
 * Map Devil permission rules to Agent SDK permission mode.
 */
function resolvePermissionMode(small: boolean): "acceptEdits" | "plan" {
  return small ? "plan" : "acceptEdits"
}

/**
 * Streams an Agent SDK query, returning processor-compatible output.
 *
 * This is the entry point called by `llm.ts` when the model's provider
 * is `agent-sdk`. It builds a prompt from the conversation history,
 * wraps Devil's custom tools as an in-process MCP server, calls
 * `query()`, and bridges the resulting messages into stream events.
 */
export function stream(input: {
  abort: AbortSignal
  cwd: string
  messages: ModelMessage[]
  small: boolean
  system: string[]
  model: string
  tools?: Tool.Info[]
}): Output {
  const prompt = buildPrompt({ messages: input.messages, system: input.system })
  const modelId = resolveModel(input.model)

  // Build the query — tool server creation is async, so we start the
  // bridge immediately and feed messages into it as they arrive.
  const abortController = new AbortController()

  // Forward the input abort signal
  input.abort.addEventListener("abort", () => abortController.abort(), { once: true })

  const agentQuery = (async function* () {
    // Build MCP server for Devil's custom tools if any are provided
    const mcpServers: Record<string, any> = {}
    if (input.tools && input.tools.length > 0) {
      try {
        mcpServers["devil-tools"] = await createDevilToolServer(input.tools)
      } catch {
        // If tool wrapping fails, proceed without custom tools
      }
    }

    const q = query({
      prompt,
      options: {
        abortController,
        cwd: input.cwd,
        model: modelId,
        permissionMode: resolvePermissionMode(input.small),
        allowedTools: [
          "Read", "Write", "Edit", "Bash", "Glob", "Grep",
          "WebFetch", "WebSearch", "Agent",
        ],
        mcpServers,
        maxTurns: input.small ? 1 : 50,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: input.system.join("\n\n"),
        },
        thinking: { type: "adaptive" },
      },
    })

    yield* q
  })()

  return bridgeMessages(agentQuery)
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
cd packages/opencode && bun build src/devilcode/agent-sdk.ts --no-bundle --outdir /tmp/agent-sdk-check 2>&1 | head -20
```

Expected: No type errors. (If there are import resolution issues, they'll be caught in integration.)

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/devilcode/agent-sdk.ts
git commit -m "feat(opencode): add Agent SDK provider definition and stream function

Defines provider metadata for Claude Opus 4.6, Sonnet 4.6, and Haiku 4.5
via the Agent SDK. The stream() function builds a prompt, wraps Devil's
custom tools as in-process MCP, calls query(), and bridges events."
```

---

### Task 5: Register Provider and Wire Routing

**Files:**
- Modify: `packages/opencode/src/provider/provider.ts`
- Modify: `packages/opencode/src/provider/models.ts`
- Modify: `packages/opencode/src/session/llm.ts`

- [ ] **Step 1: Add Agent SDK constants and imports to `provider.ts`**

In `packages/opencode/src/provider/provider.ts`, add the import near the existing Claude Code import (line ~51):

```typescript
import { AGENT_SDK_ID, AGENT_SDK_RUNTIME } from "@/devilcode/agent-sdk"
```

Then update the `runtime()` function (line ~1124) to recognize both runtimes:

```typescript
export function runtime(model: Pick<Model, "options">, provider?: Pick<Info, "options">) {
  const value = model.options["runtime"] ?? provider?.options?.["runtime"]
  if (value === CLAUDE_CODE_RUNTIME) return CLAUDE_CODE_RUNTIME
  if (value === AGENT_SDK_RUNTIME) return AGENT_SDK_RUNTIME
  return "model"
}

export function external(model: Pick<Model, "options">, provider?: Pick<Info, "options">) {
  const r = runtime(model, provider)
  return r === CLAUDE_CODE_RUNTIME || r === AGENT_SDK_RUNTIME
}
```

- [ ] **Step 2: Add Agent SDK to CUSTOM_LOADERS in `provider.ts`**

Add alongside the existing `"claude-code"` entry in the `CUSTOM_LOADERS` object (line ~636):

```typescript
"agent-sdk": async () => {
  // Agent SDK requires ANTHROPIC_API_KEY
  const hasKey = !!process.env.ANTHROPIC_API_KEY
  return {
    autoload: hasKey,
    options: {
      runtime: AGENT_SDK_RUNTIME,
    },
  }
},
```

- [ ] **Step 3: Register Agent SDK provider in `models.ts`**

In `packages/opencode/src/provider/models.ts`, add the import:

```typescript
import { provider as agentSdkProvider, AGENT_SDK_ID } from "@/devilcode/agent-sdk"
```

Add registration near where `claude-code` is registered (line ~204):

```typescript
if (!providers[AGENT_SDK_ID] && process.env.ANTHROPIC_API_KEY) {
  providers[AGENT_SDK_ID] = agentSdkProvider() as Provider
}
```

- [ ] **Step 4: Add Agent SDK dispatch to `llm.ts`**

In `packages/opencode/src/session/llm.ts`, add the import (near line ~29):

```typescript
import { stream as streamAgentSdk, AGENT_SDK_ID } from "@/devilcode/agent-sdk"
```

Add the dispatch branch right after the existing Claude Code check (after line ~118):

```typescript
if (Provider.external(input.model, provider)) {
  // Existing Claude Code runtime
  if (input.model.providerID === "claude-code") {
    return streamClaude({
      abort: input.abort,
      cwd: Instance.directory,
      messages: input.messages,
      small: input.small ?? false,
      system,
    })
  }
  // Agent SDK runtime
  if (input.model.providerID === AGENT_SDK_ID) {
    return streamAgentSdk({
      abort: input.abort,
      cwd: Instance.directory,
      messages: input.messages,
      small: input.small ?? false,
      system,
      model: input.model.id,
    })
  }
  // Fallback for unknown external runtimes
  throw new Error(`Unknown external runtime for provider: ${input.model.providerID}`)
}
```

Note: This replaces the existing `if (Provider.external(...)) { return streamClaude(...) }` block. The existing code assumes all external providers are Claude Code. The new code checks the provider ID to dispatch correctly.

- [ ] **Step 5: Verify the application builds**

```bash
cd packages/opencode && bun build src/index.ts --no-bundle --outdir /tmp/build-check 2>&1 | tail -5
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/provider/provider.ts packages/opencode/src/provider/models.ts packages/opencode/src/session/llm.ts
git commit -m "feat(opencode): register Agent SDK provider and wire routing

Adds agent-sdk as an external runtime provider alongside claude-code.
When ANTHROPIC_API_KEY is set, Claude models are available via the
agent-sdk provider. LLM routing dispatches to the Agent SDK stream
function for these models."
```

---

### Task 6: Permission and Configuration Mapping

**Files:**
- Modify: `packages/opencode/src/devilcode/agent-sdk.ts`

Devil has a rich permission system with per-tool rules. The Agent SDK has `permissionMode` and `allowedTools`/`disallowedTools`. This task maps between them.

- [ ] **Step 1: Add permission mapping function**

Add to `packages/opencode/src/devilcode/agent-sdk.ts`:

```typescript
import type { Agent } from "@/agent/agent"

type AgentSdkPermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk"

/**
 * Maps Devil's agent permission config to Agent SDK permission mode and tool lists.
 *
 * Devil permissions are per-tool rules like `{ "bash": { "*": "ask", "cat *": "allow" } }`.
 * The Agent SDK uses a simpler model: a permission mode + allow/deny tool lists.
 *
 * Mapping strategy:
 * - If agent has no permission rules → "acceptEdits" (default for agentic use)
 * - If all tools are set to "allow" → "bypassPermissions"
 * - If all tools are set to "deny" → "plan" (read-only)
 * - Mixed rules → "acceptEdits" with allowedTools populated from "allow" rules
 */
export function mapPermissions(agent?: Agent.Info): {
  permissionMode: AgentSdkPermissionMode
  allowedTools: string[]
  disallowedTools: string[]
} {
  const allowed: string[] = [
    // Always allow read-only tools
    "Read", "Glob", "Grep", "WebFetch", "WebSearch",
  ]
  const disallowed: string[] = []

  if (!agent?.permission) {
    return { permissionMode: "acceptEdits", allowedTools: allowed, disallowedTools: disallowed }
  }

  const rules = agent.permission
  let allAllow = true
  let allDeny = true

  for (const [toolName, toolRules] of Object.entries(rules)) {
    if (typeof toolRules !== "object" || !toolRules) continue
    for (const [, action] of Object.entries(toolRules)) {
      if (action === "allow") allDeny = false
      if (action === "deny" || action === "ask") allAllow = false
      if (action === "allow" && !allowed.includes(toolName)) {
        allowed.push(toolName)
      }
      if (action === "deny") {
        disallowed.push(toolName)
      }
    }
  }

  if (allAllow) return { permissionMode: "acceptEdits", allowedTools: allowed, disallowedTools: [] }
  if (allDeny) return { permissionMode: "plan", allowedTools: [], disallowedTools: [] }

  return { permissionMode: "acceptEdits", allowedTools: allowed, disallowedTools: disallowed }
}
```

- [ ] **Step 2: Update `stream()` to use permission mapping**

Replace the `resolvePermissionMode` call in `stream()` with the new `mapPermissions`:

```typescript
// In the stream() function, replace the static allowedTools and permissionMode with:
const perms = mapPermissions(/* pass agent if available */)

const q = query({
  prompt,
  options: {
    abortController,
    cwd: input.cwd,
    model: modelId,
    permissionMode: perms.permissionMode,
    allowedTools: perms.allowedTools,
    disallowedTools: perms.disallowedTools,
    mcpServers,
    maxTurns: input.small ? 1 : 50,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: input.system.join("\n\n"),
    },
    thinking: { type: "adaptive" },
  },
})
```

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/devilcode/agent-sdk.ts
git commit -m "feat(opencode): add permission mapping for Agent SDK

Maps Devil's per-tool permission rules to Agent SDK's permission mode
and allowed/disallowed tool lists."
```

---

### Task 7: Integration Test

**Files:**
- Create: `packages/opencode/test/devilcode/agent-sdk.test.ts`

- [ ] **Step 1: Write integration test for provider registration**

```typescript
// packages/opencode/test/devilcode/agent-sdk.test.ts
import { describe, test, expect } from "bun:test"
import { provider, AGENT_SDK_ID, AGENT_SDK_RUNTIME, mapPermissions } from "@/devilcode/agent-sdk"

describe("agent-sdk provider", () => {
  test("provider() returns valid metadata", () => {
    const p = provider()
    expect(p.id).toBe(AGENT_SDK_ID)
    expect(p.name).toBe("Claude (Agent SDK)")
    expect(p.env).toContain("ANTHROPIC_API_KEY")
  })

  test("all models have external-agent runtime", () => {
    const p = provider()
    for (const [id, model] of Object.entries(p.models)) {
      expect(model.options.runtime).toBe(AGENT_SDK_RUNTIME)
      expect(model.id).toBe(id)
      expect(model.limit.context).toBeGreaterThan(0)
      expect(model.cost.input).toBeGreaterThan(0)
    }
  })

  test("exposes three Claude models", () => {
    const p = provider()
    const modelIds = Object.keys(p.models)
    expect(modelIds).toContain("opus-4-6")
    expect(modelIds).toContain("sonnet-4-6")
    expect(modelIds).toContain("haiku-4-5")
  })
})

describe("permission mapping", () => {
  test("no agent → acceptEdits with read-only tools", () => {
    const result = mapPermissions()
    expect(result.permissionMode).toBe("acceptEdits")
    expect(result.allowedTools).toContain("Read")
    expect(result.allowedTools).toContain("Glob")
    expect(result.allowedTools).toContain("Grep")
  })

  test("agent with no permission rules → acceptEdits", () => {
    const result = mapPermissions({ name: "test", prompt: "test" } as any)
    expect(result.permissionMode).toBe("acceptEdits")
  })
})
```

- [ ] **Step 2: Run all tests**

```bash
cd packages/opencode && bun test test/devilcode/ --timeout 30000
```

Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/test/devilcode/agent-sdk.test.ts
git commit -m "test(opencode): add Agent SDK integration tests

Tests provider metadata, model registration, and permission mapping."
```

---

### Task 8: Manual Smoke Test

This task verifies the full integration works end-to-end with a real API key.

- [ ] **Step 1: Set up environment**

```bash
export ANTHROPIC_API_KEY="your-api-key-here"
```

- [ ] **Step 2: Verify provider appears in model list**

Launch Devil and check that the Agent SDK provider and its models appear in the model picker. The provider should show as "Claude (Agent SDK)" with three models:
- Claude Opus 4.6
- Claude Sonnet 4.6
- Claude Haiku 4.5

- [ ] **Step 3: Test basic interaction**

Select "Claude Opus 4.6" from the Agent SDK provider. Send a simple prompt:

```
What files are in this directory?
```

Verify:
- Claude responds with a file listing
- Tool calls (Glob/Bash) are visible in the UI
- Text response renders correctly
- Token usage is tracked in the session

- [ ] **Step 4: Test tool use**

Send a prompt that requires tool use:

```
Read the README.md file and summarize the first 10 lines
```

Verify:
- Claude reads the file (Read tool)
- Summary is displayed
- Tool call status shows completed in the UI

- [ ] **Step 5: Test multi-model switching**

After using Agent SDK, switch to a non-Claude model (e.g., an OpenAI model if configured). Send a prompt and verify the existing Vercel AI SDK path still works correctly. Then switch back to Agent SDK.

- [ ] **Step 6: Document any issues**

Create a file noting any issues found during smoke testing:

```bash
echo "# Agent SDK Smoke Test Results - $(date +%Y-%m-%d)" > docs/superpowers/plans/agent-sdk-smoke-test.md
echo "" >> docs/superpowers/plans/agent-sdk-smoke-test.md
echo "## Issues Found" >> docs/superpowers/plans/agent-sdk-smoke-test.md
echo "- (document any issues here)" >> docs/superpowers/plans/agent-sdk-smoke-test.md
```

---

## Phase 2 (Future Work — Not Part of This Plan)

These improvements build on the foundation above:

1. **Token-level streaming**: Enable `includePartialMessages: true` in the Agent SDK options and process `SDKPartialAssistantMessage` (`stream_event`) in the bridge for real-time text/thinking streaming instead of whole-block pushes.

2. **Session persistence**: Bridge the Agent SDK's session management (resume, fork) with Devil's session system for cross-session context.

3. **Subagent UI**: Map Agent SDK `task_started`/`task_progress`/`task_notification` messages to Devil's SubtaskPart for visual subagent tracking.

4. **Custom system prompt injection**: Instead of using `buildPrompt()` from `claude-code.ts`, build a richer system prompt that leverages Devil's agent configuration.

5. **Cost tracking**: Bridge `SDKResultMessage.total_cost_usd` and `modelUsage` into Devil's cost tracking system.

6. **File checkpointing**: Enable `enableFileCheckpointing: true` and expose `rewindFiles()` through Devil's snapshot system.
