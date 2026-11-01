import { describe, expect, test } from "bun:test"
import type { Provider } from "@opencode-ai/core/models-dev"
import { patch } from "../../../src/kilocode/commandcode/provider"

const base: Provider = {
  id: "commandcode",
  name: "Command Code",
  env: ["CMD_API_KEY"],
  npm: "@ai-sdk/openai-compatible",
  models: {},
} as Provider

describe("commandcode provider patch", () => {
  test("leaves providers without a commandcode entry untouched", () => {
    const providers = { anthropic: { id: "anthropic" } as Provider }
    expect(patch(providers)).toBe(providers)
  })

  test("swaps only the stale key and keeps the rest", () => {
    const current = { ...base, env: ["CMD_API_KEY", "COMMANDCODE_BASE_URL"] }
    const out = patch({ commandcode: current })
    expect(out.commandcode.env).toEqual(["COMMANDCODE_BASE_URL", "COMMANDCODE_API_KEY"])
    expect(current.env).toEqual(["CMD_API_KEY", "COMMANDCODE_BASE_URL"])
  })

  test("adds the key when the entry declares no env", () => {
    const out = patch({ commandcode: { ...base, env: [] } })
    expect(out.commandcode.env).toEqual(["COMMANDCODE_API_KEY"])
  })

  test("is a no-op once the live entry carries the right key", () => {
    const current = { ...base, env: ["COMMANDCODE_API_KEY"] }
    const providers = { commandcode: current }
    expect(patch(providers)).toBe(providers)
  })

  test("removes the stale key when both keys are present", () => {
    const out = patch({ commandcode: { ...base, env: ["CMD_API_KEY", "COMMANDCODE_API_KEY"] } })
    expect(out.commandcode.env).toEqual(["COMMANDCODE_API_KEY"])
  })
})
