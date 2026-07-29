import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { Server } from "../../../src/server/server"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

void Log.init({ print: false })

type Context = {
  instructions: { present: boolean }
  skills: { present: boolean }
  commands: { present: boolean }
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

function req(dir: string) {
  return Server.Default().app.request("/config/claude-context", {
    headers: { "x-kilo-directory": dir },
  })
}

async function json(response: Response) {
  expect(response.status).toBe(200)
  return (await response.json()) as Context
}

describe("claude context route", () => {
  test.serial("detects project Claude context", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "CLAUDE.md"), "Project instructions")
        await Bun.write(path.join(dir, ".claude", "skills", "helper", "SKILL.md"), "Skill")
        await Bun.write(path.join(dir, ".claude", "commands", "helper.md"), "Command")
      },
    })

    const body = await json(await req(tmp.path))

    expect(body).toEqual({
      instructions: { present: true },
      skills: { present: true },
      commands: { present: true },
    })
  })

  test.serial("returns absent when no Claude context exists", async () => {
    await using tmp = await tmpdir()

    const body = await json(await req(tmp.path))

    expect(body).toEqual({
      instructions: { present: false },
      skills: { present: false },
      commands: { present: false },
    })
  })
})
