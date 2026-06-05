import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import * as ModelState from "../../src/kilo-provider/model-state"

let dir = ""
let file = ""

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "kilo-model-state-"))
  file = path.join(dir, "model.json")
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("model selection state", () => {
  it("drops the stale top-level variant when persisting model selections", async () => {
    const client = {
      path: {
        get: async () => ({ data: { state: dir } }),
      },
    } as unknown as KiloClient

    await writeFile(file, JSON.stringify({ variant: "high", recent: ["keep"] }, null, 2))

    await ModelState.handleMessage(
      "persistModelSelection",
      { agent: "code", providerID: "anthropic", modelID: "claude-sonnet-4" },
      client,
      () => {},
    )

    const raw = await readFile(file, "utf-8")
    const data = JSON.parse(raw) as {
      model?: Record<string, { providerID: string; modelID: string }>
      recent?: string[]
      variant?: string
    }

    expect(data.variant).toBeUndefined()
    expect(data.recent).toEqual(["keep"])
    expect(data.model).toEqual({
      code: { providerID: "anthropic", modelID: "claude-sonnet-4" },
    })
  })

  it("migrates legacy model variants into agent config before deleting them", async () => {
    const updates: unknown[] = []
    const client = {
      path: {
        get: async () => ({ data: { state: dir } }),
      },
      global: {
        config: {
          get: async () => ({ data: { agent: {} } }),
          update: async (input: unknown) => {
            updates.push(input)
            return { data: input }
          },
        },
      },
    } as unknown as KiloClient

    await writeFile(
      file,
      JSON.stringify(
        {
          model: { code: { providerID: "anthropic", modelID: "claude-sonnet-4" } },
          variant: { "anthropic/claude-sonnet-4": "high" },
        },
        null,
        2,
      ),
    )

    await ModelState.handleMessage(
      "persistModelSelection",
      { agent: "code", providerID: "anthropic", modelID: "claude-sonnet-4" },
      client,
      () => {},
    )

    expect(updates).toEqual([{ config: { agent: { code: { variant: "high" } } } }])
    const raw = await readFile(file, "utf-8")
    const data = JSON.parse(raw) as { variant?: unknown }
    expect(data.variant).toBeUndefined()
  })

  it("migrates legacy variants from the pre-write model map before clearing selections", async () => {
    const updates: unknown[] = []
    const client = {
      path: {
        get: async () => ({ data: { state: dir } }),
      },
      global: {
        config: {
          get: async () => ({ data: { agent: {} } }),
          update: async (input: unknown) => {
            updates.push(input)
            return { data: input }
          },
        },
      },
    } as unknown as KiloClient

    await writeFile(
      file,
      JSON.stringify(
        {
          model: { code: { providerID: "anthropic", modelID: "claude-sonnet-4" } },
          variant: { "anthropic/claude-sonnet-4": "high" },
        },
        null,
        2,
      ),
    )

    await ModelState.handleMessage("clearModelSelection", { agent: "code" }, client, () => {})

    expect(updates).toEqual([{ config: { agent: { code: { variant: "high" } } } }])
    const raw = await readFile(file, "utf-8")
    const data = JSON.parse(raw) as {
      model?: Record<string, { providerID: string; modelID: string }>
      variant?: unknown
    }
    expect(data.variant).toBeUndefined()
    expect(data.model).toEqual({})
  })

  it("migrates legacy variants from a pending model selection when no old selection exists", async () => {
    const updates: unknown[] = []
    const client = {
      path: {
        get: async () => ({ data: { state: dir } }),
      },
      global: {
        config: {
          get: async () => ({ data: { agent: {} } }),
          update: async (input: unknown) => {
            updates.push(input)
            return { data: input }
          },
        },
      },
    } as unknown as KiloClient

    await writeFile(
      file,
      JSON.stringify(
        {
          variant: { "anthropic/claude-sonnet-4": "high" },
        },
        null,
        2,
      ),
    )

    await ModelState.handleMessage(
      "persistModelSelection",
      { agent: "code", providerID: "anthropic", modelID: "claude-sonnet-4" },
      client,
      () => {},
    )

    expect(updates).toEqual([{ config: { agent: { code: { variant: "high" } } } }])
    const raw = await readFile(file, "utf-8")
    const data = JSON.parse(raw) as { variant?: unknown }
    expect(data.variant).toBeUndefined()
  })

  it("migrates legacy variants from a pending model selection when an old selection differs", async () => {
    const updates: unknown[] = []
    const client = {
      path: {
        get: async () => ({ data: { state: dir } }),
      },
      global: {
        config: {
          get: async () => ({ data: { agent: {} } }),
          update: async (input: unknown) => {
            updates.push(input)
            return { data: input }
          },
        },
      },
    } as unknown as KiloClient

    await writeFile(
      file,
      JSON.stringify(
        {
          model: { code: { providerID: "anthropic", modelID: "claude-opus-4" } },
          variant: { "anthropic/claude-sonnet-4": "high" },
        },
        null,
        2,
      ),
    )

    await ModelState.handleMessage(
      "persistModelSelection",
      { agent: "code", providerID: "anthropic", modelID: "claude-sonnet-4" },
      client,
      () => {},
    )

    expect(updates).toEqual([{ config: { agent: { code: { variant: "high" } } } }])
    const raw = await readFile(file, "utf-8")
    const data = JSON.parse(raw) as { variant?: unknown }
    expect(data.variant).toBeUndefined()
  })

  it("preserves unrelated legacy variants that cannot be mapped to an agent", async () => {
    const updates: unknown[] = []
    const client = {
      path: {
        get: async () => ({ data: { state: dir } }),
      },
      global: {
        config: {
          get: async () => ({ data: { agent: {} } }),
          update: async (input: unknown) => {
            updates.push(input)
            return { data: input }
          },
        },
      },
    } as unknown as KiloClient

    await writeFile(
      file,
      JSON.stringify(
        {
          model: { code: { providerID: "anthropic", modelID: "claude-sonnet-4" } },
          variant: {
            "anthropic/claude-sonnet-4": "high",
            "openai/gpt-5": "low",
          },
        },
        null,
        2,
      ),
    )

    await ModelState.handleMessage("clearModelSelection", { agent: "code" }, client, () => {})

    expect(updates).toEqual([{ config: { agent: { code: { variant: "high" } } } }])
    const raw = await readFile(file, "utf-8")
    const data = JSON.parse(raw) as { variant?: unknown }
    expect(data.variant).toEqual({ "openai/gpt-5": "low" })
  })

  it("does not overwrite an existing agent config variant during legacy migration", async () => {
    const updates: unknown[] = []
    const client = {
      path: {
        get: async () => ({ data: { state: dir } }),
      },
      global: {
        config: {
          get: async () => ({ data: { agent: { code: { variant: "max" } } } }),
          update: async (input: unknown) => {
            updates.push(input)
            return { data: input }
          },
        },
      },
    } as unknown as KiloClient

    await writeFile(
      file,
      JSON.stringify(
        {
          model: { code: { providerID: "anthropic", modelID: "claude-sonnet-4" } },
          variant: { "anthropic/claude-sonnet-4": "high" },
        },
        null,
        2,
      ),
    )

    await ModelState.handleMessage(
      "persistModelSelection",
      { agent: "code", providerID: "anthropic", modelID: "claude-sonnet-4" },
      client,
      () => {},
    )

    expect(updates).toEqual([])
    const raw = await readFile(file, "utf-8")
    const data = JSON.parse(raw) as { variant?: unknown }
    expect(data.variant).toBeUndefined()
  })
})
