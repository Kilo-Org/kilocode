import { describe, expect, test } from "bun:test"
import { Result, Schema } from "effect"
import { Params } from "@/kilocode/tool/background-process"
import { toJsonSchema } from "@opencode-ai/core/effect-zod"

const accepts = (input: unknown) => Result.isSuccess(Schema.decodeUnknownResult(Params)(input))

describe("BackgroundProcessTool", () => {
  test("emits a root object JSON schema", () => {
    const json = toJsonSchema(Params) as { type?: unknown; anyOf?: unknown; properties?: Record<string, unknown> }

    expect(json.type).toBe("object")
    expect(json.anyOf).toBeUndefined()
    expect(json.properties?.action).toEqual(
      expect.objectContaining({ enum: ["start", "list", "status", "logs", "stop", "restart"] }),
    )
  })

  test("validates action-specific required fields", () => {
    expect(accepts({ action: "list" })).toBe(true)
    expect(accepts({ action: "start", command: "bun run dev", ready: { pattern: "ready" } })).toBe(true)
    expect(accepts({ action: "start" })).toBe(false)
    expect(accepts({ action: "stop", id: "bgp01" })).toBe(true)
    expect(accepts({ action: "stop" })).toBe(false)
  })
})
