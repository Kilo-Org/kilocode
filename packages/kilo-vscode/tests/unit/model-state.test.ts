import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"
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

beforeEach(async () => {
  await rm(file, { force: true })
})

describe("model selection state", () => {
  it("preserves unknown top-level fields when persisting model selections", async () => {
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

    expect(data.variant).toBe("high")
    expect(data.recent).toEqual(["keep"])
    expect(data.model).toEqual({
      code: { providerID: "anthropic", modelID: "claude-sonnet-4" },
    })
  })

  it("preserves model-keyed variants when persisting model selections", async () => {
    const client = {
      path: {
        get: async () => ({ data: { state: dir } }),
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

    const raw = await readFile(file, "utf-8")
    const data = JSON.parse(raw) as { variant?: unknown }
    expect(data.variant).toEqual({ "anthropic/claude-sonnet-4": "high" })
  })

  it("preserves model-keyed variants when clearing model selections", async () => {
    const client = {
      path: {
        get: async () => ({ data: { state: dir } }),
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

    const raw = await readFile(file, "utf-8")
    const data = JSON.parse(raw) as {
      model?: Record<string, { providerID: string; modelID: string }>
      variant?: unknown
    }
    expect(data.variant).toEqual({ "anthropic/claude-sonnet-4": "high" })
    expect(data.model).toEqual({})
  })

  it("does not call global config update during model-state writes", async () => {
    const updates: unknown[] = []
    const reads: unknown[] = []
    const client = {
      path: {
        get: async () => ({ data: { state: dir } }),
      },
      global: {
        config: {
          get: async () => {
            reads.push(true)
            return { data: { agent: {} } }
          },
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

    expect(reads).toEqual([])
    expect(updates).toEqual([])
  })

  it("returns only validated per-agent model selections", async () => {
    const client = {
      path: {
        get: async () => ({ data: { state: dir } }),
      },
    } as unknown as KiloClient
    await writeFile(
      file,
      JSON.stringify({
        model: {
          code: { providerID: "openrouter", modelID: "anthropic/claude-sonnet-4" },
          broken: { providerID: "openai", modelID: 5 },
        },
      }),
    )

    expect(await ModelState.selections(client)).toEqual({
      code: { providerID: "openrouter", modelID: "anthropic/claude-sonnet-4" },
    })
  })

  it("resolves model state independently for different SDK clients", async () => {
    const other = await mkdtemp(path.join(os.tmpdir(), "kilo-model-state-other-"))
    const first = {
      path: { get: async () => ({ data: { state: dir } }) },
    } as unknown as KiloClient
    const second = {
      path: { get: async () => ({ data: { state: other } }) },
    } as unknown as KiloClient

    try {
      await writeFile(file, JSON.stringify({ model: { code: { providerID: "anthropic", modelID: "claude" } } }))
      await writeFile(
        path.join(other, "model.json"),
        JSON.stringify({ model: { code: { providerID: "openai", modelID: "gpt-5" } } }),
      )
      expect(await ModelState.selections(first)).toEqual({
        code: { providerID: "anthropic", modelID: "claude" },
      })
      expect(await ModelState.selections(second)).toEqual({
        code: { providerID: "openai", modelID: "gpt-5" },
      })
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })
})
