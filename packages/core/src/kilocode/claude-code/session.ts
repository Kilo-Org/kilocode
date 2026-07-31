// A live Claude Code CLI process plus its MCP bridge.
//
// The CLI runs in headless streaming mode (`--print --output-format stream-json
// --input-format stream-json`), which keeps one process alive for a whole
// assistant turn: it can call a tool, wait for the result, and continue. That
// is what lets Kilo's agent loop stay in charge while the CLI does the actual
// (subscription-billed) model calls.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"
import { rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import * as Bridge from "./bridge"

export type Event =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool"; call: Bridge.BridgeCall }
  /**
   * The CLI committed an assistant message that calls `tools` bridge tools.
   * Emitted before the matching MCP requests arrive, so the reader knows
   * exactly how many `tool` events to batch instead of guessing with a timer.
   */
  | { type: "step"; tools: number }
  | { type: "usage"; input: number; output: number; cacheRead: number; cacheWrite: number; cost?: number }
  | { type: "done"; reason: "stop" | "length" | "error"; message?: string }

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; cost?: number }

// Anthropic Messages-API-shaped content blocks. Verified live against the CLI
// (not assumed from docs): a `{type:"image",source:{type:"base64",...}}`
// block in stream-json input is genuinely forwarded to the model — a probe
// image was correctly described back, so this is real vision support, not a
// text placeholder.
export type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image"
      source: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string }
    }

type Queue = {
  push: (event: Event) => void
  end: () => void
  iterator: () => AsyncGenerator<Event>
}

function queue(): Queue {
  const buffer: Event[] = []
  let done = false
  let wake: (() => void) | undefined
  const signal = () => {
    wake?.()
    wake = undefined
  }
  return {
    push: (event) => {
      buffer.push(event)
      signal()
    },
    end: () => {
      done = true
      signal()
    },
    iterator: async function* () {
      while (true) {
        while (buffer.length) yield buffer.shift()!
        if (done) return
        await new Promise<void>((resolve) => (wake = resolve))
      }
    },
  }
}

export type StartInput = {
  bin: string
  model: string
  system?: string
  /** Forwarded as `--effort <level>` (low/medium/high/xhigh/max). Fixed for
   *  the lifetime of the process, like `system` above. */
  effort?: string
  cwd?: string
  tools: () => Bridge.ToolSpec[]
  maxOutputTokens?: number
  /** Extra environment for the child (tests inject fixtures through this). */
  env?: Record<string, string>
}

export type Session = Awaited<ReturnType<typeof start>>

