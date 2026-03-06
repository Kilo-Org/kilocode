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
const MAX_OUTPUT_LINES = 200
const MAX_READ_LINES = 800
const MAX_CONTEXT_CHARS = 540_000
const TRUNCATED_MARKER = "[truncated for context limit]"

interface Message {
  role: "user" | "assistant"
  content: string
}

interface ToolCall {
  name: string
  arguments: Record<string, unknown>
}

interface FinishFile {
  path: string
  lines: "*" | Array<[number, number]>
}

export namespace WarpGrep {
  export function parseToolCalls(content: string): ToolCall[] {
    const stripped = content.replace(/<think>[\s\S]*?<\/think>/gi, "")
    const calls: ToolCall[] = []
    const regex = /<tool_call>\s*<function=([a-z_][a-z0-9_]*)>([\s\S]*?)<\/function>\s*<\/tool_call>/gi
    let match

    while ((match = regex.exec(stripped)) !== null) {
      const name = match[1].toLowerCase()
      const body = match[2]

      const params: Record<string, string> = {}
      const paramRegex = /<parameter=([a-z_][a-z0-9_]*)>([\s\S]*?)<\/parameter>/gi
      let paramMatch
      while ((paramMatch = paramRegex.exec(body)) !== null) {
        params[paramMatch[1].toLowerCase()] = paramMatch[2].trim()
      }

      if (name === "ripgrep") {
        if (!params.pattern) continue
        calls.push({
          name: "grep",
          arguments: {
            pattern: params.pattern,
            path: params.path || ".",
            ...(params.glob && { glob: params.glob }),
            ...(params.context_lines && { context_lines: parseInt(params.context_lines, 10) }),
            ...(params.case_sensitive && { case_sensitive: params.case_sensitive === "true" }),
          },
        })
      } else if (name === "list_directory") {
        calls.push({ name: "list_directory", arguments: { path: params.path || "." } })
      } else if (name === "read") {
        if (!params.path) continue
        const args: Record<string, unknown> = { path: params.path }
        if (params.lines) {
          const ranges: Array<[number, number]> = []
          for (const r of params.lines.split(",")) {
            const t = r.trim()
            if (!t) continue
            const [s, e] = t.split("-").map((v) => parseInt(v.trim(), 10))
            if (Number.isFinite(s) && Number.isFinite(e)) ranges.push([s, e])
            else if (Number.isFinite(s)) ranges.push([s, s])
          }
          if (ranges.length === 1) {
            args.start = ranges[0][0]
            args.end = ranges[0][1]
          } else if (ranges.length > 1) {
            args.lines = ranges
          }
        }
        calls.push({ name: "read", arguments: args })
      } else if (name === "finish") {
        if (params.result && !params.files) {
          calls.push({ name: "finish", arguments: { files: [], textResult: params.result } })
          continue
        }
        if (!params.files) {
          calls.push({ name: "finish", arguments: { files: [], textResult: "No relevant code found." } })
          continue
        }
        const files: FinishFile[] = []
        for (const line of params.files.split("\n")) {
          const trimmed = line.trim()
          if (!trimmed) continue
          const colonIdx = trimmed.indexOf(":")
          if (colonIdx === -1) {
            files.push({ path: trimmed, lines: "*" })
            continue
          }
          const fp = trimmed.slice(0, colonIdx)
          const rangesPart = trimmed.slice(colonIdx + 1)
          const ranges: Array<[number, number]> = []
          let whole = false
          for (const r of rangesPart.split(",")) {
            const rt = r.trim()
            if (!rt || rt === "*") {
              whole = true
              break
            }
            const [s, e] = rt.split("-").map((v) => parseInt(v.trim(), 10))
            if (Number.isFinite(s) && Number.isFinite(e)) ranges.push([s, e])
            else if (Number.isFinite(s)) ranges.push([s, s])
          }
          if (whole) files.push({ path: fp, lines: "*" })
          else if (ranges.length > 0) files.push({ path: fp, lines: ranges })
          else if (!files.some((f) => f.path === fp)) files.push({ path: fp, lines: "*" })
        }
        calls.push({
          name: "finish",
          arguments: files.length > 0 ? { files } : { files: [], textResult: params.files },
        })
      }
    }

    return calls
  }

  function resolvePath(filepath: string): string {
    return path.isAbsolute(filepath) ? filepath : path.resolve(Instance.directory, filepath)
  }

