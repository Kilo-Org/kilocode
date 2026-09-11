import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { KiloModelRecovery } from "../../src/kilocode/session/model-recovery"
import { KiloSessionTuiSync } from "../../src/kilocode/session/tui-sync"

const candidate = (providerID: string, modelID: string, variant?: string): KiloModelRecovery.Candidate => ({
  providerID: ProviderV2.ID.make(providerID),
  modelID: ModelV2.ID.make(modelID),
  ...(variant ? { variant } : {}),
})

class MissingModel extends Error {}

/** Stands in for Provider.getModel: exact key lookup, typed failure when the catalog lacks the ID. */
function catalog(ids: string[]) {
  const seen: string[] = []
  const lookup = (model: KiloModelRecovery.Candidate) =>
    Effect.suspend(() => {
      const id = `${model.providerID}/${model.modelID}`
      seen.push(id)
      if (!ids.includes(id)) return Effect.fail(new MissingModel(id))
      return Effect.succeed({ id: model.modelID })
    })
  return { lookup, seen }
}

describe("KiloModelRecovery.firstAvailable", () => {
  test("drops a retired gateway model the live catalog no longer has", async () => {
    const live = catalog(["kilo/~anthropic/claude-sonnet-latest"])
    const result = await Effect.runPromise(
      KiloModelRecovery.firstAvailable([candidate("kilo", "anthropic/claude-sonnet-4.5")], live.lookup),
    )

    expect(result).toBeUndefined()
    expect(live.seen).toEqual(["kilo/anthropic/claude-sonnet-4.5"])
  })

  test("does not treat a near-miss slug as an alias", async () => {
    const live = catalog(["kilo/anthropic/claude-sonnet-4-5"])
    const result = await Effect.runPromise(
      KiloModelRecovery.firstAvailable([candidate("kilo", "anthropic/claude-sonnet-4.5")], live.lookup),
    )

    expect(result).toBeUndefined()
  })

  test("keeps a stored model that is still in the catalog, variant included", async () => {
    const live = catalog(["kilo/~anthropic/claude-sonnet-latest"])
    const result = await Effect.runPromise(
      KiloModelRecovery.firstAvailable([candidate("kilo", "~anthropic/claude-sonnet-latest", "max")], live.lookup),
    )

    expect(result).toEqual(candidate("kilo", "~anthropic/claude-sonnet-latest", "max"))
  })

  test("falls through a dead stored model to a live last-message model", async () => {
    const live = catalog(["kilo/~anthropic/claude-sonnet-latest"])
    const result = await Effect.runPromise(
      KiloModelRecovery.firstAvailable(
        [candidate("kilo", "anthropic/claude-sonnet-4.5"), candidate("kilo", "~anthropic/claude-sonnet-latest")],
        live.lookup,
      ),
    )

    expect(result).toEqual(candidate("kilo", "~anthropic/claude-sonnet-latest"))
    expect(live.seen).toEqual(["kilo/anthropic/claude-sonnet-4.5", "kilo/~anthropic/claude-sonnet-latest"])
  })

  test("stops probing once a candidate resolves", async () => {
    const live = catalog(["kilo/~anthropic/claude-sonnet-latest", "kilo/anthropic/claude-sonnet-4.5"])
    await Effect.runPromise(
      KiloModelRecovery.firstAvailable(
        [candidate("kilo", "~anthropic/claude-sonnet-latest"), candidate("kilo", "anthropic/claude-sonnet-4.5")],
        live.lookup,
      ),
    )

    expect(live.seen).toEqual(["kilo/~anthropic/claude-sonnet-latest"])
  })

  test("reports nothing usable when the session has no remembered model", async () => {
    const live = catalog(["kilo/~anthropic/claude-sonnet-latest"])
    const result = await Effect.runPromise(KiloModelRecovery.firstAvailable([], live.lookup))

    expect(result).toBeUndefined()
    expect(live.seen).toEqual([])
  })
})

describe("KiloSessionTuiSync.restore", () => {
  const valid = (ids: string[]) => (model: { providerID: string; modelID: string }) =>
    ids.includes(`${model.providerID}/${model.modelID}`)

  test("does not pin a restored model the catalog dropped", () => {
    const restored = KiloSessionTuiSync.restore({
      model: { providerID: "kilo", modelID: "anthropic/claude-sonnet-4.5", variant: "max" },
      valid: valid(["kilo/~anthropic/claude-sonnet-latest"]),
    })

    expect(restored.type).toBe("stale")
    expect(restored.type === "stale" && restored.model.modelID).toBe("anthropic/claude-sonnet-4.5")
  })

  test("applies a restored model that is still in the catalog", () => {
    const restored = KiloSessionTuiSync.restore({
      model: { providerID: "kilo", modelID: "~anthropic/claude-sonnet-latest", variant: "max" },
      valid: valid(["kilo/~anthropic/claude-sonnet-latest"]),
    })

    expect(restored).toEqual({
      type: "apply",
      model: { providerID: "kilo", modelID: "~anthropic/claude-sonnet-latest", variant: "max" },
    })
  })

  test("skips messages without a model", () => {
    expect(KiloSessionTuiSync.restore({ valid: valid([]) })).toEqual({ type: "skip" })
  })
})
