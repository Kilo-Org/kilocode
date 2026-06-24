import { describe, expect, test } from "bun:test"
import { disposesInstances } from "../../src/shared/config-update"

describe("config update disposal", () => {
  test("keeps sandbox and console-only global updates hot", () => {
    expect(disposesInstances({ config: { experimental: { sandbox: true } } })).toBe(false)
    expect(disposesInstances({ config: { experimental: { sandbox_restrict_network: false } } })).toBe(false)
    expect(
      disposesInstances({
        config: {
          console: { diff_style: "split" },
          experimental: { sandbox: false, sandbox_restrict_network: true },
        },
      }),
    ).toBe(false)
  })

  test("keeps sandbox and console unsets hot", () => {
    expect(
      disposesInstances({
        config: {},
        globalUnset: [
          ["experimental", "sandbox"],
          ["experimental", "sandbox_restrict_network"],
          ["console", "diff_style"],
        ],
      }),
    ).toBe(false)
  })

  test("disposes instances for other global or project updates", () => {
    expect(disposesInstances({ config: { experimental: { batch_tool: true } } })).toBe(true)
    expect(disposesInstances({ config: { provider: {} } })).toBe(true)
    expect(disposesInstances({ config: {}, globalUnset: [["experimental"]] })).toBe(true)
    expect(
      disposesInstances({ config: {}, projectConfig: { commit_message: { prompt: "Use conventional commits" } } }),
    ).toBe(true)
  })

  test("does not dispose instances when no config update is pending", () => {
    expect(disposesInstances({ config: {} })).toBe(false)
  })
})
