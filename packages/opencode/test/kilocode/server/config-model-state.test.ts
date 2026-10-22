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

    const body = await json<{ favorite: Array<{ providerID: string; modelID: string }> }>(
      await req("/config/model-state"),
    )

    expect(body.favorite).toEqual([
      { providerID: "kilo", modelID: "gpt-5.5" },
      { providerID: "kilo", modelID: "qwen/qwen3-8b" },
    ])
  })

  test("updates favorites while preserving recents", async () => {
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(
      path.join(tmp.path, "model.json"),
      JSON.stringify({
        recent: [{ providerID: "kilo", modelID: "recent" }],
        favorite: [],
        model: {},
        variant: {},
      }),
    )

    const body = await json<{ recent: unknown[]; favorite: unknown[] }>(
      await req("/config/model-state", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ favorite: [{ providerID: "kilo", modelID: "gpt-5.5" }] }),
      }),
    )

    expect(body.recent).toEqual([{ providerID: "kilo", modelID: "recent" }])
    expect(body.favorite).toEqual([{ providerID: "kilo", modelID: "gpt-5.5" }])
  })
})
