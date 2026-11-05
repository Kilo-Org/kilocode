import type * as vscode from "vscode"
import { NOTEBOOK_LIMITS, type NotebookOutput, type NotebookText } from "./types"

const decoder = new TextDecoder()
const encoder = new TextEncoder()
const ERROR_MIME = "application/vnd.code.notebook.error"
const TEXT_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "application/json",
  "application/vnd.code.notebook.stdout",
  "application/vnd.code.notebook.stderr",
])

function slice(data: Uint8Array, limit: number): NotebookText {
  const bytes = data.byteLength
  if (bytes <= limit) return { text: decoder.decode(data), bytes }
  const end = (() => {
    let index = limit
    while (index > 0 && (data[index] & 0xc0) === 0x80) index--
    return index
  })()
  return { text: decoder.decode(data.subarray(0, end)), bytes, truncated: true }
}

export function normalizeSource(source: string, limit = NOTEBOOK_LIMITS.source): NotebookText {
  return slice(encoder.encode(source), limit)
}

function field(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined
  return value.slice(0, limit)
}

function error(item: vscode.NotebookCellOutputItem, limit: number): NotebookOutput {
  const value = slice(item.data, limit)
  const parsed = (() => {
    try {
      return JSON.parse(value.text) as unknown
    } catch (err) {
      void err
      return undefined
    }
  })()
  const data = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {}
  return {
    mime: item.mime.slice(0, 200),
    text: value.text,
    name: field(data.name, 500),
    message: field(data.message, 10_000),
    stack: field(data.stack, 50_000),
    truncated: value.truncated,
  }
}

export function normalizeOutputs(
  outputs: readonly vscode.NotebookCellOutput[],
  limit = NOTEBOOK_LIMITS.output,
): { outputs: NotebookOutput[]; truncated: boolean; bytes: number } {
  const result: NotebookOutput[] = []
  let used = 0
  let truncated = false

  for (const output of outputs) {
    for (const item of output.items) {
      if (result.length >= 100) {
        truncated = true
        continue
      }
      const text = TEXT_MIMES.has(item.mime) || item.mime.startsWith("text/")
      if (item.mime !== ERROR_MIME && !text) {
        result.push({ mime: item.mime.slice(0, 200), omitted: true })
        continue
      }
      const available = Math.max(0, Math.min(NOTEBOOK_LIMITS.item, limit - used))
      if (available === 0) {
        truncated = true
        continue
      }
      if (item.mime === ERROR_MIME) {
        const value = error(item, available)
        result.push(value)
        used += Math.min(item.data.byteLength, available)
        truncated ||= value.truncated === true
        continue
      }
      const value = slice(item.data, available)
      result.push({ mime: item.mime.slice(0, 200), text: value.text, truncated: value.truncated })
      used += Math.min(item.data.byteLength, available)
      truncated ||= value.truncated === true
    }
  }

  return { outputs: result, truncated, bytes: used }
}
