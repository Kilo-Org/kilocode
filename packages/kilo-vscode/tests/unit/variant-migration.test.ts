import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Agent, Config, KiloClient } from "@kilocode/sdk/v2/client"
import { VariantMigration, type VariantStore } from "../../src/kilo-provider/variant-migration"

let dir = ""
let file = ""

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "kilo-variant-migration-"))
  file = path.join(dir, "model.json")
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  await writeFile(file, JSON.stringify({ model: {} }))
})

type Setup = {
  state: unknown
  config?: Config
  missing?: boolean
  agents?: string[]
  delay?: () => Promise<void>
  update?: (config: Config, set: (value: unknown) => void) => Promise<void>
}

function setup(input: Setup) {
  let state = input.state
  const writes: unknown[] = []
  const patches: Config[] = []
  const reads: unknown[] = []
  const paths: unknown[] = []
  const agentCalls: unknown[] = []
  const store: VariantStore = {
    get: () => state,
    update: async (_key, value) => {
      writes.push(value)
      state = value
    },
  }
  const client = {
    path: {
      get: async () => {
        paths.push(true)
        return { data: { state: dir } }
      },
    },
    global: {
      config: {
        get: async () => {
          reads.push(true)
          await input.delay?.()
          return { data: input.missing ? undefined : (input.config ?? {}) }
        },
        update: async ({ config }: { config: Config }) => {
          patches.push(config)
          await input.update?.(config, (value) => {
            state = value
          })
          return { data: config }
        },
      },
    },
    app: {
      agents: async (args?: unknown) => {
        agentCalls.push(args)
        return { data: (input.agents ?? ["code"]).map((name) => ({ name }) as Agent) }
      },
    },
  } as unknown as KiloClient
  return { store, client, writes, patches, reads, paths, agentCalls }
}

async function models(model: Record<string, { providerID: string; modelID: string }>) {
  await writeFile(file, JSON.stringify({ model }))
}

