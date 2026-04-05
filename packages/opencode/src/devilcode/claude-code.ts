import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { AsyncQueue } from "@/util/queue"
import { which } from "@/util/which"
import os from "node:os"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import type { ModelMessage, StreamTextResult, ToolSet } from "ai"

export const CLAUDE_CODE_ID = "claude-code"
export const CLAUDE_CODE_KEY = "local"
export const CLAUDE_CODE_URL = "https://code.claude.com/docs/en/authentication"
export const CLAUDE_CODE_RUNTIME = "external-agent"

const WRITE = [
  "Agent",
  "Bash",
  "Edit",
  "Glob",
  "Grep",
  "LS",
  "MultiEdit",
  "NotebookEdit",
  "Read",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
  "Write",
].join(",")

const READ = ["Glob", "Grep", "LS", "Read", "WebFetch", "WebSearch"].join(",")

const PROMPT = [
  "Continue this Devil session as Claude Code.",
  "The working tree on disk is the source of truth.",
  "Use your Claude Code tools when needed to inspect and modify the repository.",
  "The serialized transcript below is the conversation state Devil is preserving for you.",
].join("\n")

type Full = StreamTextResult<ToolSet, unknown>["fullStream"] extends AsyncIterable<infer Item> ? Item : never
type Output = Pick<StreamTextResult<ToolSet, unknown>, "fullStream" | "textStream" | "text">
type Line = Record<string, unknown>
const END = Symbol("done")
type Item<T> = T | typeof END

interface RunInput {
  abort: AbortSignal
  cwd: string
  small: boolean
  prompt: string
}

interface RunState {
  auth: string[]
  code: number
  err: string[]
  result?: Line
}

function dir() {
  return Filesystem.resolve(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"))
}

function file() {
  return path.join(dir(), ".credentials.json")
}

function missing() {
  const hint = process.platform === "darwin" ? "" : ` Expected credentials at ${file()}.`
  return `Claude Code login not detected. Run \`claude\` in a terminal to sign in.${hint}`
}

function done(): typeof END {
  return END
}

function parse(raw: string) {
  try {
    const item = JSON.parse(raw)
    if (!item || typeof item !== "object") return undefined
    return item as Line
  } catch {
    return undefined
  }
}

function dump(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function clip(text: string, max = 4000) {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n...[truncated]`
}

function part(item: unknown) {
  if (!item || typeof item !== "object") return ""
  const line = item as Line
  const type = typeof line.type === "string" ? line.type : ""
  if (type === "text" && typeof line.text === "string") return line.text
  if (type === "reasoning" && typeof line.text === "string") return `[Reasoning]\n${line.text}`
  if (type === "thinking" && typeof line.thinking === "string") return `[Thinking]\n${line.thinking}`
  if (type === "tool-call") {
    const name = typeof line.toolName === "string" ? line.toolName : "tool"
    return `[Tool call: ${name}] ${clip(dump(line.input ?? {}), 2000)}`
  }
  if (type === "tool-result") {
    const name = typeof line.toolName === "string" ? line.toolName : "tool"
    const body = line.output ?? line.result ?? line.content ?? {}
    return `[Tool result: ${name}] ${clip(dump(body), 2000)}`
  }
  if (type === "file") return "[File attachment omitted]"
  if (type === "image") return "[Image attachment omitted]"
  if (type === "input_image") return "[Image attachment omitted]"
  if (type === "input_file") return "[File attachment omitted]"
  return clip(dump(line), 1000)
}

function content(value: unknown) {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return ""
  return value.map(part).filter(Boolean).join("\n")
}

function role(value: string) {
  if (value === "assistant") return "Assistant"
  if (value === "system") return "System"
  return "User"
}

function render(messages: ModelMessage[]) {
  return messages
    .map((item) => {
      const body = content(item.content)
      if (!body) return ""
      return `## ${role(item.role)}\n${clip(body, 8000)}`
    })
    .filter(Boolean)
    .join("\n\n")
}

export function buildPrompt(input: { messages: ModelMessage[]; system: string[] }) {
  const blocks = [PROMPT]
  const system = input.system.join("\n\n").trim()
  if (system) {
    blocks.push(`<instructions>\n${system}\n</instructions>`)
  }
  const history = render(input.messages).trim()
  if (history) {
    blocks.push(`<conversation>\n${history}\n</conversation>`)
  }
  return blocks.join("\n\n")
}

function installed() {
  const bin = which("claude")
  if (bin) return bin
  throw new Error("Claude Code is not installed. Install it, then run `claude` once to sign in.")
}

