import { expect, test } from "bun:test"
import type { ModelInfo } from "@opencode/client"
import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { DialogModel } from "../../src/component/dialog-model"
import { renderLocal } from "../fixture/local"
import { directory, json } from "../fixture/tui-client"

// The real upstream picker with the Kilo seam: Gateway sections, order and labels, and the model info panel.

function model(providerID: string, id: string, name: string, extra: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id,
    modelID: id,
    providerID,
    name,
    status: "active",
    enabled: true,
    capabilities: { input: ["text", "image"], output: ["text"], tools: true },
    cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 0 } }],
    limit: { context: 200_000, output: 8_192 },
    time: { released: 0 },
    variants: [],
    ...extra,
  }
}

// The first model is the current one (the fixture has no default model), so the panel starts on it.
const models = [
  model("kilo", "anthropic/claude-sonnet-4.5", "Anthropic: Claude Sonnet 4.5", { family: "claude" }),
  model("opencode", "claude-sonnet-4", "Zen Sonnet"),
  model("kilo", "openai/gpt-5", "OpenAI: GPT-5"),
  model("kilo", "x-ai/grok-code-fast", "xAI: Grok Code Fast", {
    family: "grok",
    cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
  }),
]

const entries: KiloGatewayRpc.ModelEntry[] = [
  {
    id: "anthropic/claude-sonnet-4.5",
    name: "Anthropic: Claude Sonnet 4.5",
    isFree: false,
    recommendedIndex: 0,
    hasUserByokAvailable: true,
    reasoning: true,
    description: "Fast coding model",
    terminalBench: { overallScore: 0.425, avgAttemptCostUsd: 1.5 },
  },
  { id: "x-ai/grok-code-fast", name: "xAI: Grok Code Fast", isFree: true, mayTrainOnYourPrompts: true },
  { id: "openai/gpt-5", name: "OpenAI: GPT-5", isFree: false },
]

async function open(connected: boolean) {
  const rpc: unknown[] = []
  const setup = await renderLocal({
    models,
    fetch: (url, request) => {
      const location = { directory }
      if (url.pathname === "/api/rpc/kilocode.gateway/models") {
        rpc.push(request.method)
        return json({ output: entries })
      }
      if (url.pathname === "/api/provider")
        return json({
          location,
          data: [
            { id: "kilo", name: "Kilo Gateway", activation: "enabled", package: "" },
            { id: "opencode", name: "OpenCode Zen", activation: "enabled", package: "" },
          ],
        })
      if (url.pathname === "/api/integration")
        return json({
          location,
          data: connected
            ? [{ id: "kilo", name: "Kilo Gateway", methods: [], connections: [{ type: "env", name: "KILO_API_KEY" }] }]
            : [],
        })
    },
  })
  setup.resize(130, 40)
  setup.dialog.replace(() => <DialogModel />)
  return { setup, rpc }
}

test("connected picker shows Gateway sections, labels and the info panel", async () => {
  const { setup, rpc } = await open(true)
  await using _ = setup
  const frame = await setup.waitForFrame((frame) => frame.includes("Recommended") && frame.includes("May train"))
  expect(rpc).toEqual(["POST"])
  const lines = frame.split("\n")
  const row = (text: string) => lines.findIndex((line) => line.split("│")[0]!.includes(text))
  // Recommended, then Kilo Gateway (free first), then the other providers.
  expect(row("Recommended")).toBeLessThan(row("Claude Sonnet 4.5"))
  expect(row("Claude Sonnet 4.5")).toBeLessThan(row("Kilo Gateway"))
  expect(row("Kilo Gateway")).toBeLessThan(row("Grok Code Fast"))
  expect(row("Grok Code Fast")).toBeLessThan(row("OpenAI: GPT-5"))
  expect(row("OpenAI: GPT-5")).toBeLessThan(row("OpenCode Zen"))
  expect(lines[row("Claude Sonnet 4.5")]).toContain("BYOK")
  expect(lines[row("Grok Code Fast")]).toContain("Free · May train")

  // The panel follows the highlighted model.
  const panel = await setup.waitForFrame((frame) => frame.includes("Terminal Bench 2.0"))
  for (const text of [
    "BYOK",
    "Family",
    "Claude",
    "$3.00/1M",
    "$0.30/1M",
    "200K",
    "42.5%",
    "$1.50",
    "Reasoning",
    "Image",
    "Fast coding model",
  ])
    expect(panel).toContain(text)
  setup.mockInput.pressArrow("down")
  const free = await setup.waitForFrame((frame) => frame.includes("Data may be used for"))
  expect(free).not.toContain("Terminal Bench 2.0")
  // Rows follow the highlight, also when the next model has the same rows.
  expect(free.split("\n").find((line) => line.includes("Family"))).toContain("Grok")
  // A free Gateway model shows no pricing or context rows, as in v1.
  expect(free).not.toContain("Avg Cost")
  expect(free).not.toContain("Context")
})

test("searching keeps the section headers and finds other providers", async () => {
  const { setup } = await open(true)
  await using _ = setup
  await setup.waitForFrame((frame) => frame.includes("Recommended"))
  await setup.mockInput.typeText("zen")
  const frame = await setup.waitForFrame((frame) => frame.includes("OpenCode Zen") && !frame.includes("Recommended"))
  expect(frame).toContain("Zen Sonnet")
  expect(frame).not.toContain("Grok Code Fast")
})

test("signed out picker lists Recommended Kilo models first without section headers", async () => {
  const { setup } = await open(false)
  await using _ = setup
  const frame = await setup.waitForFrame((frame) => frame.includes("Free · May train"))
  expect(frame).not.toContain("Recommended")
  const lines = frame.split("\n")
  const row = (text: string) => lines.findIndex((line) => line.split("│")[0]!.includes(text))
  expect(row("Claude Sonnet 4.5")).toBeLessThan(row("Grok Code Fast"))
  expect(row("Grok Code Fast")).toBeLessThan(row("OpenAI: GPT-5"))
  expect(row("OpenAI: GPT-5")).toBeLessThan(row("Zen Sonnet"))
})
