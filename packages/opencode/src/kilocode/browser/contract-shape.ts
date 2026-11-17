import { createHash } from "node:crypto"
import type { JSONSchema7 } from "@ai-sdk/provider"
import z from "zod"
import { isRecord } from "@/util/record"

/** One browser tool as the pinned Playwright MCP contract exposes it. */
export type Entry = {
  name: string
  title: string
  description: string
  inputSchema: JSONSchema7
  readOnly: boolean
}

function isSchemaValue(value: unknown): value is boolean | JSONSchema7 {
  if (typeof value === "boolean") return true
  if (!isRecord(value)) return false
  if (value.properties === undefined) return true
  if (!isRecord(value.properties)) return false
  return Object.values(value.properties).every(isSchemaValue)
}

/** The pinned contract always lists object-typed tool arguments; anything else is a broken package. */
function isToolSchema(value: unknown): value is JSONSchema7 {
  if (!isRecord(value)) return false
  if (value.type !== "object") return false
  return isSchemaValue(value)
}

const ToolSchema = z.custom<JSONSchema7>(isToolSchema, { message: "expected an object JSON Schema" })

const RawTool = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  inputSchema: ToolSchema,
  annotations: z
    .object({
      title: z.string().optional(),
      readOnlyHint: z.boolean().optional(),
    })
    .optional(),
})

const RawList = z.object({ tools: z.array(RawTool).min(1) })

export type RawList = z.infer<typeof RawList>

export function parseList(value: unknown): RawList {
  return RawList.parse(value)
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
