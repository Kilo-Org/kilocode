import type { ModelMessage } from "ai"
import { Log } from "@opencode-ai/core/util/log"

const log = Log.create({ service: "kilocode.message.diagnostics" })

type ZodIssue = {
  path?: (string | number)[]
  message?: string
  code?: string
  expected?: unknown
  received?: unknown
  errors?: Array<ZodIssue | ZodIssue[]>
}

export namespace KiloMessageDiagnostics {
  export type MessageShape = {
    index: number
    role: string
    contentKind: "string" | "array" | "absent" | "other"
    parts: Array<Record<string, unknown>>
    providerOptions?: string[]
  }

  export type ToolPairing = {
    totalToolCalls: number
    matchedResultIds: string[]
    unmatchedCallIds: string[]
    orphanResultIds: string[]
  }

  export function schemaIssues(err: unknown): string[] {
    const seen = new Set<unknown>()
    const walk = (e: unknown): string[] => {
      if (!e || typeof e !== "object" || seen.has(e)) return []
      seen.add(e)
      const obj = e as Record<string, unknown>
      if (Array.isArray(obj.issues)) {
        return flattenIssues(obj.issues as ZodIssue[])
      }
      const cause = obj.cause
      if (cause) return walk(cause)
      return []
    }
    return walk(err)
  }

  function flattenIssues(issues: ZodIssue[], depth = 0): string[] {
    const result: string[] = []
    for (const issue of issues) {
      const path = Array.isArray(issue.path) ? issue.path.join(".") : "?"
      const msg = issue.message ?? ""
      const code = issue.code ?? ""
      const expected = short(issue.expected)
      const received = short(issue.received)
      result.push(`${path}: ${msg} [${code}] expected=${expected} received=${received}`)
      // zod/v4 unions nest their member failures under `errors`; recurse so the
      // deep schema path (e.g. `content.0.text`) is not lost behind `invalid_union`.
      // Depth is capped so a pathological cycle degrades instead of throwing —
      // diagnostics on the failure path must never mask the original error.
      if (issue.errors && depth < 8) {
        for (const sub of issue.errors) {
          const nested = Array.isArray(sub) ? sub : [sub]
          for (const inner of nested) {
            const nextPath =
              Array.isArray(issue.path) && Array.isArray(inner.path)
                ? [...issue.path, ...inner.path]
                : inner.path
            result.push(...flattenIssues([{ ...inner, path: nextPath }], depth + 1))
          }
        }
      }
    }
    return result
  }

  function short(value: unknown): string {
    if (value === undefined) return ""
    const str = typeof value === "string" ? value : safeJSON(value)
    return str.length > 80 ? `${str.slice(0, 80)}…` : str
  }

  // Zod issue `expected`/`received` are schema type names in practice, but
  // custom issues can carry arbitrary values. Diagnostics must never throw on
  // the failure path, so circular/unserializable values degrade to a placeholder.
  function safeJSON(value: unknown): string {
    try {
      return JSON.stringify(value) ?? String(value)
    } catch {
      return "[unserializable]"
    }
  }

  export function messageShape(msgs: readonly ModelMessage[]): MessageShape[] {
    return msgs.map((msg, i) => {
      // The messages failed schema validation, so runtime parts can be anything:
      // null, primitives, or objects missing expected fields. Diagnostics on the
      // failure path must never throw, so each part is treated as unknown and
      // degraded to a safe placeholder before its fields are read.
      const content = (msg as { content?: unknown }).content
      const isArray = Array.isArray(content)
      const contentKind = typeof content === "string"
        ? "string"
        : isArray
          ? "array"
          : content === undefined || content === null
            ? "absent"
            : "other"
      return {
        index: i,
        role: msg.role,
        contentKind,
        parts: isArray ? (content as unknown[]).map(partShape) : [],
        providerOptions: msg.providerOptions ? Object.keys(msg.providerOptions) : undefined,
      }
    })
  }

  function partShape(p: unknown): Record<string, unknown> {
    if (!p || typeof p !== "object") return { type: String(p) }
    const part = p as Record<string, unknown>
    if (part.type === "tool-call")
      return { type: "tool-call", toolCallId: String(part.toolCallId), toolName: String(part.toolName) }
    if (part.type === "tool-result")
      return { type: "tool-result", toolCallId: String(part.toolCallId), toolName: String(part.toolName) }
    if (part.type === "reasoning") return { type: "reasoning" }
    if (part.type === "text") return { type: "text" }
    if (part.type === "file")
      return { type: "file", mediaType: part.mediaType === undefined ? undefined : String(part.mediaType) }
    return { type: String(part.type) }
  }

  export function toolPairing(msgs: readonly ModelMessage[]): ToolPairing {
    const callIds = new Set<string>()
    const resultIds = new Set<string>()
    for (const msg of msgs) {
      if (!Array.isArray(msg.content)) continue
      for (const part of msg.content) {
        if (!part || typeof part !== "object") continue
        if (part.type === "tool-call" && typeof part.toolCallId === "string") callIds.add(part.toolCallId)
        if (part.type === "tool-result" && typeof part.toolCallId === "string") resultIds.add(part.toolCallId)
      }
    }
    const matched = [...callIds].filter((id) => resultIds.has(id))
    const unmatched = [...callIds].filter((id) => !resultIds.has(id))
    const orphan = [...resultIds].filter((id) => !callIds.has(id))
    return {
      totalToolCalls: callIds.size,
      matchedResultIds: matched,
      unmatchedCallIds: unmatched,
      orphanResultIds: orphan,
    }
  }

  export function describe(err: unknown, msgs: readonly ModelMessage[]) {
    return {
      issues: schemaIssues(err),
      messages: messageShape(msgs),
      pairing: toolPairing(msgs),
    }
  }

  export function reportModelMessageError(
    err: unknown,
    msgs: readonly ModelMessage[],
  ): ReturnType<typeof describe> | undefined {
    const mismatch = err instanceof Error && err.message.includes("do not match the ModelMessage[] schema")
    if (!mismatch) return undefined
    const diagnostic = describe(err, msgs)
    log.error("ModelMessage[] schema validation failed", diagnostic)
    return diagnostic
  }
}