async function logged() {
  if (process.platform === "darwin") return undefined
  const data = await Filesystem.readJson<Record<string, unknown>>(file()).catch(() => undefined)
  if (!data || typeof data !== "object") return false
  return Object.keys(data).length > 0
}

async function ensure() {
  installed()
  const auth = await logged()
  if (auth === false) {
    throw new Error(missing())
  }
}

function usage(input: Line | undefined) {
  const raw = (input?.usage ?? {}) as Line
  const inputTokens = typeof raw.input_tokens === "number" ? raw.input_tokens : 0
  const outputTokens = typeof raw.output_tokens === "number" ? raw.output_tokens : 0
  const cacheRead = typeof raw.cache_read_input_tokens === "number" ? raw.cache_read_input_tokens : 0
  const cacheWrite = typeof raw.cache_creation_input_tokens === "number" ? raw.cache_creation_input_tokens : 0
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens + cacheRead + cacheWrite,
    reasoningTokens: 0,
    cachedInputTokens: cacheRead,
  }
}

function finish(input: Line | undefined) {
  const stop = typeof input?.stop_reason === "string" ? input.stop_reason : "stop"
  return stop === "end_turn" ? "stop" : stop
}

function auth(state: RunState) {
  const result = state.result?.errors
  if (Array.isArray(result)) {
    const first = result.find((item): item is string => typeof item === "string" && item.length > 0)
    if (first) return first
  }
  const auth = state.auth.join("\n").trim()
  if (auth) return auth
  const err = state.err.join("\n").trim()
  if (err) return err
  return missing()
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

function args(input: { small: boolean }) {
  const cmd = [
    installed(),
    "-p",
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    input.small ? "plan" : "acceptEdits",
    "--allowedTools",
    input.small ? READ : WRITE,
  ]
  if (input.small) {
    cmd.push("--max-turns", "1")
  }
  return cmd
}

function body(text: string) {
  return `${JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
  })}\n`
}

function strings(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function assistant(line: Line) {
  const data = line.message
  if (!data || typeof data !== "object") return []
  const blocks = (data as Line).content
  if (!Array.isArray(blocks)) return []
  return blocks
}

async function run(input: RunInput, onLine: (line: Line) => void) {
  const proc = Process.spawn(args(input), {
    abort: input.abort,
    cwd: input.cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  if (!proc.stdout || !proc.stderr) {
    throw new Error("Claude Code process output is not available.")
  }

  const state: RunState = {
    auth: [],
    code: 0,
    err: [],
  }

  let out = ""

  const handle = (line: Line) => {
    const type = typeof line.type === "string" ? line.type : ""
    if (type === "auth_status") {
      state.auth.push(...strings(line.output))
      if (typeof line.error === "string") state.auth.push(line.error)
      return
    }
    if (type === "result") {
      state.result = line
    }
    onLine(line)
  }

  proc.stdout.setEncoding("utf8")
  proc.stderr.setEncoding("utf8")

  const stdout = new Promise<void>((resolve, reject) => {
    proc.stdout!.on("data", (chunk: string) => {
      out += chunk
      const lines = out.split(/\r?\n/)
      out = lines.pop() ?? ""
      for (const raw of lines) {
        const line = parse(raw)
        if (!line) continue
        handle(line)
      }
    })
    proc.stdout!.once("end", resolve)
    proc.stdout!.once("error", reject)
  })

  const stderr = new Promise<void>((resolve, reject) => {
    proc.stderr!.on("data", (chunk: string) => {
      const text = chunk.trim()
      if (text) state.err.push(text)
    })
    proc.stderr!.once("end", resolve)
    proc.stderr!.once("error", reject)
  })

  proc.stdin?.on("error", () => {})
  proc.stdin?.end(body(input.prompt))

  state.code = await Promise.all([proc.exited, stdout, stderr]).then(([code]) => code)
  if (out.trim()) {
    const line = parse(out.trim())
    if (line) handle(line)
  }
  return state
}

function text(line: Line) {
  return assistant(line)
    .map((item) => {
      if (!item || typeof item !== "object") return ""
      const block = item as Line
      if (block.type !== "text" || typeof block.text !== "string") return ""
      return block.text
    })
    .filter(Boolean)
    .join("\n")
    .trim()
}

function thinking(line: Line) {
  return assistant(line)
    .map((item) => {
      if (!item || typeof item !== "object") return ""
      const block = item as Line
      if (block.type !== "thinking" || typeof block.thinking !== "string") return ""
      return block.thinking
    })
    .filter(Boolean)
    .join("\n")
    .trim()
}

function pushText(full: AsyncQueue<Item<Full>>, text: AsyncQueue<Item<string>>, body: string) {
  if (!body) return
  full.push({ type: "text-start" } as Full)
  full.push({ type: "text-delta", text: body } as Full)
  full.push({ type: "text-end" } as Full)
  text.push(body)
}

function pushThinking(full: AsyncQueue<Item<Full>>, body: string, id: string) {
  if (!body) return
  full.push({ type: "reasoning-start", id } as Full)
  full.push({ type: "reasoning-delta", id, text: body } as Full)
  full.push({ type: "reasoning-end", id } as Full)
}

export function provider() {
  return {
    id: CLAUDE_CODE_ID,
    name: "Claude Code",
    env: [],
    api: "https://code.claude.com/",
    npm: "@anthropic-ai/claude-code",
    models: {
      default: {
        id: "default",
        name: "Claude Code",
        family: "claude-code",
        release_date: "2026-04-04",
        attachment: false,
        reasoning: true,
        temperature: false,
        tool_call: false,
        limit: {
          context: 200000,
          output: 32000,
        },
        cost: {
          input: 0,
          output: 0,
        },
        modalities: {
          input: ["text"],
          output: ["text"],
        },
        options: {
          runtime: CLAUDE_CODE_RUNTIME,
        },
        provider: {
          api: "https://code.claude.com/",
          npm: "@anthropic-ai/claude-code",
        },
      },
    },
  }
}

export async function wait(input: { abort?: AbortSignal; cwd: string; tries?: number }) {
  const tries = input.tries ?? 40
  installed()
  for (const _ of Array.from({ length: tries })) {
    input.abort?.throwIfAborted()
    const auth = await logged()
    if (auth === true) return
    if (auth === false) {
      await sleep(3_000, undefined, { signal: input.abort })
      continue
    }
    try {
      const result = await run(
        {
          abort: input.abort ?? AbortSignal.timeout(30_000),
          cwd: input.cwd,
          prompt: "Reply with OK and nothing else.",
          small: true,
        },
        () => {},
      )
      if (result.code === 0) return
      if (!result.auth.length && result.err.length) {
        throw new Error(result.err[0])
      }
    } catch (err) {
      const text = (err instanceof Error ? err.message : String(err)).toLowerCase()
      if (text.includes("not installed")) throw err
      if (!text.includes("sign in") && !text.includes("login")) throw err
    }
    await sleep(3_000, undefined, { signal: input.abort })
  }
  throw new Error(missing())
}

export function stream(input: {
  abort: AbortSignal
  cwd: string
  messages: ModelMessage[]
  small: boolean
  system: string[]
}): Output {
  const full = new AsyncQueue<Item<Full>>()
  const plain = new AsyncQueue<Item<string>>()

  let doneText = ""
  let resolve = (_value: string) => {}
  let reject = (_error: unknown) => {}

  const complete = new Promise<string>((ok, fail) => {
    resolve = ok
    reject = fail
  })

  const fail = (err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err))
    full.push({ type: "error", error } as Full)
    full.push(done())
    plain.push(done())
    reject(error)
  }

  const stop = (line?: Line) => {
    if (line) {
      const body = text(line)
      if (body && !doneText.trim()) {
        doneText = body
        pushText(full, plain, body)
      }
    }
    full.push({
      type: "finish-step",
      finishReason: finish(line),
      usage: usage(line),
    } as Full)
    full.push(done())
    plain.push(done())
    resolve(doneText.trim())
  }

  void (async () => {
    full.push({ type: "start" } as Full)
    full.push({ type: "start-step" } as Full)
    try {
      await ensure()
      const result = await run(
        {
          abort: input.abort,
          cwd: input.cwd,
          prompt: buildPrompt({ messages: input.messages, system: input.system }),
          small: input.small,
        },
        (line) => {
          const type = typeof line.type === "string" ? line.type : ""
          if (type !== "assistant") return
          const body = text(line)
          const thought = thinking(line)
          if (thought) {
            pushThinking(full, thought, typeof line.uuid === "string" ? line.uuid : "thinking")
          }
          if (!body) return
          doneText += `${doneText ? "\n" : ""}${body}`
          pushText(full, plain, body)
        },
      )
      if (result.code !== 0) {
        throw new Error(auth(result))
      }
      const line = result.result
      if (line?.subtype && line.subtype !== "success") {
        const errors = strings(line.errors)
        throw new Error(errors[0] ?? `Claude Code failed: ${String(line.subtype)}`)
      }
      stop(line)
    } catch (err) {
      fail(err)
    }
  })()

  return {
    fullStream: queue(full),
    textStream: queue(plain),
    text: complete,
  }
}
