import { Ripgrep } from "../file/ripgrep"
import { Process } from "../util/process"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { text } from "node:stream/consumers"
import fs from "node:fs/promises"
import path from "node:path"

const log = Log.create({ service: "warpgrep" })

const API_URL = "https://api.morphllm.com/v1/chat/completions"
const MODEL = "morph-warp-grep-v2"
const MAX_TURNS = 4
const MAX_TOOL_CALLS_PER_TURN = 8
const CONTEXT_BUDGET = 160000

interface Message {
  role: "user" | "assistant"
  content: string
}

interface ToolCall {
  name: string
  params: string
}

export namespace WarpGrep {
  export function parseToolCalls(content: string): ToolCall[] {
    return [...content.matchAll(/<tool_call><function=(\w+)>([\s\S]*?)<\/function><\/tool_call>/g)].map((m) => ({
      name: m[1],
      params: m[2],
    }))
  }

  export async function readFile(filepath: string, ranges?: string): Promise<string> {
    const resolved = path.isAbsolute(filepath) ? filepath : path.resolve(Instance.directory, filepath)
    const file = Bun.file(resolved)
    const exists = await file.exists()
    if (!exists) return `Error: file not found: ${filepath}`

    const content = await file.text()
    const lines = content.split("\n")

    if (!ranges) return content

    const parts: string[] = []
    for (const range of ranges.split(",")) {
      const trimmed = range.trim()
      const [startStr, endStr] = trimmed.split("-")
      const start = Math.max(1, parseInt(startStr, 10))
      const end = endStr ? Math.min(lines.length, parseInt(endStr, 10)) : start
      parts.push(lines.slice(start - 1, end).join("\n"))
    }
    return parts.join("\n...\n")
  }

  export async function listDirectory(dir: string): Promise<string> {
    const resolved = path.isAbsolute(dir) ? dir : path.resolve(Instance.directory, dir)
    const entries = await fs.readdir(resolved, { withFileTypes: true })
    return entries.map((e) => (e.isDirectory() ? e.name + "/" : e.name)).join("\n")
  }

  async function executeRipgrep(pattern: string, include?: string, signal?: AbortSignal): Promise<string> {
    const rg = await Ripgrep.filepath()
    const args = [rg, "--no-heading", "--line-number", "--max-count=50", "--hidden", "--glob=!.git/*"]
    if (include) args.push(`--glob=${include}`)
    args.push("--", pattern, Instance.directory)

    const proc = Process.spawn(args, {
      cwd: Instance.directory,
      stdout: "pipe",
      stderr: "pipe",
      abort: signal,
    })

    if (!proc.stdout) return "Error: process output not available"

    const output = await text(proc.stdout)
    await proc.exited
    return output.trim() || "No matches found"
  }

  async function executeTool(call: ToolCall, signal?: AbortSignal): Promise<string> {
    try {
      if (call.name === "ripgrep") {
        const parsed = JSON.parse(call.params)
        return executeRipgrep(parsed.pattern, parsed.include, signal)
      }

      if (call.name === "read") {
        const parsed = JSON.parse(call.params)
        return readFile(parsed.path, parsed.lines)
      }

      if (call.name === "list_directory") {
        const parsed = JSON.parse(call.params)
        return listDirectory(parsed.path || ".")
      }

      return `Unknown tool: ${call.name}`
    } catch (e) {
      if (e instanceof SyntaxError) return `Error parsing tool params: ${e.message}`
      throw e
    }
  }

  export async function handleFinish(params: string): Promise<string> {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(params)
    } catch {
      return `Error parsing finish params: invalid JSON`
    }
    const files = parsed.files as string
    if (!files) return "No files specified"

    const results: string[] = []
    for (const line of files.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed) continue

      const colonIdx = trimmed.indexOf(":")
      if (colonIdx === -1) {
        const content = await readFile(trimmed)
        results.push(`--- ${trimmed} ---\n${content}`)
        continue
      }

      const filepath = trimmed.slice(0, colonIdx)
      const ranges = trimmed.slice(colonIdx + 1)
      const content = await readFile(filepath, ranges)
      results.push(`--- ${filepath} ---\n${content}`)
    }

    return results.join("\n\n")
  }

  export function key(): string | undefined {
    return process.env["WARPGREP_API_KEY"] || process.env["MORPH_API_KEY"]
  }

  export async function search(query: string, apiKey: string, signal?: AbortSignal): Promise<string> {
    const tree = await Ripgrep.tree({ cwd: Instance.directory, limit: 500, signal })

    const messages: Message[] = [
      {
        role: "user",
        content: `<repo_structure>\n${tree}\n</repo_structure>\n\n<search_string>\n${query}\n</search_string>`,
      },
    ]

    let totalChars = 0

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      log.info("warpgrep turn", { turn: turn + 1, messages: messages.length })

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
        }),
        signal,
      })

      if (!response.ok) {
        const err = await response.text()
        throw new Error(`WarpGrep API error (${response.status}): ${err}`)
      }

      const data: { choices: { message: { content: string } }[] } = await response.json()
      const content = data.choices[0]?.message?.content
      if (!content) throw new Error("WarpGrep API returned empty response")

      messages.push({ role: "assistant", content })

      const calls = parseToolCalls(content)
      if (calls.length === 0) return content

      const bounded = calls.slice(0, MAX_TOOL_CALLS_PER_TURN)

      // Handle finish immediately if present
      const finish = bounded.find((c) => c.name === "finish")
      if (finish) return handleFinish(finish.params)

      // Execute tool calls in parallel
      const results = await Promise.all(bounded.map((call) => executeTool(call, signal)))

      const responses: string[] = []
      for (const result of results) {
        totalChars += result.length
        const truncated =
          totalChars > CONTEXT_BUDGET
            ? result.slice(0, Math.max(0, CONTEXT_BUDGET - totalChars + result.length)) + "\n[truncated]"
            : result
        responses.push(`<tool_response>\n${truncated}\n</tool_response>`)
      }

      const turnInfo = `[Turn ${turn + 1}/${MAX_TURNS}]`
      messages.push({
        role: "user",
        content: `${responses.join("\n")}\n${turnInfo}`,
      })
    }

    return messages[messages.length - 1]?.content || "WarpGrep search completed without results"
  }
}
