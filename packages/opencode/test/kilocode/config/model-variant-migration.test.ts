import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { Flock } from "@opencode-ai/core/util/flock"
import type { Config } from "@/config/config"
import { KilocodeModelState } from "@/kilocode/config/model-state"
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
    expect(plan.used).toEqual(new Set())
    expect(plan.remaining).toEqual({ "anthropic/claude-sonnet": "high" })
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
  test("leaves_malformed_json_unchanged_without_updating_config", async () => {
    const updates: Array<{ config: Config.Info; options: { dispose?: boolean } | undefined }> = []
    const state = "{ malformed"
    await writeFile(file("model.json"), state)

    await Effect.runPromise(
      KilocodeModelVariantMigration.run({ config: { agent: {} } as Config.Info, update: update(updates) }),
    )

    expect(updates).toEqual([])
    expect(await Bun.file(file("model.json")).text()).toBe(state)
  })

  test("migrates_matching_legacy_variant_and_cleans_source", async () => {
    const updates: Array<{ config: Config.Info; options: { dispose?: boolean } | undefined }> = []
    await writeState({
      model: { code: { providerID: "anthropic", modelID: "claude-sonnet" } },
      variant: { "anthropic/claude-sonnet": "high" },
    })
    await Effect.runPromise(
      KilocodeModelVariantMigration.run({ config: { agent: {} } as Config.Info, update: update(updates) }),
    )

    expect(updates).toEqual([
      { config: { agent: { code: { variant: "high" } } }, options: { dispose: false } },
    ])
    expect(await readJson("model.json")).toEqual({
      model: { code: { providerID: "anthropic", modelID: "claude-sonnet" } },
    })
  })

  test("keeps_unmatched_variants_for_a_later_matching_model", async () => {
    const updates: Array<{ config: Config.Info; options: { dispose?: boolean } | undefined }> = []
    await writeState({ variant: { "openai/gpt-5": "low" } })

    await Effect.runPromise(
      KilocodeModelVariantMigration.run({
        config: { agent: { code: { model: "anthropic/claude-sonnet" } } } as Config.Info,
        update: update(updates),
      }),
    )
    expect(await readJson("model.json")).toEqual({ variant: { "openai/gpt-5": "low" } })

    await Effect.runPromise(
      KilocodeModelVariantMigration.run({
        config: { agent: { code: { model: "openai/gpt-5" } } } as Config.Info,
        update: update(updates),
      }),
    )

    expect(updates).toEqual([
      { config: { agent: { code: { variant: "low" } } }, options: { dispose: false } },
    ])
    expect(await readJson("model.json")).toEqual({})
  })

  test("removes_only_consumed_values_that_match_the_observed_variant", async () => {
    const updates: Array<{ config: Config.Info; options: { dispose?: boolean } | undefined }> = []
    await writeState({
      model: { code: { providerID: "anthropic", modelID: "claude-sonnet" } },
      variant: {
        "anthropic/claude-sonnet": "high",
        "openai/gpt-5": { value: "low" },
      },
    })

    await Effect.runPromise(
      KilocodeModelVariantMigration.run({ config: { agent: {} } as Config.Info, update: update(updates) }),
    )

    expect(await readJson("model.json")).toEqual({
      model: { code: { providerID: "anthropic", modelID: "claude-sonnet" } },
      variant: { "openai/gpt-5": { value: "low" } },
    })
  })

  test("keeps_a_variant_changed_during_config_update_for_retry", async () => {
    const updates: Array<{ config: Config.Info; options: { dispose?: boolean } | undefined }> = []
    const state = {
      model: { code: { providerID: "anthropic", modelID: "claude-sonnet" } },
      variant: { "anthropic/claude-sonnet": "high" },
    }
    await writeState(state)

    await Effect.runPromise(
      KilocodeModelVariantMigration.run({
        config: { agent: {} } as Config.Info,
        update: update(updates, undefined, async () => {
          await writeState({
            ...state,
            variant: { "anthropic/claude-sonnet": "low" },
          })
        }),
      }),
    )

    expect(await readJson("model.json")).toEqual({
      ...state,
      variant: { "anthropic/claude-sonnet": "low" },
    })

    await Effect.runPromise(
      KilocodeModelVariantMigration.run({
        config: { agent: {} } as Config.Info,
        update: update(updates),
      }),
    )

    expect(updates).toEqual([
      { config: { agent: { code: { variant: "high" } } }, options: { dispose: false } },
      { config: { agent: { code: { variant: "low" } } }, options: { dispose: false } },
    ])
    expect(await readJson("model.json")).toEqual({
      model: { code: { providerID: "anthropic", modelID: "claude-sonnet" } },
    })
  })

  test("keeps_a_legacy_source_when_the_agent_already_has_a_configured_variant", async () => {
    const updates: Array<{ config: Config.Info; options: { dispose?: boolean } | undefined }> = []
    const state = {
      model: { code: { providerID: "anthropic", modelID: "claude-sonnet" } },
      variant: { "anthropic/claude-sonnet": "high" },
    }
    await writeState(state)

    await Effect.runPromise(
      KilocodeModelVariantMigration.run({
        config: { agent: { code: { variant: "max" } } } as Config.Info,
        update: update(updates),
      }),
    )

    expect(updates).toEqual([])
    expect(await readJson("model.json")).toEqual(state)
  })

  test("serializes_legacy_cleanup_and_console_model_state_writes_with_the_same_lock", async () => {
    const updates: Array<{ config: Config.Info; options: { dispose?: boolean } | undefined }> = []
    const lock = spyOn(Flock, "withLock")
    await writeState({
      model: { code: { providerID: "anthropic", modelID: "claude-sonnet" } },
      variant: { "anthropic/claude-sonnet": "high" },
    })

    try {
      await Effect.runPromise(
        KilocodeModelVariantMigration.run({ config: { agent: {} } as Config.Info, update: update(updates) }),
      )
      await KilocodeModelState.update({ favorite: [{ providerID: "kilo", modelID: "gpt-5.5" }] })

      expect(lock).toHaveBeenCalledWith(`model-state:${file("model.json")}`, expect.any(Function))
      expect(lock).toHaveBeenCalledTimes(2)
    } finally {
      lock.mockRestore()
    }
  })

  test("retries_legacy_variant_after_cleanup_io_failure", async () => {
    const updates: Array<{ config: Config.Info; options: { dispose?: boolean } | undefined }> = []
    const state = {
      model: { code: { providerID: "anthropic", modelID: "claude-sonnet" } },
      variant: { "anthropic/claude-sonnet": "high" },
    }
    await writeState(state)

    await Effect.runPromise(
      KilocodeModelVariantMigration.run({
        config: { agent: {} } as Config.Info,
        update: update(updates, undefined, async () => {
          await rename(file("model.json"), file("model-backup.json"))
          await mkdir(file("model.json"))
        }),
      }),
    )

    expect(updates).toEqual([
      { config: { agent: { code: { variant: "high" } } }, options: { dispose: false } },
    ])
    await rm(file("model.json"), { recursive: true })
    await rename(file("model-backup.json"), file("model.json"))
    expect(await readJson("model.json")).toEqual(state)

    await Effect.runPromise(
      KilocodeModelVariantMigration.run({ config: { agent: {} } as Config.Info, update: update(updates) }),
    )

    expect(updates).toEqual([
      { config: { agent: { code: { variant: "high" } } }, options: { dispose: false } },
      { config: { agent: { code: { variant: "high" } } }, options: { dispose: false } },
    ])
    expect(await readJson("model.json")).toEqual({
      model: { code: { providerID: "anthropic", modelID: "claude-sonnet" } },
    })
  })
})
