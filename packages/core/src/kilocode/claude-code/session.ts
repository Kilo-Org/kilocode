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
  // Both temp files get `mode: 0o600`: on a shared multi-user /tmp (Linux),
  // the default mode would leave them world-readable — meaningful for the
  // mcp config below (it carries the bridge's bearer token), and applied to
  // the system prompt too for consistency.
  const systemPromptFile = input.system ? path.join(tmpdir(), `kilo-claude-code-system-${randomUUID()}.txt`) : undefined
  const writeSystemPrompt = systemPromptFile
    ? writeFile(systemPromptFile, input.system!, { encoding: "utf8", mode: 0o600 })
    : Promise.resolve()

  // The bridge's bearer token must not appear in argv either: a process's
  // own command line is readable by any other local process/user (e.g.
  // `/proc/<pid>/cmdline` on Linux, or Process Explorer/WMI on Windows),
  // which would defeat the token's whole purpose.
  const mcpConfigFile = path.join(tmpdir(), `kilo-claude-code-mcp-${randomUUID()}.json`)
  const writeMcpConfig = writeFile(mcpConfigFile, mcp, { encoding: "utf8", mode: 0o600 })

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
    mcpConfigFile,
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

  const cleanupTempFiles = () => {
    for (const file of [systemPromptFile, mcpConfigFile]) {
      if (!file) continue
      void rm(file, { force: true }).catch(() => {
        // Best-effort: an OS temp dir sweep will eventually reclaim this file
        // even if the process couldn't remove it here.
      })
    }
  }

  // A write failure here must not leave the bridge's HTTP listener orphaned
  // (nothing else would ever close it once `start()` rejects), nor a temp
  // file that *did* write successfully — including the token-bearing mcp
  // config if only the system prompt write failed, or vice versa. Swallow
  // (rather than propagate) any error from `bridge.close()` itself so it
  // can't replace the original write error.
  await Promise.all([writeSystemPrompt, writeMcpConfig]).catch(async (err) => {
    cleanupTempFiles()
    await bridge.close().catch(() => {})
    throw err
  })

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

  let closed = false
  child.on("error", (error) => {
    cleanupTempFiles()
    events.push({ type: "done", reason: "error", message: error.message })
    events.end()
  })
  child.on("close", (code) => {
    closed = true
    cleanupTempFiles()
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
    if (event?.type === "system" && event.subtype === "init") {
      // `--tools ""` is the only thing standing between `bypassPermissions`
      // and the CLI reading/writing files or running shell commands on its
      // own. Defense in depth: if a native (non-bridge) tool ever shows up
      // here — a CLI update changing `--tools ""` semantics, for example —
      // fail loudly instead of silently running with native tools enabled.
      //
      // Checked against our own server's specific `mcp__kilo__` prefix, not
      // a generic `mcp__` one: Claude Code can auto-activate its own
      // IDE-integration MCP tools (e.g. `mcp__ide__executeCode`, which can
      // execute code) outside `--mcp-config`/`--strict-mcp-config` entirely
      // — the child inherits the full parent environment, so this is a real
      // risk, not hypothetical, if Kilo itself is running inside a
      // Claude-Code-aware IDE. Anything not from our own bridge is untrusted.
      const leaked = Array.isArray(event.tools)
        ? event.tools.filter((name: unknown) => typeof name === "string" && !name.startsWith(Bridge.TOOL_PREFIX))
        : []
      if (leaked.length) {
        events.push({
          type: "done",
          reason: "error",
          message: `Claude Code CLI reported native tools despite --tools "": ${leaked.join(", ")}`,
        })
        events.end()
        child.kill()
      }
      return
    }
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
      if (!child.killed && child.exitCode === null) {
        child.kill()
        // A child that ignores SIGTERM (blocked I/O, defunct state, etc.)
        // would otherwise outlive the session indefinitely. Escalate once.
        setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL")
        }, 3_000).unref()
      }
      await bridge.close()
      events.end()
    },
  }
}
