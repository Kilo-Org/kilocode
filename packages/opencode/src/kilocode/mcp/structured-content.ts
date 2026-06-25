import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { JsonSchemaType, JsonSchemaValidator } from "@modelcontextprotocol/sdk/validation"
import type { JSONSchema7 } from "ai"

export namespace KiloMcpStructuredContent {
  export const MAX_STRUCTURED_CONTENT_BYTES = 1 * 1024 * 1024

  type Valid = {
    status: "valid"
    schema: JSONSchema7
    validator: JsonSchemaValidator<Record<string, unknown>>
  }

  type Invalid = {
    status: "invalid"
    metadata: Record<string, unknown>
  }

  type None = {
    status: "none"
  }

  export type Compiled = Valid | Invalid | None
  export type Persisted = { structuredContent?: unknown; metadata?: Record<string, unknown> }

  const ajv = new AjvJsonSchemaValidator()
  const KILO_META = new Set(["structuredContentSchema"])

  function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }

  function message(err: unknown) {
    return err instanceof Error ? err.message : String(err)
  }

  function invalid(reason: string, err?: unknown): Invalid {
    return {
      status: "invalid",
      metadata: {
        structuredContentSchema: {
          valid: false,
          reason,
          ...(err === undefined ? {} : { error: message(err) }),
        },
      },
    }
  }

  function omitted(result: CallToolResult, metadata?: Record<string, unknown>): CallToolResult {
    const next = { ...result }
    delete next.structuredContent
    if (metadata) {
      next._meta = {
        ...(record(result._meta) ? result._meta : {}),
        ...metadata,
      }
    }
    return next
  }

  export class StructuredContentError extends Error {
    constructor(tool: string, detail: string) {
      super(`MCP tool "${tool}" returned invalid structured content: ${detail}`)
      this.name = "McpStructuredContentError"
    }
  }

  export function compile(schema: unknown): Compiled {
    if (schema === undefined) return { status: "none" }
    if (!record(schema)) return invalid("schema")

    try {
      return {
        status: "valid",
        schema: schema as JSONSchema7,
        validator: ajv.getValidator<Record<string, unknown>>(schema as JsonSchemaType),
      }
    } catch (err) {
      return invalid("compile", err)
    }
  }

  export function validate(tool: string, compiled: Compiled, result: CallToolResult): CallToolResult {
    if (result.isError === true) return omitted(result)
    if (compiled.status === "none") return omitted(result)
    if (compiled.status === "invalid") return omitted(result, compiled.metadata)

    if (result.structuredContent === undefined) {
      throw new StructuredContentError(tool, "missing structuredContent")
    }

    const validated = compiled.validator(result.structuredContent)
    if (!validated.valid) {
      throw new StructuredContentError(tool, validated.errorMessage)
    }

    return {
      ...result,
      structuredContent: validated.data,
    }
  }

  export function persist(value: unknown, opts?: { maxBytes?: number }): Persisted {
    if (value === undefined) return {}

    const max = opts?.maxBytes ?? MAX_STRUCTURED_CONTENT_BYTES
    const json = JSON.stringify(value)
    if (json === undefined) return {}

    const bytes = Buffer.byteLength(json)
    if (bytes > max) {
      return {
        metadata: {
          structuredContentOmitted: {
            reason: "size",
            bytes,
            maxBytes: max,
          },
        },
      }
    }

    return { structuredContent: value }
  }

  export function metadata(result: { _meta?: unknown; metadata?: unknown }) {
    const meta = record(result.metadata) ? result.metadata : {}
    if (!record(result._meta)) return meta

    const out = { ...meta }
    for (const key of KILO_META) {
      if (key in result._meta) out[key] = result._meta[key]
    }
    return out
  }
}
