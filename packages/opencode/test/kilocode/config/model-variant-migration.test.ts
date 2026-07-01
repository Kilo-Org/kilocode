import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import type { Config } from "@/config/config"
import { KilocodeModelVariantMigration } from "@/kilocode/config/model-variant-migration"

const original = Global.Path.state
let dir = ""

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "kilo-variant-migration-"))
  Global.Path.state = dir
})

afterEach(async () => {
  Global.Path.state = original
  await rm(dir, { recursive: true, force: true })
})

function file(name: string) {
  return path.join(Global.Path.state, name)
}

async function writeState(data: unknown) {
  await writeFile(file("model.json"), JSON.stringify(data, null, 2))
}

async function readJson(name: string) {
  return JSON.parse(await readFile(file(name), "utf-8"))
}

function update(
  updates: Array<{ config: Config.Info; options: { dispose?: boolean } | undefined }>,
  fails?: Error,
  after?: () => Promise<void>,
) {
  return (config: Config.Info, options?: { dispose?: boolean }) =>
    fails
      ? Effect.fail(fails)
      : Effect.promise(async () => {
          updates.push({ config, options })
          await after?.()
          return { info: config, changed: true }
        })
}

describe("KilocodeModelVariantMigration.plan", () => {
  test("plans_exact_saved_model_variants_for_agent_config", () => {
    const plan = KilocodeModelVariantMigration.plan({
      config: { agent: {} } as Config.Info,
      state: {
        model: { code: { providerID: "anthropic", modelID: "claude-sonnet" } },
        variant: { "anthropic/claude-sonnet": "high" },
      },
    })

    expect(plan.patch).toEqual({ agent: { code: { variant: "high" } } })
    expect(plan.used).toEqual(new Set(["anthropic/claude-sonnet"]))
    expect(plan.remaining).toEqual({})
  })

  test("prefers_configured_agent_model_over_stale_saved_model", () => {
    const plan = KilocodeModelVariantMigration.plan({
      config: { agent: { code: { model: "anthropic/claude-opus" } } } as Config.Info,
      state: {
        model: { code: { providerID: "anthropic", modelID: "claude-sonnet" } },
        variant: {
          "anthropic/claude-sonnet": "high",
          "anthropic/claude-opus": "max",
        },
      },
    })

    expect(plan.patch).toEqual({ agent: { code: { variant: "max" } } })
    expect(plan.used).toEqual(new Set(["anthropic/claude-opus"]))
    expect(plan.remaining).toEqual({ "anthropic/claude-sonnet": "high" })
  })

  test("does_not_overwrite_existing_agent_variant", () => {
    const plan = KilocodeModelVariantMigration.plan({
      config: { agent: { code: { variant: "max" } } } as Config.Info,
      state: {
        model: { code: { providerID: "anthropic", modelID: "claude-sonnet" } },
        variant: { "anthropic/claude-sonnet": "high" },
      },
    })

    expect(plan.patch).toEqual({})
    expect(plan.used).toEqual(new Set(["anthropic/claude-sonnet"]))
    expect(plan.remaining).toEqual({})
  })

  test("preserves_unmatched_model_keyed_variants", () => {
    const plan = KilocodeModelVariantMigration.plan({
      config: { agent: { code: { model: "anthropic/claude-sonnet" } } } as Config.Info,
      state: {
        variant: { "openai/gpt-5": "low" },
      },
    })

    expect(plan.patch).toEqual({})
    expect(plan.used).toEqual(new Set())
    expect(plan.remaining).toEqual({ "openai/gpt-5": "low" })
  })
})

describe("KilocodeModelVariantMigration.run", () => {
  test("writes_marker_and_noops_on_second_run", async () => {
    const updates: Array<{ config: Config.Info; options: { dispose?: boolean } | undefined }> = []
    await writeState({
      model: { code: { providerID: "anthropic", modelID: "claude-sonnet" } },
      variant: { "anthropic/claude-sonnet": "high" },
    })

    await Effect.runPromise(
      KilocodeModelVariantMigration.run({ config: { agent: {} } as Config.Info, update: update(updates) }),
    )
    const first = await readJson("model.json")
    const marker = await readJson("kilocode-migrations.json")

    await Effect.runPromise(
      KilocodeModelVariantMigration.run({ config: { agent: {} } as Config.Info, update: update(updates) }),
    )
    const second = await readJson("model.json")

    expect(updates).toEqual([
      { config: { agent: { code: { variant: "high" } } }, options: { dispose: false } },
    ])
    expect(first.variant).toBeUndefined()
    expect(second).toEqual(first)
    expect(marker).toEqual({ agentVariantConfigV1: InstallationVersion })
  })

  test("old_marker_value_still_noops", async () => {
    const updates: Array<{ config: Config.Info; options: { dispose?: boolean } | undefined }> = []
    const state = {
      model: { code: { providerID: "anthropic", modelID: "claude-sonnet" } },
      variant: { "anthropic/claude-sonnet": "high" },
    }
    await writeState(state)
    await writeFile(file("kilocode-migrations.json"), JSON.stringify({ agentVariantConfigV1: "0.0.0-old" }, null, 2))

    await Effect.runPromise(
      KilocodeModelVariantMigration.run({ config: { agent: {} } as Config.Info, update: update(updates) }),
    )

    expect(updates).toEqual([])
    expect(await readJson("model.json")).toEqual(state)
  })

  test("does_not_mark_when_config_update_fails", async () => {
    const updates: Array<{ config: Config.Info; options: { dispose?: boolean } | undefined }> = []
    const state = {
      model: { code: { providerID: "anthropic", modelID: "claude-sonnet" } },
      variant: { "anthropic/claude-sonnet": "high" },
    }
    await writeState(state)

    await Effect.runPromise(
      KilocodeModelVariantMigration.run({
        config: { agent: {} } as Config.Info,
        update: update(updates, new Error("simulated update failure")),
      }),
    )

    expect(updates).toEqual([])
    expect(await readJson("model.json")).toEqual(state)
    expect(await Bun.file(file("kilocode-migrations.json")).exists()).toBe(false)
  })

  test("does_not_crash_or_mark_when_config_update_dies", async () => {
    const state = {
      model: { code: { providerID: "anthropic", modelID: "claude-sonnet" } },
      variant: { "anthropic/claude-sonnet": "high" },
    }
    await writeState(state)

    await Effect.runPromise(
      KilocodeModelVariantMigration.run({
        config: { agent: {} } as Config.Info,
        update: () => Effect.die(new Error("simulated update defect")),
      }),
    )

    expect(await readJson("model.json")).toEqual(state)
    expect(await Bun.file(file("kilocode-migrations.json")).exists()).toBe(false)
  })

  test("does_not_mark_when_model_cleanup_fails", async () => {
    const updates: Array<{ config: Config.Info; options: { dispose?: boolean } | undefined }> = []
    await writeState({
      model: { code: { providerID: "anthropic", modelID: "claude-sonnet" } },
      variant: { "anthropic/claude-sonnet": "high" },
    })

    await Effect.runPromise(
      KilocodeModelVariantMigration.run({
        config: { agent: {} } as Config.Info,
        update: update(updates, undefined, async () => {
          await rm(file("model.json"), { force: true })
          await mkdir(file("model.json"))
        }),
      }),
    )

    expect(updates).toEqual([
      { config: { agent: { code: { variant: "high" } } }, options: { dispose: false } },
    ])
    expect(await Bun.file(file("kilocode-migrations.json")).exists()).toBe(false)
  })
})
