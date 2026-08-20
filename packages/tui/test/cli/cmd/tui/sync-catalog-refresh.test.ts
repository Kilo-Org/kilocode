// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import type { GlobalEvent } from "@kilocode/sdk/v2"
import { tmpdir } from "../../../fixture/fixture"
import { json, mount, wait } from "./sync-fixture"

const fallbackModel = "~anthropic/claude-sonnet-latest"
const liveModel = "anthropic/claude-sonnet-4.5"

function model(id: string, name: string) {
  return {
    id,
    name,
    release_date: "2025-01-01",
    attachment: true,
    reasoning: false,
    temperature: true,
    tool_call: true,
    cost: { input: 3, output: 15 },
    limit: { context: 200000, output: 64000 },
    options: {},
  }
}

function kilo(modelID: string, name: string) {
  return {
    id: "kilo",
    name: "Kilo Gateway",
    source: "api",
    env: ["KILO_API_KEY"],
    options: {},
    models: { [modelID]: model(modelID, name) },
  }
}

function refreshed(): GlobalEvent {
  return {
    directory: "global",
    payload: { id: "evt_models_dev_refreshed", type: "models-dev.refreshed", properties: {} },
  }
}

/** Serves the bundled models.dev fallback first, then the live Kilo Gateway catalog. */
function catalog() {
  let configProviders = 0
  let providerList = 0
  return {
    get counts() {
      return { configProviders, providerList }
    },
    handle(url: URL) {
      if (url.pathname === "/config/providers") {
        const first = configProviders++ === 0
        return json({
          providers: [
            first ? kilo(fallbackModel, "Anthropic Claude Sonnet Latest") : kilo(liveModel, "Claude Sonnet 4.5"),
          ],
          default: { kilo: first ? fallbackModel : liveModel },
        })
      }
      if (url.pathname === "/provider") {
        const first = providerList++ === 0
        return json({
          all: [first ? kilo(fallbackModel, "Anthropic Claude Sonnet Latest") : kilo(liveModel, "Claude Sonnet 4.5")],
          default: { kilo: first ? fallbackModel : liveModel },
          connected: ["kilo"],
          failed: [],
        })
      }
      return undefined
    },
  }
}

describe("tui sync catalog refresh", () => {
  test("a late gateway catalog replaces the fallback the picker bootstrapped with", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const models = catalog()
    const { app, emit, sync } = await mount((url) => models.handle(url), tmp.path)

    try {
      expect(Object.keys(sync.data.provider[0].models)).toEqual([fallbackModel])
      expect(Object.keys(sync.data.provider_next.all[0].models)).toEqual([fallbackModel])
      expect(sync.data.provider_default["kilo"]).toBe(fallbackModel)

      emit(refreshed())
      await wait(() => Object.keys(sync.data.provider[0].models)[0] === liveModel)

      expect(sync.data.provider[0].models[liveModel].name).toBe("Claude Sonnet 4.5")
      expect(Object.keys(sync.data.provider_next.all[0].models)).toEqual([liveModel])
      expect(sync.data.provider_default["kilo"]).toBe(liveModel)
    } finally {
      app.renderer.destroy()
    }
  })

  test("a re-bootstrap after the refresh keeps the live catalog", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const models = catalog()
    const { app, emit, sync } = await mount((url) => models.handle(url), tmp.path)

    try {
      emit(refreshed())
      await wait(() => Object.keys(sync.data.provider[0].models)[0] === liveModel)

      // /teams org switches dispose the instance and rebootstrap; the picker must follow.
      await sync.bootstrap()

      expect(Object.keys(sync.data.provider[0].models)).toEqual([liveModel])
      expect(Object.keys(sync.data.provider_next.all[0].models)).toEqual([liveModel])
      expect(models.counts.configProviders).toBeGreaterThan(2)
    } finally {
      app.renderer.destroy()
    }
  })
})
