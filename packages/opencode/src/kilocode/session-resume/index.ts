import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as readline from "node:readline"
import { Context } from "effect"

export namespace SessionResume {
  export const SUPPORTED_CLAUDE_MAJOR = 2
  export const SUPPORTED_CODEX_MAJOR = 0

  export type Format = "claude" | "codex"

  // ── Test-only resume roots ──────────────────────────────────────────

  export type HarnessRoots = {
    claude?: string
    codex?: string
  }

  /** Test-only seam to redirect transcript discovery roots.
   *  Not available through the public command API. */
  export class ResumeRoots extends Context.Service<ResumeRoots, HarnessRoots>()("SessionResume.ResumeRoots") {}

  // ── UUID ───────────────────────────────────────────────────────────

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  export function isUUID(id: string): boolean {
    return UUID_RE.test(id)
  }

  export function validateUUID(id: string): void {
    if (!isUUID(id)) throw new ParseError(`Invalid UUID: ${id}`)
  }

  // ── Parsed parts ──────────────────────────────────────────────────

  export type TextPart = {
    type: "text"
    text: string
  }

  export type ReasoningPart = {
    type: "reasoning"
    text: string
  }

  export type ToolCall = {
    type: "tool_call"
    id: string
    name: string
    input: unknown
    status?: "failed" | "error" | "incomplete"
  }

  export type ToolResult = {
    type: "tool_result"
    callID: string
    content: string
    error?: boolean
  }

  export type Unsupported = {
    type: "unsupported"
    reason: string
  }

  export type ErrorPart = {
    type: "error"
    message: string
  }

  export type Part = TextPart | ReasoningPart | ToolCall | ToolResult | Unsupported | ErrorPart

  // ── Steps and transcript ──────────────────────────────────────────

  export type Step = {
    role: "user" | "assistant"
    parts: Part[]
  }

  export type Transcript = {
    format: Format
    version: number
    steps: Step[]
    unsupported: number
    sourceModel?: { providerID: string; modelID: string }
  }

  // ── Errors ────────────────────────────────────────────────────────

  export class ParseError extends Error {
    constructor(
      message: string,
      public override cause?: unknown,
    ) {
      super(message)
      this.name = "SessionResumeParseError"
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }

  function isArray(value: unknown): value is unknown[] {
    return Array.isArray(value)
  }

  function safeParse(line: string): unknown {
    try {
      return JSON.parse(line)
    } catch {
      return undefined
    }
  }

  // ── Detection ─────────────────────────────────────────────────────

  /** Detect whether a parsed JSON line belongs to a Claude or Codex session. */
  export function detect(line: unknown): Format | undefined {
    if (!isRecord(line)) return undefined

    const type = line.type

    // Claude: top-level type is "user" or "assistant" + message.{role,content}
    if ((type === "user" || type === "assistant") && isRecord(line.message)) {
      const msg = line.message as Record<string, unknown>
      if (typeof msg.role === "string" && (isArray(msg.content) || typeof msg.content === "string")) {
        return "claude"
      }
    }

    // Codex: type is session_meta or response_item
    if (type === "session_meta" || type === "response_item") {
      return "codex"
    }

    return undefined
  }

  // ── Discovery ─────────────────────────────────────────────────────

  /** List JSONL files under a directory (non-recursive). */
  export function discover(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
      .map((e) => path.join(dir, e.name))
  }

  export type DiscoveryInput = HarnessRoots & {
    cwd: string
    id?: string
  }

  export function claudeProjectSlug(cwd: string): string {
    return cwd.replace(/[^A-Za-z0-9-]/g, "-")
  }

  function roots(input: HarnessRoots) {
    return {
      claude: input.claude ?? path.join(os.homedir(), ".claude", "projects"),
      codex: input.codex ?? path.join(os.homedir(), ".codex", "sessions"),
    }
  }

  export function discoverClaude(input: DiscoveryInput): string[] {
    const root = roots(input).claude
    const directory = path.join(root, claudeProjectSlug(input.cwd))
    if (input.id) {
      validateUUID(input.id)
      const file = path.join(directory, `${input.id}.jsonl`)
      const stat = fs.statSync(file)
      if (!stat.isFile()) throw new ParseError(`Unreadable Claude transcript: ${input.id}`)
      return [file]
    }
    return discover(directory)
      .filter((file) => isUUID(path.basename(file, ".jsonl")))
      .map((file) => ({ file, time: fs.statSync(file).mtimeMs }))
      .sort((a, b) => b.time - a.time)
      .slice(0, 10)
      .map((entry) => entry.file)
  }