  function formatTurnMessage(turn: number): string {
    const remaining = MAX_TURNS - turn
    if (remaining === 1)
      return `\nYou have used ${turn} turns, you only have 1 turn remaining. You have run out of turns to explore the code base and MUST call the finish tool now`
    return `\nYou have used ${turn} turn${turn === 1 ? "" : "s"} and have ${remaining} remaining`
  }

  function calcContextBudget(messages: Message[]): string {
    const total = messages.reduce((sum, m) => sum + m.content.length, 0)
    const percent = Math.round((total / MAX_CONTEXT_CHARS) * 100)
    const usedK = Math.round(total / 1000)
    const maxK = Math.round(MAX_CONTEXT_CHARS / 1000)
    return `<context_budget>${percent}% (${usedK}K/${maxK}K chars)</context_budget>`
  }

  function enforceContextLimit(messages: Message[]) {
    const total = () => messages.reduce((sum, m) => sum + m.content.length, 0)
    if (total() <= MAX_CONTEXT_CHARS) return
    let first = true
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role !== "user") continue
      if (first) {
        first = false
        continue
      }
      if (total() <= MAX_CONTEXT_CHARS) break
      if (messages[i].content !== TRUNCATED_MARKER) messages[i] = { role: "user", content: TRUNCATED_MARKER }
    }
  }

  async function execGrep(args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const pattern = args.pattern as string
    const target = (args.path as string) || "."
    const glob = args.glob as string | undefined
    const ctx = args.context_lines !== undefined ? String(args.context_lines) : "1"

    const rg = await Ripgrep.filepath()
    const cmd = [
      rg,
      "--no-heading",
      "--with-filename",
      "--line-number",
      "--color=never",
      "--trim",
      "--max-columns=400",
      "-C",
      ctx,
      ...(args.case_sensitive === false ? ["--ignore-case"] : []),
      ...(glob ? ["--glob", glob] : []),
      "-g",
      "!.git",
      "-g",
      "!node_modules",
      "-g",
      "!dist",
      "-g",
      "!build",
      "-g",
      "!*.min.js",
      "-g",
      "!*.min.css",
      "-g",
      "!*.map",
      "-g",
      "!*.lock",
      "-g",
      "!bun.lockb",
      pattern,
      target,
    ]

    const proc = Process.spawn(cmd, {
      cwd: Instance.directory,
      stdout: "pipe",
      stderr: "pipe",
      abort: signal,
    })
    if (!proc.stdout) return "no matches"

    const output = await text(proc.stdout)
    await proc.exited

    const lines = output.trim().split("\n").filter(Boolean)
    if (lines.length === 0) return "no matches"
    if (lines.length > MAX_OUTPUT_LINES) {
      const truncated = lines.slice(0, MAX_OUTPUT_LINES)
      truncated.push(`... (output truncated at ${MAX_OUTPUT_LINES} of ${lines.length} lines)`)
      return truncated.join("\n")
    }
    return lines.join("\n")
  }

  async function execRead(args: Record<string, unknown>): Promise<string> {
    const filepath = args.path as string
    const resolved = resolvePath(filepath)
    const file = Bun.file(resolved)
    if (!(await file.exists())) return `[FILE NOT FOUND] No file at "${filepath}"`

    const allLines = (await file.text()).split("\n")
    const total = allLines.length

    const ranges = args.lines as Array<[number, number]> | undefined
    if (ranges && Array.isArray(ranges)) {
      const chunks: string[] = []
      for (const [s, e] of ranges) {
        const start = Math.max(1, s)
        const end = Math.min(total, e)
        const out: string[] = []
        for (let i = start; i <= end; i++) out.push(`${i}|${allLines[i - 1] ?? ""}`)
        chunks.push(out.join("\n"))
      }
      const result = chunks.join("\n...\n")
      const resultLines = result.split("\n")
      if (resultLines.length > MAX_READ_LINES)
        return resultLines.slice(0, MAX_READ_LINES).join("\n") + `\n... (truncated at ${MAX_READ_LINES} lines)`
      return result
    }

    const start = Math.max(1, (args.start as number) ?? 1)
    const end = Math.min(total, (args.end as number) ?? total)
    const out: string[] = []
    for (let i = start; i <= end; i++) out.push(`${i}|${allLines[i - 1] ?? ""}`)
    if (out.length > MAX_READ_LINES)
      return out.slice(0, MAX_READ_LINES).join("\n") + `\n... (truncated at ${MAX_READ_LINES} lines)`
    return out.join("\n")
  }

  async function execListDir(args: Record<string, unknown>): Promise<string> {
    const dir = (args.path as string) || "."
    const resolved = resolvePath(dir)
    const stat = await fs.stat(resolved).catch(() => null)
    if (!stat?.isDirectory()) return "empty"

    const entries = await fs.readdir(resolved, { withFileTypes: true })
    const lines = entries
      .filter((e) => !e.name.startsWith(".") && !["node_modules", "dist", "build", "__pycache__"].includes(e.name))
      .map((e) => (e.isDirectory() ? e.name + "/" : e.name))
    if (lines.length === 0) return "empty"
    if (lines.length > MAX_OUTPUT_LINES) {
      return lines.slice(0, MAX_OUTPUT_LINES).join("\n") + `\n... (truncated at ${MAX_OUTPUT_LINES} entries)`
    }
    return lines.join("\n")
  }

  async function executeTool(call: ToolCall, signal?: AbortSignal): Promise<string> {
    try {
      if (call.name === "grep") return await execGrep(call.arguments, signal)
      if (call.name === "read") return await execRead(call.arguments)
      if (call.name === "list_directory") return await execListDir(call.arguments)
      return ""
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }

  async function resolveFinish(files: FinishFile[]): Promise<string> {
    const parts: string[] = ["Morph Fast Context subagent performed search on repository:\n", "Relevant context found:"]
    for (const f of files) {
      const rangeStr = f.lines === "*" ? "*" : f.lines.map(([s, e]) => `${s}-${e}`).join(",")
      parts.push(`- ${f.path}:${rangeStr}`)
    }
    parts.push("\nHere is the content of files:\n")

    for (const f of files) {
      const resolved = resolvePath(f.path)
      const file = Bun.file(resolved)
      if (!(await file.exists())) {
        parts.push(`<file path="${f.path}">`, `[couldn't find: ${f.path}]`, "</file>\n")
        continue
      }

      const allLines = (await file.text()).split("\n")
      if (f.lines === "*") {
        parts.push(`<file path="${f.path}">`, allLines.join("\n"), "</file>\n")
        continue
      }

      const rangeStr = f.lines.map(([s, e]) => `${s}-${e}`).join(",")
      parts.push(`<file path="${f.path}" lines="${rangeStr}">`)
      const chunks: string[] = []
      for (let i = 0; i < f.lines.length; i++) {
        const [s, e] = f.lines[i]
        if (i === 0 && s > 1) chunks.push(`// ... existing code, block starting at line ${s} ...`)
        else if (i > 0) chunks.push(`// ... existing code, block starting at line ${s} ...`)
        chunks.push(allLines.slice(Math.max(0, s - 1), Math.min(allLines.length, e)).join("\n"))
      }
      parts.push(chunks.join("\n"), "</file>\n")
    }

    return parts.join("\n")
  }

  export function key(): string | undefined {
    return process.env["WARPGREP_API_KEY"] || process.env["MORPH_API_KEY"]
  }

  export async function search(query: string, apiKey: string, signal?: AbortSignal): Promise<string> {
    const tree = await Ripgrep.tree({ cwd: Instance.directory, limit: 500, signal })
    const messages: Message[] = []
    const budget = calcContextBudget(messages)
    messages.push({
      role: "user",
      content: `<repo_structure>\n${tree}\n</repo_structure>\n\n<search_string>\n${query}\n</search_string>\n${budget}\nTurn 0/${MAX_TURNS}`,
    })

    for (let turn = 1; turn <= MAX_TURNS; turn++) {
      log.info("warpgrep turn", { turn, messages: messages.length })
      enforceContextLimit(messages)

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0,
          max_tokens: 2048,
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

      const finishCall = calls.find((c) => c.name === "finish")
      if (finishCall) {
        const { files, textResult } = finishCall.arguments as { files: FinishFile[]; textResult?: string }
        if (!files || files.length === 0) return textResult || "No relevant code found."
        return resolveFinish(files)
      }

      const results = await Promise.all(calls.map((call) => executeTool(call, signal)))
      const responses = results
        .map((r) => r.trim())
        .filter(Boolean)
        .map((r) => `<tool_response>\n${r}\n</tool_response>`)

      if (responses.length > 0) {
        const turnMsg = formatTurnMessage(turn)
        const ctxBudget = calcContextBudget(messages)
        messages.push({ role: "user", content: responses.join("\n") + turnMsg + "\n" + ctxBudget })
      }
    }

    return "WarpGrep search completed without results"
  }
}
