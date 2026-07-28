import { afterEach, describe, expect, test } from "bun:test"
import { Server } from "../../../src/server/server"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("commit-message httpapi", () => {
  test("returns 422 with the real message when there are no changes", async () => {
    await using tmp = await tmpdir({ git: true })

    const res = await Server.Default().app.request("/commit-message", {
      method: "POST",
      headers: { "content-type": "application/json", "x-kilo-directory": tmp.path },
      body: JSON.stringify({ path: tmp.path }),
    })

    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ message: "No changes found to generate a commit message for" })
  })
})