  export async function discoverCodex(input: DiscoveryInput): Promise<string[]> {
    const root = roots(input).codex
    if (input.id) validateUUID(input.id)
    const files: { file: string; time: string }[] = []
    const matches = new Set<string>()
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) matches.add(entry.name)
    }
    for await (const relative of new Bun.Glob("**/rollout-*.jsonl").scan({ cwd: root, onlyFiles: true })) {
      matches.add(relative)
    }
    for (const relative of matches) {
      if (input.id && !relative.endsWith(`-${input.id}.jsonl`)) continue
      const file = path.join(root, relative)
      if (!input.id) {
        let first: unknown
        try {
          first = await readFirstJSONL(file)
        } catch {
          continue
        }
        if (!isRecord(first) || first.type !== "session_meta" || !isRecord(first.payload)) continue
        if (first.payload.cwd !== input.cwd) continue
      }
      files.push({ file, time: path.basename(file).slice("rollout-".length, 38) })
    }
    return files
      .sort((a, b) => b.time.localeCompare(a.time))
      .slice(0, 10)
      .map((entry) => entry.file)
  }

  // ── Format auto-detection from objects ────────────────────────────

  function detectFormat(objects: unknown[]): Format {
    for (const obj of objects) {
      const fmt = detect(obj)
      if (fmt) return fmt
    }
    throw new ParseError("Unrecognized session format")
  }

  // ── Parse entry ───────────────────────────────────────────────────

  /** Parse a JSONL file into a transcript. Uses node:readline streaming. */
  export async function parse(filepath: string): Promise<Transcript> {
    const objects = await readJSONL(filepath)
    if (objects.length === 0) throw new ParseError("Empty input")
    return parseObjects(objects)
  }

  /** Parse raw JSONL text into a transcript (for testing). */
  export function parseLines(text: string): Transcript {
    const trimmed = text.trim()
    if (trimmed.length === 0) throw new ParseError("Empty input")

    const objects: unknown[] = []
    const lines = trimmed.split("\n")

    for (const [i, raw] of lines.entries()) {
      const line = raw.trim()
      if (line.length === 0) continue
      const parsed = safeParse(line)
      if (parsed === undefined) throw new ParseError(`Line ${i + 1}: invalid JSON`)
      objects.push(parsed)
    }

    if (objects.length === 0) throw new ParseError("No valid JSON Lines found")
    return parseObjects(objects)
  }

  // ── Streaming read ────────────────────────────────────────────────

  async function readJSONL(filepath: string): Promise<unknown[]> {
    const objects: unknown[] = []
    const stream = fs.createReadStream(filepath, "utf-8")
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    let lineNum = 0
    let failure: ParseError | undefined

    return new Promise<unknown[]>((resolve, reject) => {
      rl.on("line", (raw: string) => {
        lineNum++
        const line = raw.trim()
        if (line.length === 0) return
        const parsed = safeParse(line)
        if (parsed === undefined) {
          failure = new ParseError(`Line ${lineNum}: invalid JSON`)
          rl.close()
          return
        }
        objects.push(parsed)
      })
      rl.on("close", () => {
        if (failure) reject(failure)
        else resolve(objects)
      })
      rl.on("error", (err) => reject(new ParseError("Failed to read file", err)))
    })
  }

  async function readFirstJSONL(filepath: string): Promise<unknown> {
    const stream = fs.createReadStream(filepath, "utf-8")
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    try {
      for await (const raw of rl) {
        const line = raw.trim()
        if (line) return safeParse(line)
      }
      return undefined
    } finally {
      rl.close()
      stream.destroy()
    }
  }

  // ── Parse objects ─────────────────────────────────────────────────

  function parseObjects(objects: unknown[]): Transcript {
    const format = detectFormat(objects)

    if (format === "claude") {
      const version = readClaudeVersion(objects)
      if (version !== SUPPORTED_CLAUDE_MAJOR) {
        throw new ParseError(`Unsupported Claude major version: ${version}`)
      }
      const model = extractClaudeModel(objects)
      const { steps, unsupported } = parseClaudeSteps(objects)
      return { format, version, steps, unsupported, sourceModel: model }
    }

    const version = readCodexVersion(objects)
    if (version === undefined) {
      throw new ParseError("Missing session_meta record in Codex transcript")
    }
    if (version !== SUPPORTED_CODEX_MAJOR) {
      throw new ParseError(`Unsupported Codex major version: ${version}`)
    }
    const model = extractCodexModel(objects)
    const { steps, unsupported } = parseCodexSteps(objects)
    return { format, version, steps, unsupported, sourceModel: model }
  }

  // ── Version reading ───────────────────────────────────────────────

  function readClaudeVersion(objects: unknown[]): number {
    for (const obj of objects) {
      if (!isRecord(obj)) continue
      const topType = obj.type
      if (topType !== "user" && topType !== "assistant") continue
      const ver = obj.version
      if (typeof ver === "string") {
        const major = parseInt(ver.split(".")[0], 10)
        if (!isNaN(major)) return major
      }
      // Version field missing or unparseable on a user/assistant record
      throw new ParseError("Claude record missing version field")
    }
    throw new ParseError("No Claude user or assistant records found")
  }

  function readCodexVersion(objects: unknown[]): number | undefined {
    for (const obj of objects) {
      if (!isRecord(obj) || obj.type !== "session_meta") continue
      const payload = obj.payload
      if (!isRecord(payload)) continue
      const cliVer = payload.cli_version
      const verStr = typeof cliVer === "string" ? cliVer : (isRecord(cliVer) ? String(cliVer.major ?? "") : "")
      if (verStr.length === 0) continue
      const major = parseInt(verStr.split(".")[0], 10)
      if (!isNaN(major)) return major
    }
  }

  function extractClaudeModel(objects: unknown[]): { providerID: string; modelID: string } | undefined {
    for (const obj of objects) {
      if (!isRecord(obj)) continue
      const topType = obj.type
      if (topType !== "user" && topType !== "assistant") continue
      const message = obj.message
      if (!isRecord(message)) continue
      const model = message.model
      if (typeof model === "string" && model.length > 0) {
        return { providerID: "anthropic", modelID: model }
      }
    }
  }

  function extractCodexModel(objects: unknown[]): { providerID: string; modelID: string } | undefined {
    let provider: string | undefined
    let model: string | undefined

    for (const obj of objects) {
      if (!isRecord(obj)) continue

      if (obj.type === "session_meta") {
        const payload = obj.payload
        if (!isRecord(payload)) continue
        const mp = payload.model_provider
        if (typeof mp === "string" && mp.length > 0) provider = mp
      }

      if (obj.type === "turn_context") {
        const payload = obj.payload
        if (!isRecord(payload)) continue
        const m = payload.model
        if (typeof m === "string" && m.length > 0) model = m
      }
    }

    if (provider && model) return { providerID: provider, modelID: model }
  }

  // ── Tool call error marking ────────────────────────────────────────

  function markUnpaired(step: Step): Step {
    const toolCalls = step.parts.filter((p): p is ToolCall => p.type === "tool_call")
    const resultIDs = new Set(
      step.parts.filter((p): p is ToolResult => p.type === "tool_result").map((r) => r.callID),
    )
    for (const tc of toolCalls) {
      if (!resultIDs.has(tc.id)) {
        step.parts.push({ type: "error", message: `Unpaired tool call: ${tc.name} (${tc.id})` })
      }
    }
    return step
  }

  function allCallsPaired(step: Step): boolean {
    const calls = step.parts.filter((p): p is ToolCall => p.type === "tool_call")
    if (calls.length === 0) return false
    const resultIDs = new Set(
      step.parts.filter((p): p is ToolResult => p.type === "tool_result").map((r) => r.callID),
    )
    return calls.every((tc) => resultIDs.has(tc.id))
  }

  function closeIfPaired(steps: Step[], step: Step | undefined): Step | undefined {
    if (step && step.role === "assistant" && allCallsPaired(step)) {
      steps.push(step)
      return undefined
    }
    return step
  }

  // ── Claude parser ─────────────────────────────────────────────────

  const CLAUDE_META_TYPES = new Set([
    "ai-title",
    "last-prompt",
    "snapshot",
    "mode",
    "attachment",
  ])

  function parseClaudeSteps(objects: unknown[]): { steps: Step[]; unsupported: number } {
    const steps: Step[] = []
    let pending: Step | undefined
    let unsupported = 0
    const seenIDs = new Map<string, ToolCall>()

    for (const obj of objects) {
      if (!isRecord(obj)) throw new ParseError("Expected JSON object")

      const topType = obj.type

      // Skip metadata records
      if (typeof topType === "string" && CLAUDE_META_TYPES.has(topType)) continue

      if (topType !== "user" && topType !== "assistant") continue

      // Skip sidechain records
      if (obj.isSidechain === true) continue

      const message = obj.message
      if (!isRecord(message)) throw new ParseError("Expected message object")
      const role = message.role
      if (role !== "user" && role !== "assistant") {
        throw new ParseError(`Unexpected message role: ${String(role)}`)
      }
      const content = typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : message.content
      if (!isArray(content)) throw new ParseError(`Expected string or content array for ${role}`)

      if (role === "assistant") {
        // Merge consecutive assistants into the open step
        if (pending && pending.role === "assistant") {
          const { parts, unsupported: u } = parseClaudeBlocks(content, seenIDs)
          unsupported += u
          pending.parts.push(...parts)
        } else {
          // New assistant — close any previous pending
          if (pending) {
            steps.push(markUnpaired(pending))
            pending = undefined
          }
          const { parts, unsupported: u } = parseClaudeBlocks(content, seenIDs)
          unsupported += u
          pending = { role: "assistant", parts }
        }
      } else {
        // role === "user"
        const hasToolResults = content.some(
          (block) => isRecord(block) && block.type === "tool_result",
        )

        if (hasToolResults && pending && pending.role === "assistant") {
          // Pair tool_results with the pending assistant's tool_calls
          const { results, unsupported: u } = parseClaudeToolResults(content)
          unsupported += u
          pending.parts.push(...results)

          // Check if all pending tool calls now have results
          const pendingCalls = pending.parts.filter((p): p is ToolCall => p.type === "tool_call")
          const pendingResults = pending.parts.filter((p): p is ToolResult => p.type === "tool_result")
          const resultIDs = new Set(pendingResults.map((r) => r.callID))
          const allPaired = pendingCalls.every((tc) => resultIDs.has(tc.id))

          if (allPaired) {
            // Close the step — result set complete
            steps.push(pending)
            pending = undefined
          }
          const userBlocks = content.filter(
            (block) => !isRecord(block) || (block.type !== "tool_result" && block.type !== "server_tool_result"),
          )
          if (userBlocks.length > 0) {
            if (pending) {
              steps.push(markUnpaired(pending))
              pending = undefined
            }
            const parsed = parseClaudeBlocks(userBlocks, seenIDs)
            unsupported += parsed.unsupported
            steps.push({ role: "user", parts: parsed.parts })
          }
        } else {
          // Non-tool-result user → close pending, start new user step
          if (pending) {
            steps.push(markUnpaired(pending))
            pending = undefined
          }
          const { parts, unsupported: u } = parseClaudeBlocks(content, seenIDs)
          unsupported += u
          steps.push({ role: "user", parts })
        }
      }
    }

    // Emit any remaining pending step
    if (pending) steps.push(markUnpaired(pending))

    return { steps, unsupported }
  }

  function parseClaudeBlocks(
    blocks: unknown[],
    seenIDs: Map<string, ToolCall>,
  ): { parts: Part[]; unsupported: number } {
    const parts: Part[] = []
    let unsupported = 0

    for (const block of blocks) {
      if (!isRecord(block)) {
        unsupported++
        continue
      }

      const type = block.type
      if (type === "text") {
        parts.push({ type: "text", text: String(block.text ?? "") })
      } else if (type === "thinking") {
        parts.push({ type: "reasoning", text: String(block.thinking ?? "") })
      } else if (type === "tool_use") {
        const tc: ToolCall = {
          type: "tool_call",
          id: String(block.id ?? ""),
          name: String(block.name ?? ""),
          input: block.input,
        }
        parts.push(tc)
        seenIDs.set(tc.id, tc)
      } else if (type === "tool_result") {
        parts.push({
          type: "tool_result",
          callID: String(block.tool_use_id ?? ""),
          content: extractToolContent(block.content).content,
          error: block.is_error === true,
        })
      } else if (type === "redacted_thinking") {
        unsupported++
        parts.push({ type: "unsupported", reason: "encrypted reasoning block" })
      } else {
        unsupported++
        parts.push({ type: "unsupported", reason: `unknown content type: ${String(type)}` })
      }
    }

    return { parts, unsupported }
  }

  function parseClaudeToolResults(
    blocks: unknown[],
  ): { results: Part[]; unsupported: number } {
    const results: Part[] = []
    let unsupported = 0

    for (const block of blocks) {
      if (!isRecord(block)) {
        unsupported++
        continue
      }

      if (block.type === "tool_result") {
        const callID = String(block.tool_use_id ?? "")
        const parsed = extractToolContent(block.content)
        unsupported += parsed.unsupported
        const content = parsed.content
        results.push({
          type: "tool_result",
          callID,
          content,
          error: block.is_error === true,
        })
      } else if (block.type === "server_tool_result") {
        unsupported++
        results.push({
          type: "unsupported",
          reason: "server_tool_result block",
        })
      } else if (block.type !== "text") {
        // Non-text, non-result block in user tool-result message → unsupported
        unsupported++
      }
    }

    return { results, unsupported }
  }

  /** Extract string content from Anthropic tool_result content (string or content block array). */
  function extractToolContent(content: unknown): { content: string; unsupported: number } {
    if (typeof content === "string") return { content, unsupported: 0 }
    if (isArray(content)) {
      const text = content
        .filter((item): item is Record<string, unknown> => isRecord(item) && item.type === "text")
        .map((item) => String(item.text ?? ""))
      const unsupported = content.filter((item) => !isRecord(item) || item.type !== "text").length
      return { content: text.join("\n"), unsupported }
    }
    if (isRecord(content)) return { content: JSON.stringify(content), unsupported: 0 }
    return { content: String(content ?? ""), unsupported: 0 }
  }

  // ── Codex parser ──────────────────────────────────────────────────

  function parseCodexSteps(objects: unknown[]): { steps: Step[]; unsupported: number } {
    const steps: Step[] = []
    let pending: Step | undefined
    let unsupported = 0
    let seenSessionMeta = false

    for (const obj of objects) {
      if (!isRecord(obj)) throw new ParseError("Expected JSON object")

      const itemType = obj.type

      if (itemType === "session_meta") {
        seenSessionMeta = true
        continue
      }

      if (itemType === "turn_context" || itemType === "event_msg" || itemType === "world_state") {
        // Metadata records — skip
        continue
      }

      if (itemType !== "response_item") {
        // Unknown top-level type
        unsupported++
        continue
      }

      const payload = obj.payload
      if (!isRecord(payload)) {
        unsupported++
        continue
      }

      const riType = payload.type

      if (riType === "message") {
        const role = payload.role

        if (role === "user") {
          // Close pending, start new user
          if (pending) {
            steps.push(markUnpaired(pending))
            pending = undefined
          }
          const text = extractCodexText(payload.content)
          steps.push({ role: "user", parts: [{ type: "text", text }] })
        } else if (role === "assistant") {
          // Assistant message — close pending if result set is complete
          const text = extractCodexText(payload.content)
          if (pending && pending.role === "assistant") {
            const pendingCalls = pending.parts.filter((p): p is ToolCall => p.type === "tool_call")
            const pendingResults = pending.parts.filter((p): p is ToolResult => p.type === "tool_result")
            const resultIDs = new Set(pendingResults.map((r) => r.callID))
            const allPaired = pendingCalls.length > 0 && pendingCalls.every((tc) => resultIDs.has(tc.id))
            if (allPaired) {
              steps.push(pending)
              pending = text.length > 0 ? { role: "assistant", parts: [{ type: "text", text }] } : undefined
            } else {
              // Pending has unpaired calls — merge text into it
              if (text.length > 0) pending.parts.push({ type: "text", text })
            }
          } else {
            // No pending or non-assistant pending — start new text-only step
            if (text.length > 0) {
              pending = { role: "assistant", parts: [{ type: "text", text }] }
            } else {
              // Empty assistant content — count as unsupported, skip
              unsupported++
            }
          }
        }
      } else if (riType === "function_call" || riType === "custom_tool_call") {
        // Close fully-paired step before starting a new tool round
        pending = closeIfPaired(steps, pending)

        const callID = String(payload.call_id ?? "")
        const name = String(payload.name ?? "")
        const input = parseCodexToolInput(riType, payload)

        const tc: ToolCall = { type: "tool_call", id: callID, name, input }
        const status = payload.status
        if (status === "failed" || status === "error" || status === "incomplete") tc.status = status

        if (pending && pending.role === "assistant") {
          pending.parts.push(tc)
        } else {
          if (pending) {
            steps.push(markUnpaired(pending))
            pending = undefined
          }
          pending = { role: "assistant", parts: [tc] }
        }
      } else if (riType === "function_call_output" || riType === "custom_tool_call_output") {
        const callID = String(payload.call_id ?? "")
        const parsed = extractCodexToolOutput(payload.output)
        unsupported += parsed.unsupported
        const content = parsed.content

        if (pending && pending.role === "assistant") {
          const toolCalls = pending.parts.filter((p): p is ToolCall => p.type === "tool_call")
          const found = toolCalls.some((tc) => tc.id === callID)
          if (found) {
            pending.parts.push({ type: "tool_result", callID, content })
          } else {
            unsupported++
          }
        } else {
          unsupported++
        }
      } else if (riType === "reasoning") {
        // Close fully-paired step before reasoning in case it starts a new turn
        pending = closeIfPaired(steps, pending)

        const summary = payload.summary
        const text = extractCodexReasoningText(summary)

        if (text.length === 0) {
          // Encrypted-only reasoning
          unsupported++
          if (pending && pending.role === "assistant") {
            pending.parts.push({ type: "unsupported", reason: "encrypted reasoning block" })
          } else {
            // Track as unsupported without adding to steps directly
          }
        } else {
          if (pending && pending.role === "assistant") {
            pending.parts.push({ type: "reasoning", text })
          } else {
            if (pending) {
              steps.push(markUnpaired(pending))
              pending = undefined
            }
            pending = { role: "assistant", parts: [{ type: "reasoning", text }] }
          }
        }
      } else {
        // Unknown response_item type
        unsupported++
      }
    }

    if (!seenSessionMeta) {
      throw new ParseError("Missing session_meta record in Codex transcript")
    }

    // Emit pending step
    if (pending) steps.push(markUnpaired(pending))

    return { steps, unsupported }
  }

  function parseCodexToolInput(riType: string, payload: Record<string, unknown>): unknown {
    if (riType === "function_call") {
      const args = payload.arguments
      const str = typeof args === "string" ? args : JSON.stringify(args ?? {})
      const parsed = safeParse(str)
      if (isRecord(parsed)) return parsed
      return { raw: str }
    }
    // custom_tool_call — input is already an object
    const input = payload.input
    if (isRecord(input)) return input
    return { raw: JSON.stringify(input ?? {}) }
  }

  function extractCodexText(content: unknown): string {
    if (typeof content === "string") return content
    if (isArray(content)) {
      return (content as unknown[])
        .filter((c): c is Record<string, unknown> => isRecord(c))
        .filter((c) => c.type === "input_text" || c.type === "output_text" || c.type === "text")
        .map((c) => String(c.text ?? ""))
        .join("")
    }
    return ""
  }

  function extractCodexToolOutput(output: unknown): { content: string; unsupported: number } {
    if (typeof output === "string") return { content: output, unsupported: 0 }
    if (isArray(output)) {
      const text = output
        .filter(
          (item): item is Record<string, unknown> =>
            isRecord(item) && (item.type === "input_text" || item.type === "output_text" || item.type === "text"),
        )
        .map((item) => String(item.text ?? ""))
      const unsupported = output.filter(
        (item) =>
          !isRecord(item) || (item.type !== "input_text" && item.type !== "output_text" && item.type !== "text"),
      ).length
      return { content: text.join("\n"), unsupported }
    }
    if (isRecord(output)) return { content: JSON.stringify(output), unsupported: 0 }
    return { content: String(output ?? ""), unsupported: 0 }
  }

  function extractCodexReasoningText(summary: unknown): string {
    if (!isArray(summary)) return ""
    return (summary as unknown[])
      .filter((c): c is Record<string, unknown> => isRecord(c) && c.type === "summary_text")
      .map((c) => String((c as Record<string, unknown>).text ?? ""))
      .join("")
  }

  // ── Mapping ────────────────────────────────────────────────────────

  const IMPORT_NOTICE = "---\n*This conversation was imported from an external session. Some tool outputs and context may not be fully represented.*"

  export type MappedMessage = {
    info: Record<string, any>
    parts: Record<string, any>[]
  }

  /**
   * Map a parsed Transcript to ordered message info + part records ready for
   * session write. Uses ascending IDs in transcript order.
   */
  export function mapTranscript(
    transcript: Transcript,
    opts: {
      sessionID: string
      agent: string
      providerID: string
      modelID: string
      directory: string
      worktree: string
      sourceModel?: { providerID: string; modelID: string }
    },
  ): { messages: MappedMessage[]; dropped: string[] } {
    idCounter = 0
    const msgs: MappedMessage[] = []
    const dropped: string[] = []

    for (const step of transcript.steps) {
      if (step.role === "user") {
        const info = {
          id: id("message"),
          sessionID: opts.sessionID,
          role: "user" as const,
          time: { created: Date.now() },
          agent: opts.agent,
          model: { providerID: opts.providerID, modelID: opts.modelID },
        }
        const { parts, dropped: d } = mapUserParts(step.parts, info.id, opts.sessionID)
        dropped.push(...d)
        msgs.push({ info, parts })
      } else {
        // assistant
        const parentID = lastUserID(msgs)
        const src = opts.sourceModel ?? { providerID: opts.providerID, modelID: opts.modelID }
        const now = Date.now()
        const info = {
          id: id("message"),
          sessionID: opts.sessionID,
          role: "assistant" as const,
          parentID,
          time: { created: now, completed: now },
          mode: opts.agent,
          agent: opts.agent,
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: src.modelID,
          providerID: src.providerID,
          path: { cwd: opts.directory, root: opts.worktree },
          finish: "stop" as const,
        }
        const { parts, dropped: d } = mapAssistantParts(step.parts, info.id, opts.sessionID)
        dropped.push(...d)
        msgs.push({ info, parts })
      }
    }

    // Append the ignored import notice to the final assistant.
    attachNotice(msgs, transcript.unsupported, dropped, opts)

    return { messages: msgs, dropped }
  }

  let idCounter = 0
  function id(prefix: "message" | "part"): string {
    idCounter++
    return `__resume_${prefix}_${idCounter}`
  }

  function lastUserID(msgs: MappedMessage[]): string {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const info = msgs[i].info
      if (info.role === "user" && typeof info.id === "string") return info.id
    }
    return ""
  }

  function mapUserParts(parts: Part[], msgID: string, sesID: string): { parts: Record<string, unknown>[]; dropped: string[] } {
    const out: Record<string, unknown>[] = []
    const dropped: string[] = []
    for (const part of parts) {
      const base = { id: id("part"), messageID: msgID, sessionID: sesID }
      if (part.type === "text") {
        out.push({ ...base, type: "text", text: part.text })
      } else if (part.type === "tool_result") {
        out.push({
          ...base,
          type: "text",
          text: `Tool result for ${part.callID}: ${part.content}`,
          synthetic: true,
        })
      } else if (part.type === "unsupported") {
        dropped.push(part.reason)
      } else if (part.type === "error") {
        dropped.push(`error: ${part.message}`)
      }
      // reasoning, tool_call in user messages are ignored (should not happen)
    }
    return { parts: out, dropped }
  }

  function mapAssistantParts(parts: Part[], msgID: string, sesID: string): { parts: Record<string, unknown>[]; dropped: string[] } {
    const now = Date.now()
    const toolParts = new Map<string, Array<{ part: Record<string, unknown>; index: number; status?: ToolCall["status"] }>>()
    const results: Part[] = []
    const out: Record<string, unknown>[] = []
    const dropped: string[] = []
    const base = (): { id: string; messageID: string; sessionID: string } => ({
      id: id("part"),
      messageID: msgID,
      sessionID: sesID,
    })

    // Pass 1: collect tool calls + results, emit non-tool parts
    for (const part of parts) {
      if (part.type === "tool_call") {
        const p = {
          ...base(),
          type: "tool",
          callID: part.id || `tc_${toolParts.size}`,
          tool: part.name,
          state: {
            status: "running" as const,
            input: isRecord(part.input) ? part.input : { raw: part.input },
            time: { start: now },
          },
        }
        out.push(p)
        const entries = toolParts.get(part.id) ?? []
        entries.push({ part: p, index: out.length - 1, status: part.status })
        toolParts.set(part.id, entries)
      } else if (part.type === "tool_result") {
        results.push(part)
      } else if (part.type === "text") {
        out.push({ ...base(), type: "text", text: part.text })
      } else if (part.type === "reasoning") {
        out.push({ ...base(), type: "reasoning", text: part.text, time: { start: now } })
      } else if (part.type === "unsupported") {
        dropped.push(part.reason)
      } else if (part.type === "error") {
        dropped.push(`error: ${part.message}`)
      }
    }

    // Pass 2: pair results with tool calls
    for (const item of results) {
      const result = item as ToolResult
        const entry = toolParts.get(result.callID)?.find(
          (candidate) => (candidate.part.state as Record<string, unknown>).status === "running",
        )
      if (entry) {
        const tp = entry.part
        if (result.error) {
          tp.state = {
            status: "error" as const,
            input: (tp.state as Record<string, unknown>).input,
            error: result.content || "Tool call returned an error.",
            time: { start: now, end: now },
          }
        } else {
          tp.state = {
            status: "completed" as const,
            input: (tp.state as Record<string, unknown>).input,
            output: result.content,
            title: (tp as Record<string, unknown>).tool as string,
            metadata: {},
            time: { start: now, end: now },
          }
        }
        out[entry.index] = tp
      } else {
        out.push({ ...base(), type: "text", text: `Tool result: ${result.content}`, synthetic: true })
      }
    }

    // Mark any still-running tool calls as error
    for (const entries of toolParts.values()) {
      for (const entry of entries) {
        const tp = entry.part
        if ((tp.state as Record<string, unknown>).status === "running") {
          tp.state = {
            status: "error" as const,
            input: (tp.state as Record<string, unknown>).input,
            error: entry.status ?? "No result received for this tool call.",
            time: { start: now, end: now },
          }
          out[entry.index] = tp
        }
      }
    }

    return { parts: out, dropped }
  }

  function attachNotice(
    msgs: MappedMessage[],
    unsupported: number,
    dropped: string[],
    opts: {
      sessionID: string
      agent: string
      providerID: string
      modelID: string
      directory: string
      worktree: string
    },
  ) {
    const lines: string[] = [IMPORT_NOTICE]
    if (unsupported > 0) lines.push(`${unsupported} unsupported item(s) were skipped during import.`)
    if (dropped.length > 0) {
      const unique = [...new Set(dropped)]
      lines.push(`Dropped unsupported content: ${unique.join(", ")}.`)
    }
    const text = lines.join("\n\n")

    const last = msgs.at(-1)
    if (last?.info.role === "assistant") {
      // Append notice to the last assistant
      last.parts.push({
        id: id("part"),
        messageID: last.info.id as string,
        sessionID: opts.sessionID,
        type: "text",
        text,
        synthetic: true,
        ignored: true,
      })
      return
    }

    // No assistant yet — create a complete notice-only assistant after the last user
    const parent = lastUserID(msgs)
    const info = {
      id: id("message"),
      sessionID: opts.sessionID,
      role: "assistant" as const,
      parentID: parent,
      time: { created: Date.now(), completed: Date.now() },
      mode: opts.agent,
      agent: opts.agent,
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: opts.modelID,
      providerID: opts.providerID,
      path: { cwd: opts.directory, root: opts.worktree },
      finish: "stop" as const,
    }
    const parts = [
      {
        id: id("part"),
        messageID: info.id,
        sessionID: opts.sessionID,
        type: "text" as const,
        text,
        synthetic: true,
        ignored: true,
      },
    ]
    msgs.push({ info, parts })
  }

  // ── Command definitions ────────────────────────────────────────────

  export const resumeClaude = {
    name: "resume-claude",
    description: "import a Claude Code session transcript",
    source: "command" as const,
    template: "",
    hints: ["$ARGUMENTS"],
  }

  export const resumeCodex = {
    name: "resume-codex",
    description: "import an OpenAI Codex session transcript",
    source: "command" as const,
    template: "",
    hints: ["$ARGUMENTS"],
  }
}