export async function start(input: StartInput) {
  const events = queue()
  const bridge = await Bridge.start({
    tools: input.tools,
    onCall: (call) => events.push({ type: "tool", call }),
  })

  const mcp = JSON.stringify({
    mcpServers: {
      [Bridge.SERVER_NAME]: { type: "http", url: bridge.url, headers: { Authorization: `Bearer ${bridge.token}` } },
    },
  })

  // Kilo's full agent system prompt easily exceeds the OS command-line length
  // limit (hits `ENAMETOOLONG` from uv_spawn on Windows with `--system-prompt`
  // directly), so it goes through a temp file instead of an argv value.
  const systemPromptFile = input.system ? path.join(tmpdir(), `kilo-claude-code-system-${randomUUID()}.txt`) : undefined
  const writeSystemPrompt = systemPromptFile ? writeFile(systemPromptFile, input.system!, "utf8") : Promise.resolve()

  const args = [
    "--print",
    "--verbose",
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--include-partial-messages",
    "--model",
    input.model,
    // Kilo supplies the whole system prompt; this also drops Claude Code's own
    // ~35k-token agent preamble, which the user would otherwise pay for.
    ...(systemPromptFile ? ["--system-prompt-file", systemPromptFile] : []),
    ...(input.effort ? ["--effort", input.effort] : []),
    // Disable every built-in tool. Kilo's tools arrive over the MCP bridge, so
    // the CLI must not read/write files or run commands on its own.
    "--tools",
    "",
    "--mcp-config",
    mcp,
    // Without this the user's personal MCP servers are also loaded, which both
    // leaks unrelated tools into the turn and costs tokens.
    "--strict-mcp-config",
    // Kilo's agent loop is the permission authority and already prompts the
    // user before executing anything the model asks for; a second prompt inside
    // a headless child would simply deadlock.
    "--permission-mode",
    "bypassPermissions",
    // NOTE: do not pass `--setting-sources ""` (nor `--bare`). Both stop the
    // CLI from loading user settings, which is where the subscription OAuth
    // credentials live — the CLI then fails with "Not logged in".
    "--no-session-persistence",
  ]

  await writeSystemPrompt

  const child: ChildProcessWithoutNullStreams = spawn(input.bin, args, {
    cwd: input.cwd,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...input.env },
  }) as ChildProcessWithoutNullStreams

  let stderr = ""
  child.stderr?.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4000)
  })

  let rest = ""
  child.stdout?.on("data", (chunk) => {
    rest += chunk
    const lines = rest.split("\n")
    rest = lines.pop() ?? ""
    for (const line of lines) {
      const text = line.trim()
      if (!text) continue
      try {
        handle(JSON.parse(text))
      } catch {
        // Non-JSON noise on stdout is not fatal; the CLI occasionally prints
        // update banners. Dropping the line is preferable to killing the turn.
      }
    }
  })

  const cleanupSystemPromptFile = () => {
    if (!systemPromptFile) return
    void rm(systemPromptFile, { force: true }).catch(() => {
      // Best-effort: an OS temp dir sweep will eventually reclaim this file
      // even if the process couldn't remove it here.
    })
  }

  let closed = false
  child.on("error", (error) => {
    cleanupSystemPromptFile()
    events.push({ type: "done", reason: "error", message: error.message })
    events.end()
  })
  child.on("close", (code) => {
    closed = true
    cleanupSystemPromptFile()
    bridge.failAll("Claude Code session ended before the tool result was used.")
    if (code !== 0) {
      events.push({
        type: "done",
        reason: "error",
        message: stderr.trim() || `Claude Code exited with code ${code}`,
      })
    }
    events.end()
  })

  function handle(event: any): void {
    if (event?.type === "stream_event") {
      const inner = event.event
      if (inner?.type === "content_block_delta") {
        const delta = inner.delta
        if (delta?.type === "text_delta" && delta.text) events.push({ type: "text", text: delta.text })
        if (delta?.type === "thinking_delta" && delta.thinking) events.push({ type: "reasoning", text: delta.thinking })
      }
      return
    }
    if (event?.type === "assistant") {
      // Text already streamed through `stream_event` deltas; this event is only
      // used to learn how many tool calls the step contains.
      const content = event.message?.content
      const tools = Array.isArray(content) ? content.filter((block: any) => block?.type === "tool_use").length : 0
      if (tools > 0) events.push({ type: "step", tools })
      return
    }
    if (event?.type === "result") {
      const usage = event.usage ?? {}
      events.push({
        type: "usage",
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        cacheWrite: usage.cache_creation_input_tokens ?? 0,
        cost: typeof event.total_cost_usd === "number" ? event.total_cost_usd : undefined,
      })
      const failed = event.is_error === true || event.subtype !== "success"
      events.push({
        type: "done",
        reason: failed ? "error" : event.stop_reason === "max_tokens" ? "length" : "stop",
        message: failed ? (typeof event.result === "string" ? event.result : event.subtype) : undefined,
      })
      return
    }
  }

  const write = (payload: unknown) => {
    if (closed || child.stdin.destroyed) return
    child.stdin.write(JSON.stringify(payload) + "\n")
  }

  return {
    id: randomUUID(),
    bridge,
    stream: events.iterator(),
    /** Push a user turn into the running CLI. */
    send: (content: ContentBlock[]) => write({ type: "user", message: { role: "user", content } }),
    /** Resolve a parked MCP tool call with the result Kilo produced. */
    settle: (id: string, text: string, isError?: boolean) => bridge.settle(id, { text, isError }),
    pending: () => bridge.pending(),
    get alive() {
      return !closed
    },
    close: async () => {
      closed = true
      bridge.failAll("Session cancelled.")
      try {
        child.stdin.end()
      } catch {
        // stdin may already be torn down when the child exited on its own.
      }
      child.kill()
      await bridge.close()
      events.end()
    },
  }
}
