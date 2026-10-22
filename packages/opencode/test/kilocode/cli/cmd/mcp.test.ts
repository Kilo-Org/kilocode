import { describe, expect, test } from "bun:test"
import { KilocodeMcpConfig } from "@/kilocode/cli/cmd/mcp"

const added = `{
  "permission": {
    "bash": "allow"
  },
  "mcp": {
    "linear": {
      "type": "remote",
      "url": "https://mcp.linear.app/mcp",
      "oauth": {}
    }
  },
}`

describe("KilocodeMcpConfig.format", () => {
  test("writes strict JSON for kilo.json", () => {
    const output = KilocodeMcpConfig.format("/tmp/kilo.json", added)

    expect(JSON.parse(output)).toEqual({
      permission: { bash: "allow" },
      mcp: {
        linear: {
          type: "remote",
          url: "https://mcp.linear.app/mcp",
          oauth: {},
        },
      },
    })
    expect(output).not.toEndWith(",\n}")
  })

  test("preserves JSONC formatting for kilo.jsonc", () => {
    expect(KilocodeMcpConfig.format("/tmp/kilo.jsonc", added)).toBe(added)
  })
})
