import { expect, test } from "bun:test"
import type { IntegrationInfo } from "@opencode-ai/client"
import { integrationOptions } from "../../tui/src/component/dialog-integration"

function integration(id: string, name = id, metadata?: IntegrationInfo["metadata"]): IntegrationInfo {
  return { id, name, ...(metadata ? { metadata } : {}), methods: [{ type: "key" }], connections: [] }
}

test("Connect puts Kilo Gateway first even when MCP integrations are present", () => {
  const list = [
    integration("zzz"),
    integration("google"),
    integration("opencode"),
    integration("mcp", "Workspace MCP", { source: "mcp" }),
    integration("kilo", "Kilo Gateway"),
    integration("anthropic"),
    integration("openai"),
    integration("github-copilot"),
    integration("opencode-go"),
    integration("aaa"),
  ]
  const original = list.map((item) => item.id)
  expect(integrationOptions(list).map((item) => item.id)).toEqual([
    "kilo",
    "mcp",
    "opencode",
    "opencode-go",
    "openai",
    "github-copilot",
    "anthropic",
    "google",
    "aaa",
    "zzz",
  ])
  expect(list.map((item) => item.id)).toEqual(original)
  expect(list.find((item) => item.id === "kilo")?.metadata).toBeUndefined()
})

test("Connect retains the existing order when Kilo is absent", () => {
  const list = [
    integration("google"),
    integration("aaa"),
    integration("opencode-go"),
    integration("anthropic"),
    integration("mcp", "MCP", { source: "mcp" }),
    integration("openai"),
    integration("github-copilot"),
    integration("opencode"),
  ]
  expect(integrationOptions(list).map((item) => item.id)).toEqual([
    "mcp",
    "opencode",
    "opencode-go",
    "openai",
    "github-copilot",
    "anthropic",
    "google",
    "aaa",
  ])
})
