import { expect, test } from "bun:test"
import type {
  ModelInfo,
  AgentInfo,
} from "@opencode-ai/client/promise"
import {
  createModelMethods,
  modelView,
  agentView,
} from "../src/backend/models"

// If executed as a child worker under sandbox-exec, run the real host acceptance verification
if (process.argv.includes("--fixture-worker")) {
  const { Effect } = await import("effect")
  const { appHost } = await import("./app-host")

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const host = yield* appHost
        const adapter = createModelMethods(host.verified.client, process.cwd())

        yield* Effect.promise(async () => {
          // Wait for providers/models to activate on server startup
          let providers = await adapter.provider.list({}, { throwOnError: true })
          for (let i = 0; i < 20 && providers.data.all.length === 0; i++) {
            await new Promise((r) => setTimeout(r, 100))
            providers = await adapter.provider.list({}, { throwOnError: true })
          }

          expect(providers.data.all.length).toBeGreaterThanOrEqual(1)
          const primaryProvider = providers.data.all[0]
          expect(primaryProvider).toBeDefined()
          expect(primaryProvider.id).toBeDefined()
          expect(Object.keys(primaryProvider.models).length).toBeGreaterThanOrEqual(1)

          // 2. model.list against real host
          const models = await adapter.model.list({}, { throwOnError: true })
          expect(models.data.length).toBeGreaterThanOrEqual(1)
          expect(models.data[0].id).toBeDefined()
          expect(models.data[0].providerID).toBe(primaryProvider.id)

          // 3. app.agents against real host
          const agents = await adapter.app.agents({}, { throwOnError: true })
          expect(agents.data.length).toBeGreaterThanOrEqual(1)
          expect(agents.data[0].name).toBeDefined()

          // 4. command.list against real host
          const commands = await adapter.command.list({}, { throwOnError: true })
          expect(Array.isArray(commands.data)).toBe(true)

          // 5. throwOnError handling against real host
          await expect(
            adapter.provider.get({ providerID: "non-existent-provider" }, { throwOnError: true }),
          ).rejects.toBeDefined()

          const softError = await adapter.provider.get(
            { providerID: "non-existent-provider" },
            { throwOnError: false },
          )
          expect(softError.error).toBeDefined()
          expect(softError.data).toBeUndefined()

          await expect(adapter.model.list({ workspace: "missing-workspace" }, { throwOnError: true })).rejects.toBeDefined()
          const controller = new AbortController()
          controller.abort()
          const aborted = await adapter.provider.list({}, { signal: controller.signal })
          expect(aborted.error).toBeDefined()
          expect(aborted.data).toBeUndefined()
          console.log("EXISTING_UI_MODELS_PASS")
        })
      }),
    ),
  )
  process.exit(0)
}

test("modelView selects base cost by absence of tier regardless of array order (tier-before-base)", () => {
  const native: ModelInfo = {
    id: "test-model",
    modelID: "actual-model-id",
    providerID: "test-provider",
    name: "Test Model",
    family: "test-family",
    capabilities: {
      tools: true,
      input: ["text", "image"],
      output: ["text", "reasoning"],
    },
    variants: [{ id: "thought" }],
    time: { released: 1700000000000 },
    cost: [
      // Tiered quote placed FIRST in the array
      { tier: { type: "context", size: 100_000 }, input: 12, output: 40, cache: { read: 2, write: 6 } },
      // Base untiered quote placed SECOND
      { input: 3, output: 15, cache: { read: 0.3, write: 3.75 } },
    ],
    status: "active",
    enabled: true,
    limit: { context: 64_000, output: 2048 },
    settings: { custom: "setting" },
  }

  const mapped = modelView(native)
  // Must pick base untiered quote (input 3, output 15), NOT the first tiered element (input 12)
  expect(mapped.cost.available).toBe(true)
  expect(mapped.isFree).toBeUndefined()
  expect(mapped.cost.input).toBe(3)
  expect(mapped.cost.output).toBe(15)
  expect(mapped.cost.cache.read).toBe(0.3)
  expect(mapped.cost.cache.write).toBe(3.75)

  // Tiers list must be populated
  expect(mapped.cost.tiers?.length).toBe(1)
  expect(mapped.cost.tiers?.[0].input).toBe(12)
  expect(mapped.cost.tiers?.[0].tier.size).toBe(100_000)
})

test("actual zero-price model stays Free with available: true", () => {
  const zeroPrice: ModelInfo = {
    id: "free-model",
    modelID: "free-model",
    providerID: "p-free",
    name: "Free Model",
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [],
    time: { released: 0 },
    cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
    status: "active",
    enabled: true,
    limit: { context: 32_000, output: 4096 },
  }
  const mapped = modelView(zeroPrice)
  expect(mapped.cost.available).toBe(true)
  expect(mapped.isFree).toBe(true)
  expect(mapped.cost.input).toBe(0)
  expect(mapped.cost.output).toBe(0)
})

