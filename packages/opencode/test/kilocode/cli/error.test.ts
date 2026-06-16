import { describe, expect, test } from "bun:test"
import { FormatError } from "@/cli/error"

describe("MCP errors", () => {
  test("uses Kilo-neutral capability messaging", () => {
    const error = FormatError({ name: "MCPFailed", data: { name: "example" } })

    expect(error).toBe('MCP server "example" failed.')
    expect(error).not.toContain("opencode")
    expect(error).not.toContain("authentication")
  })
})

describe("model not found errors", () => {
  test("indicates when no models are available", () => {
    const data = {
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
      modelsEmpty: true,
    }

    const named = FormatError({ name: "ProviderModelNotFoundError", data })
    expect(named).toContain("No models are currently available.")
    expect(named).toContain("kilo.json")
    expect(named).not.toContain("opencode.json")
    expect(FormatError({ _tag: "ProviderModelNotFoundError", ...data })).toContain("No models are currently available.")
  })

  test("omits the indication when models are available", () => {
    const error = FormatError({
      _tag: "ProviderModelNotFoundError",
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
      modelsEmpty: false,
    })

    expect(error).not.toContain("No models are currently available.")
  })
})
