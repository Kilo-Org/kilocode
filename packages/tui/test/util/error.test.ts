import { describe, expect, test } from "bun:test"
import { cliErrorMessage, errorData, errorFormat, errorMessage } from "../../src/util/error"

describe("util.error", () => {
  test("formats native Error instances", () => {
    const err = new Error("boom")
    expect(errorMessage(err)).toBe("boom")
    expect(errorFormat(err)).toContain("boom")

    const data = errorData(err)
    expect(data.type).toBe("Error")
    expect(data.message).toBe("boom")
    expect(String(data.formatted)).toContain("boom")
  })

  test("extracts message from record-like values", () => {
    const err = { message: "bad input", code: "E_BAD" }
    expect(errorMessage(err)).toBe("bad input")

    const data = errorData(err)
    expect(data.message).toBe("bad input")
    expect(data.code).toBe("E_BAD")
  })

  test("never returns bare {} for opaque object errors", () => {
    expect(errorFormat({})).not.toBe("{}")
    expect(errorFormat({})).toContain("no message")

    class OpaqueError {}
    const opaque = new OpaqueError()
    Object.defineProperty(opaque, "secret", { value: "hidden", enumerable: false })
    expect(errorFormat(opaque)).not.toBe("{}")
    expect(errorFormat(opaque)).toContain("OpaqueError")
  })

  test("handles opaque throwables with custom toString", () => {
    const err = {
      toString() {
        return "ResolveMessage: Cannot resolve module"
      },
    }

    expect(errorMessage(err)).toBe("ResolveMessage: Cannot resolve module")

    const data = errorData(err)
    expect(data.message).toBe("ResolveMessage: Cannot resolve module")
    expect(String(data.formatted)).toContain("ResolveMessage")
  })

  // kilocode_change start - preserve Kilo-branded CLI guidance
  test("uses Kilo commands and capability messaging", () => {
    const model = cliErrorMessage({
      _tag: "ProviderModelNotFoundError",
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
    })
    expect(model).toContain("kilo models")
    expect(model).toContain("kilo.json")
    expect(model).not.toContain("opencode")

    const mcp = cliErrorMessage({ name: "MCPFailed", data: { name: "example" } })
    expect(mcp).toBe('MCP server "example" failed.')
  })
  // kilocode_change end
})