test("modelView marks cost unavailable (available: false) when untiered quote is absent or multiple and does NOT mark free", () => {
  // Case A: Only tiered quotes present
  const onlyTiered: ModelInfo = {
    id: "m-1",
    modelID: "m-1",
    providerID: "p-1",
    name: "Model 1",
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [],
    time: { released: 0 },
    cost: [{ tier: { type: "context", size: 1000 }, input: 5, output: 10, cache: { read: 0, write: 0 } }],
    status: "active",
    enabled: true,
    limit: { context: 1000, output: 100 },
  }
  const mappedA = modelView(onlyTiered)
  expect(mappedA.cost.available).toBe(false)
  expect(mappedA.isFree).toBeUndefined()
  expect(mappedA.cost.input).toBe(0)
  expect(mappedA.cost.output).toBe(0)

  // Case B: Multiple ambiguous untiered quotes present
  const multipleUntiered: ModelInfo = {
    ...onlyTiered,
    cost: [
      { input: 1, output: 2, cache: { read: 0, write: 0 } },
      { input: 3, output: 4, cache: { read: 0, write: 0 } },
    ],
  }
  const mappedB = modelView(multipleUntiered)
  expect(mappedB.cost.available).toBe(false)
  expect(mappedB.isFree).toBeUndefined()
  expect(mappedB.cost.input).toBe(0)
  expect(mappedB.cost.output).toBe(0)
})

test("modelView maps limits and capabilities faithfully without fabricated defaults", () => {
  const noLimits: ModelInfo = {
    id: "m-2",
    modelID: "m-2",
    providerID: "p-2",
    name: "Model 2",
    capabilities: { tools: false, input: [], output: [] },
    variants: [],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: undefined as any,
  }
  const mapped = modelView(noLimits)
  // Must NOT fabricate 128000 or 4096
  expect(mapped.limit.context).toBe(0)
  expect(mapped.limit.output).toBe(0)
  expect(mapped.capabilities.toolcall).toBe(false)
  expect(mapped.capabilities.reasoning).toBe(false)
  expect(mapped.capabilities.attachment).toBe(false)
})

test("agentView sets name to native info.id and displayName to info.name", () => {
  const nativeAgent: AgentInfo = {
    id: "custom-reviewer",
    name: "Code Reviewer",
    description: "Autonomously reviews code",
    mode: "primary",
    hidden: false,
    color: "green",
    steps: 100,
    permissions: [{ action: "shell", resource: "*", effect: "ask" }],
    model: { id: "model-1", providerID: "provider-1" },
    system: "You review code",
    request: { body: { maxTokens: 2048 } } as any,
  }

  const mapped = agentView(nativeAgent)
  expect(mapped.name).toBe("custom-reviewer")
  expect(mapped.displayName).toBe("Code Reviewer")
  expect(mapped.permission).toEqual([{ permission: "shell", pattern: "*", action: "ask" }])
})

test.skipIf(process.platform !== "darwin")(
  "real isolated kilo-cli host verifies model/provider/agent/command adapter",
  async () => {
    const { fixture } = await import("../../kilo-cli/test/fixture")
    const { writeFile } = await import("node:fs/promises")
    const path = await import("node:path")

    await using input = await fixture()
    const policy = path.join(input.directory, "network.sb")
    await writeFile(
      policy,
      '(version 1) (allow default) (deny network-outbound) (allow network-outbound (remote ip "localhost:*"))',
    )

    const bunBin = (await import("node:fs")).existsSync(
      path.resolve(import.meta.dir, "../../kilo-cli/dist/interactive/bun"),
    )
      ? path.resolve(import.meta.dir, "../../kilo-cli/dist/interactive/bun")
      : process.execPath

    const child = Bun.spawn(
      [
        "/usr/bin/sandbox-exec",
        "-f",
        policy,
        bunBin,
        path.join(import.meta.dir, "backend-models.test.ts"),
        "--fixture-worker",
      ],
      {
        cwd: input.cwd,
        env: input.env,
        stdout: "pipe",
        stderr: "pipe",
      },
    )

    const timeout = setTimeout(() => child.kill("SIGKILL"), 25_000)
    try {
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect({ code, error: code ? stdout + stderr : "" }).toEqual({ code: 0, error: "" })
      expect(stdout).toContain("EXISTING_UI_MODELS_PASS")
    } finally {
      clearTimeout(timeout)
    }
  },
  30_000,
)
