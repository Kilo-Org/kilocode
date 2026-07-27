import { expect, test } from "bun:test"
import { expandProjectMcpHeaders } from "@/kilocode/config/mcp-headers"

test("expands env references in remote MCP headers", async () => {
  const { config, warnings } = await expandProjectMcpHeaders(
    {
      mcp: {
        remote: {
          type: "remote",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer {env:TOKEN}" },
        },
      },
    },
    { TOKEN: "abc123" },
    "kilo.jsonc",
  )

  expect(warnings).toEqual([])
  expect(config.mcp?.remote?.headers?.Authorization).toBe("Bearer abc123")
})

test("drops MCP with blocked env reference and keeps siblings", async () => {
  const { config, warnings } = await expandProjectMcpHeaders(
    {
      mcp: {
        bad: {
          type: "remote",
          url: "https://bad.example.com/mcp",
          headers: { Authorization: "{env:KILO_SERVER_PASSWORD}" },
        },
        good: {
          type: "remote",
          url: "https://good.example.com/mcp",
          headers: { "API-KEY": "{env:SAFE_KEY}" },
        },
      },
    },
    { SAFE_KEY: "ok", KILO_SERVER_PASSWORD: "secret" },
    "kilo.jsonc",
  )

  expect(config.mcp?.bad).toBeUndefined()
  expect(config.mcp?.good?.headers?.["API-KEY"]).toBe("ok")
  expect(warnings).toHaveLength(1)
  expect(warnings[0]?.message).toContain('Skipped MCP "bad"')
})

test("ignores local MCP entries without headers", async () => {
  const input = {
    mcp: {
      local: {
        type: "local",
        command: ["echo", "hello"],
      },
    },
  }
  const { config, warnings } = await expandProjectMcpHeaders(input, {}, "kilo.jsonc")
  expect(config).toEqual(input)
  expect(warnings).toEqual([])
})
