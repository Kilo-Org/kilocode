import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { Server } from "../../../src/server/server"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

void Log.init({ print: false })

type Rules = {
  target: string
  files: Array<{ name: string; exists: boolean; editable: boolean; content: string }>
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

function req(dir: string, input: string, init?: RequestInit) {
  return Server.Default().app.request(input, {
    ...init,
    headers: {
      "x-kilo-directory": dir,
      ...init?.headers,
    },
  })
}

async function json<T>(response: Response) {
  expect(response.status).toBe(200)
  return (await response.json()) as T
}

describe("config rules routes", () => {
  test.serial("lists project instruction files", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "CLAUDE.md"), "Legacy rules")
      },
    })

    const body = await json<Rules>(await req(tmp.path, "/config/rules"))

    expect(body.target).toBe(path.join(tmp.path, "AGENTS.md"))
    expect(body.files.find((file) => file.name === "CLAUDE.md")).toMatchObject({
      exists: true,
      editable: false,
      content: "Legacy rules",
    })
    expect(body.files.find((file) => file.name === "AGENTS.md")).toMatchObject({ exists: false, editable: true })
  })

  test.serial("creates and updates AGENTS.md", async () => {
    await using tmp = await tmpdir()

    const body = await json<Rules>(
      await req(tmp.path, "/config/rules", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "Use small changes." }),
      }),
    )

    expect(body.files.find((file) => file.name === "AGENTS.md")).toMatchObject({
      exists: true,
      editable: true,
      content: "Use small changes.",
    })
    expect(await Bun.file(path.join(tmp.path, "AGENTS.md")).text()).toBe("Use small changes.")
  })
})
