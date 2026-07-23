import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { Global } from "@opencode-ai/core/global"
import { Server } from "../../../src/server/server"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

void Log.init({ print: false })

const original = Global.Path.state

afterEach(async () => {
  Global.Path.state = original
  await disposeAllInstances()
  await resetDatabase()
})

function req(input: string, init?: RequestInit) {
  return Server.Default().app.request(input, init)
}

async function json<T>(response: Response) {
  expect(response.status).toBe(200)
  return (await response.json()) as T
}

describe("config model state routes", () => {
  test("reads TUI model favorites", async () => {
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(
      path.join(tmp.path, "model.json"),
      JSON.stringify({
        recent: [{ providerID: "kilo", modelID: "gpt-5.5" }],
        favorite: [
          { providerID: "kilo", modelID: "gpt-5.5" },
          { providerID: "kilo", modelID: "qwen/qwen3-8b" },
        ],
        model: {},
        variant: {},
      }),
    )

    const body = await json<{ favorite: Array<{ providerID: string; modelID: string }>; variant?: unknown }>(
      await req("/config/model-state"),
    )

    expect(body.favorite).toEqual([
      { providerID: "kilo", modelID: "gpt-5.5" },
      { providerID: "kilo", modelID: "qwen/qwen3-8b" },
    ])
    expect(body.variant).toBeUndefined()
  })

  test("updates favorites while preserving legacy variants", async () => {
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(
      path.join(tmp.path, "model.json"),
      JSON.stringify({
        recent: [{ providerID: "kilo", modelID: "recent" }],
        favorite: [],
        model: {},
        variant: { "openai/gpt-5": "low" },
      }),
    )

    const body = await json<{ recent: unknown[]; favorite: unknown[]; variant?: unknown }>(
      await req("/config/model-state", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ favorite: [{ providerID: "kilo", modelID: "gpt-5.5" }] }),
      }),
    )

    expect(body.recent).toEqual([{ providerID: "kilo", modelID: "recent" }])
    expect(body.favorite).toEqual([{ providerID: "kilo", modelID: "gpt-5.5" }])
    expect(body.variant).toBeUndefined()

    const saved = await Bun.file(path.join(tmp.path, "model.json")).text()
    expect(saved).toContain('"openai/gpt-5": "low"')
    expect((JSON.parse(saved) as { variant?: unknown }).variant).toEqual({ "openai/gpt-5": "low" })
  })

  test("does_not_replace_malformed_model_state", async () => {
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    const state = "{ malformed"
    const file = path.join(tmp.path, "model.json")
    await Bun.write(file, state)

    const response = await req("/config/model-state", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favorite: [{ providerID: "kilo", modelID: "gpt-5.5" }] }),
    })

    expect(response.status).toBe(500)
    expect(await Bun.file(file).text()).toBe(state)
  })

  test("does_not_replace_parsed_non_record_model_state", async () => {
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    const file = path.join(tmp.path, "model.json")

    for (const state of ["[]", "null", '"text"', "42", "true"]) {
      await Bun.write(file, state)

      const response = await req("/config/model-state", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ favorite: [{ providerID: "kilo", modelID: "gpt-5.5" }] }),
      })

      expect(response.status).toBe(500)
      expect(await Bun.file(file).text()).toBe(state)
    }
  })
})
