import path from "path"
import { MemoryToken } from "./token"
import { MemorySchema } from "../schema"

/** Byte-budget capping, freshness fingerprinting, and the index envelope (the ```kilo-memory-v1 block). */
export namespace MemoryBudget {
  export type Result = {
    text: string
    bytes: number
    tokens: number
    truncated: boolean
  }

  function rootName(root: string) {
    const dir = path.basename(root)
    return dir || "project"
  }

  export function fingerprint(limits: MemorySchema.Limits) {
    return `limits: ${limits.maxProjectIndexBytes}/${limits.maxRecentSessions}/${limits.maxSessionLineChars}`
  }

  /** True when the index was built with the same limits; a limits change must invalidate it. */
  export function fresh(input: string, limits: MemorySchema.Limits) {
    return input.includes(`\n${fingerprint(limits)}\n`)
  }

  function wrap(input: { root: string; limits: MemorySchema.Limits; lines: string[] }) {
    if (input.lines.length === 0) return ""
    return [
      "```kilo-memory-v1 context_not_instruction",
      "scope: project",
      `root: ${rootName(input.root)}`,
      fingerprint(input.limits),
      "",
      ...input.lines,
      "```",
      "",
    ].join("\n")
  }

  export function cap(input: string, max: number): Result {
    if (!input.trim()) return { text: "", bytes: 0, tokens: 0, truncated: false }
    const all = input.endsWith("\n") ? input : `${input}\n`
    if (Buffer.byteLength(all) <= max) {
      return {
        text: all,
        bytes: Buffer.byteLength(all),
        tokens: MemoryToken.estimate(all),
        truncated: false,
      }
    }

    const lines = all.split("\n")
    const close = lines.findIndex((line, idx) => idx > 0 && line.trim() === "```")
    if (lines[0]?.startsWith("```kilo-memory-v1") && close > 0) {
      const foot = `${lines[close]}\n`
      // This branch always truncates, so reserve room for a note telling the model how to list the
      // rest — but never at tiny budgets where the note would displace actual memory.
      const note = "note: index truncated; call kilo_memory_recall mode=typed query=<topic> to search omitted memory"
      const reserve = max >= 1024 ? Buffer.byteLength(`${note}\n`) : 0
      const kept = [lines[0]]
      let bytes = Buffer.byteLength(`${lines[0]}\n`) + Buffer.byteLength(foot) + reserve
      for (const line of lines.slice(1, close)) {
        const next = `${line}\n`
        const size = Buffer.byteLength(next)
        if (bytes + size > max) break
        kept.push(line)
        bytes += size
      }
      while (kept.at(-1)?.startsWith("record ")) kept.pop()
      if (reserve) kept.push(note)
      const text = `${kept.join("\n")}\n${foot}`
      if (Buffer.byteLength(text) <= max) {
        return {
          text,
          bytes: Buffer.byteLength(text),
          tokens: MemoryToken.estimate(text),
          truncated: true,
        }
      }
    }
    const kept: string[] = []
    let bytes = 0
    for (const line of lines) {
      const next = `${line}\n`
      const size = Buffer.byteLength(next)
      if (bytes + size > max) break
      kept.push(line)
      bytes += size
    }
    const text = `${kept.join("\n")}\n`
    return {
      text,
      bytes: Buffer.byteLength(text),
      tokens: MemoryToken.estimate(text),
      truncated: true,
    }
  }

  export function stale(input: string) {
    return !input.trimStart().startsWith("```kilo-memory-v1")
  }

  export function result(input: { root: string; limits: MemorySchema.Limits; lines: string[]; max: number }) {
    return cap(wrap({ root: input.root, limits: input.limits, lines: input.lines }), input.max)
  }
}
