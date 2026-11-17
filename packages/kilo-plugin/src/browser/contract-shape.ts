// The shape of one browser tool in the pinned Playwright MCP contract, and the checks the generator and the live
// server go through: the same normalization on both sides is what makes the SHA-256 comparison meaningful.
import { createHash } from "node:crypto"
import { isRecord } from "@opencode/util/record"
import type { JsonSchema } from "effect"

/** One browser tool as the pinned Playwright MCP contract exposes it. */
export type Entry = {
  name: string
  title: string
  description: string
  inputSchema: JsonSchema.JsonSchema
  readOnly: boolean
}

function isSchemaValue(value: unknown): value is JsonSchema.JsonSchema {
  if (typeof value === "boolean") return true
  if (!isRecord(value)) return false
  if (value.properties === undefined) return true
  if (!isRecord(value.properties)) return false
  return Object.values(value.properties).every(isSchemaValue)
}

/** The pinned contract always lists object-typed tool arguments; anything else is a broken package. */
function isToolSchema(value: unknown): value is JsonSchema.JsonSchema {
  if (!isRecord(value)) return false
  if (value.type !== "object") return false
  return isSchemaValue(value)
}

type RawTool = {
  name: string
  description?: string
  inputSchema: JsonSchema.JsonSchema
  annotations?: { title?: string; readOnlyHint?: boolean }
}

/** Validate a `tools/list` result. A shape the contract does not describe is a hard error, never a skipped tool. */
export function parseList(value: unknown): { tools: RawTool[] } {
  if (!isRecord(value) || !Array.isArray(value.tools)) throw new Error("tools/list returned no tool list")
  if (!value.tools.length) throw new Error("tools/list returned an empty tool list")
  const tools = value.tools.map((tool): RawTool => {
    if (!isRecord(tool) || typeof tool.name !== "string" || !tool.name) throw new Error("a tool has no name")
    if (!isToolSchema(tool.inputSchema)) throw new Error(`${tool.name} has no object input schema`)
    if (tool.description !== undefined && typeof tool.description !== "string")
      throw new Error(`${tool.name} has a non-string description`)
    if (tool.annotations !== undefined && !isRecord(tool.annotations))
      throw new Error(`${tool.name} has malformed annotations`)
    const annotations = tool.annotations as { title?: unknown; readOnlyHint?: unknown } | undefined
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations:
        annotations === undefined
          ? undefined
          : {
              title: typeof annotations.title === "string" ? annotations.title : undefined,
              readOnlyHint: annotations.readOnlyHint === true,
            },
    }
  })
  return { tools }
}

/** The model-facing contract, without the transport's annotations wrapper. */
export function entries(value: unknown): Entry[] {
  return parseList(value).tools.map((tool) => ({
    name: tool.name,
    title: tool.annotations?.title ?? "",
    description: tool.description ?? "",
    inputSchema: tool.inputSchema,
    readOnly: tool.annotations?.readOnlyHint === true,
  }))
}

/** SHA-256 of the raw tools/list result, exactly as the extension contract generator hashes it. */
export function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
