import { afterEach, describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { Server } from "../../../src/server/server"
import { CommitMessageRuntime } from "../../../src/kilocode/commit-message/generate"
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

  test("returns 422 with the real message when generation fails", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "note.txt"), "hello")

    const model = spyOn(CommitMessageRuntime, "model").mockResolvedValue({
      providerID: "test",
      id: "test-small-model",
    } as never)
    const generate = spyOn(CommitMessageRuntime, "generate").mockRejectedValue(new Error("provider rate limited"))
    try {
      const res = await Server.Default().app.request("/commit-message", {
        method: "POST",
        headers: { "content-type": "application/json", "x-kilo-directory": tmp.path },
        body: JSON.stringify({ path: tmp.path }),
      })

      expect(res.status).toBe(422)
      expect(await res.json()).toEqual({ message: "Failed to generate commit message: provider rate limited" })
    } finally {
      generate.mockRestore()
      model.mockRestore()
    }
  })
})