describe("VariantMigration.run", () => {
  it("maps an agent-scoped entry for the persisted model while preserving model ID slashes", async () => {
    await models({ code: { providerID: "openrouter", modelID: "anthropic/claude-sonnet-4" } })
    const ctx = setup({
      state: { "agent/code/openrouter/anthropic/claude-sonnet-4": "high" },
      config: { agent: { code: { model: "wrong/config-model" } }, model: "wrong/global-model" },
    })

    await VariantMigration.run(ctx.store, ctx.client)

    expect(ctx.patches).toEqual([{ agent: { code: { variant: "high" } } }])
    expect(ctx.writes).toEqual([{}])

    await VariantMigration.run(ctx.store, ctx.client)
    expect(ctx.patches).toHaveLength(1)
    expect(ctx.writes).toHaveLength(1)
  })

  it("uses agent config before the global model when no persisted selection exists", async () => {
    const ctx = setup({
      state: {
        "agent/code/anthropic/claude/opus": "max",
        "agent/review/openai/gpt/5": "low",
      },
      config: {
        model: "openai/gpt/5",
        agent: { code: { model: "anthropic/claude/opus" } },
      },
      agents: ["code", "review"],
    })

    await VariantMigration.run(ctx.store, ctx.client)

    expect(ctx.patches).toEqual([
      {
        agent: {
          code: { variant: "max" },
          review: { variant: "low" },
        },
      },
    ])
    expect(ctx.writes).toEqual([{}])
  })

  it("supports the plain model key as a fallback", async () => {
    await models({ code: { providerID: "anthropic", modelID: "claude-sonnet-4" } })
    const ctx = setup({ state: { "anthropic/claude-sonnet-4": "high" } })

    await VariantMigration.run(ctx.store, ctx.client)

    expect(ctx.patches).toEqual([{ agent: { code: { variant: "high" } } }])
    expect(ctx.writes).toEqual([{}])
  })

  it("enumerates agents in the active workspace directory", async () => {
    await models({ code: { providerID: "anthropic", modelID: "claude-sonnet-4" } })
    const ctx = setup({ state: { "anthropic/claude-sonnet-4": "high" } })

    await VariantMigration.run(ctx.store, ctx.client, "/workspace")

    expect(ctx.agentCalls).toEqual([{ directory: "/workspace" }])
  })

  it("migrates a saved default variant as a real value", async () => {
    await models({ code: { providerID: "anthropic", modelID: "claude-sonnet-4" } })
    const ctx = setup({ state: { "agent/code/anthropic/claude-sonnet-4": "default" } })

    await VariantMigration.run(ctx.store, ctx.client)

    expect(ctx.patches).toEqual([{ agent: { code: { variant: "default" } } }])
    expect(ctx.writes).toEqual([{}])
  })

  it("prefers the agent-scoped entry and retains the unused plain fallback", async () => {
    await models({ code: { providerID: "anthropic", modelID: "claude-sonnet-4" } })
    const ctx = setup({
      state: {
        "agent/code/anthropic/claude-sonnet-4": "high",
        "anthropic/claude-sonnet-4": "low",
      },
    })

    await VariantMigration.run(ctx.store, ctx.client)

    expect(ctx.patches).toEqual([{ agent: { code: { variant: "high" } } }])
    expect(ctx.writes).toEqual([{ "anthropic/claude-sonnet-4": "low" }])
  })

  it("does not overwrite a configured target or remove its matching entry", async () => {
    await models({ code: { providerID: "anthropic", modelID: "claude-sonnet-4" } })
    const ctx = setup({
      state: { "agent/code/anthropic/claude-sonnet-4": "high" },
      config: { agent: { code: { variant: "max" } } },
    })

    await VariantMigration.run(ctx.store, ctx.client)

    expect(ctx.patches).toEqual([])
    expect(ctx.writes).toEqual([])
  })

  it("does not treat a configured default variant as absent", async () => {
    await models({ code: { providerID: "anthropic", modelID: "claude-sonnet-4" } })
    const ctx = setup({
      state: { "agent/code/anthropic/claude-sonnet-4": "high" },
      config: { agent: { code: { variant: "default" } } },
    })

    await VariantMigration.run(ctx.store, ctx.client)

    expect(ctx.patches).toEqual([])
    expect(ctx.writes).toEqual([])
  })

  it("retains configured target entries while migrating other agents", async () => {
    const key = "anthropic/claude-sonnet-4"
    const ctx = setup({
      state: {
        [`agent/code/${key}`]: "high",
        [`agent/review/${key}`]: "low",
      },
      config: {
        model: key,
        agent: { code: { variant: "max" } },
      },
      agents: ["code", "review"],
    })

    await VariantMigration.run(ctx.store, ctx.client)

    expect(ctx.patches).toEqual([{ agent: { review: { variant: "low" } } }])
    expect(ctx.writes).toEqual([{ [`agent/code/${key}`]: "high" }])
  })

  it("does not mutate config or state when the config response has no data", async () => {
    await models({ code: { providerID: "anthropic", modelID: "claude-sonnet-4" } })
    const ctx = setup({
      state: { "agent/code/anthropic/claude-sonnet-4": "high" },
      missing: true,
    })

    await VariantMigration.run(ctx.store, ctx.client)

    expect(ctx.patches).toEqual([])
    expect(ctx.writes).toEqual([])
  })

  it("does not mutate state without an extension context or client", async () => {
    const ctx = setup({ state: { "agent/code/anthropic/claude-sonnet-4": "high" } })

    await VariantMigration.run(undefined, ctx.client)
    await VariantMigration.run(ctx.store, null)

    expect(ctx.patches).toEqual([])
    expect(ctx.writes).toEqual([])
  })

  it("skips empty variant selections without SDK reads", async () => {
    const ctx = setup({ state: {} })

    await VariantMigration.run(ctx.store, ctx.client)

    expect(ctx.reads).toEqual([])
    expect(ctx.paths).toEqual([])
    expect(ctx.agentCalls).toEqual([])
  })

  it("retains unmatched and session-scoped entries", async () => {
    await models({ code: { providerID: "anthropic", modelID: "claude-sonnet-4" } })
    const state = {
      "session/session-1/code/anthropic/claude-sonnet-4": "max",
      "agent/code/openai/gpt-5": "low",
      "future/model": "custom",
    }
    const ctx = setup({ state })

    await VariantMigration.run(ctx.store, ctx.client)

    expect(ctx.patches).toEqual([])
    expect(ctx.writes).toEqual([])
  })

  it("keeps the original state when the config update fails and retries atomically", async () => {
    await models({ code: { providerID: "anthropic", modelID: "claude-sonnet-4" } })
    let failing = true
    const state = {
      "agent/code/anthropic/claude-sonnet-4": "high",
      "future/model": "custom",
      malformed: 42,
    }
    const ctx = setup({
      state,
      update: async () => {
        if (!failing) return
        failing = false
        throw new Error("simulated update failure")
      },
    })

    await expect(VariantMigration.run(ctx.store, ctx.client)).rejects.toThrow("simulated update failure")

    expect(ctx.patches).toEqual([{ agent: { code: { variant: "high" } } }])
    expect(ctx.writes).toEqual([])

    await VariantMigration.run(ctx.store, ctx.client)
    expect(ctx.patches).toHaveLength(2)
    expect(ctx.writes).toEqual([{ "future/model": "custom", malformed: 42 }])
  })

  it("retains an entry changed between config update and cleanup", async () => {
    await models({ code: { providerID: "anthropic", modelID: "claude-sonnet-4" } })
    const key = "agent/code/anthropic/claude-sonnet-4"
    const ctx = setup({
      state: { [key]: "high" },
      update: async (_config, set) => {
        set({ [key]: "default" })
      },
    })

    await VariantMigration.run(ctx.store, ctx.client)

    expect(ctx.patches).toEqual([{ agent: { code: { variant: "high" } } }])
    expect(ctx.writes).toEqual([])
  })

  it("does not replace a non-record latest state", async () => {
    await models({ code: { providerID: "anthropic", modelID: "claude-sonnet-4" } })
    const ctx = setup({
      state: { "agent/code/anthropic/claude-sonnet-4": "high" },
      update: async (_config, set) => {
        set(42)
      },
    })

    await VariantMigration.run(ctx.store, ctx.client)

    expect(ctx.patches).toEqual([{ agent: { code: { variant: "high" } } }])
    expect(ctx.writes).toEqual([])
  })

  it("shares one in-flight operation across callers", async () => {
    await models({ code: { providerID: "anthropic", modelID: "claude-sonnet-4" } })
    let release: (() => void) | undefined
    let enter: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const ready = new Promise<void>((resolve) => {
      enter = resolve
    })
    const ctx = setup({
      state: { "agent/code/anthropic/claude-sonnet-4": "high" },
      update: async () => {
        enter?.()
        await blocked
      },
    })

    const first = VariantMigration.run(ctx.store, ctx.client)
    const second = VariantMigration.run(ctx.store, ctx.client)
    await ready

    expect(ctx.patches).toHaveLength(1)
    release?.()
    await Promise.all([first, second])
    expect(ctx.writes).toEqual([{}])
  })

  it("does_not_share_an_in_flight_migration_with_a_replacement_client", async () => {
    let release: (() => void) | undefined
    let enter: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const ready = new Promise<void>((resolve) => {
      enter = resolve
    })
    const first = setup({
      state: { "agent/code/anthropic/claude-sonnet-4": "high" },
      delay: async () => {
        enter?.()
        await blocked
      },
    })
    const second = setup({ state: { "agent/code/anthropic/claude-sonnet-4": "low" } })
    const one = VariantMigration.run(first.store, first.client)

    try {
      await ready
      const two = VariantMigration.run(second.store, second.client)

      expect(second.reads).toEqual([true])
      release?.()
      await Promise.all([one, two])
    } finally {
      release?.()
      await one
    }
  })
})
