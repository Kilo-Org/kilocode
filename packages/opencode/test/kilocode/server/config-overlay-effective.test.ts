// kilocode_change start - split out of config-overlay.test.ts; see config-overlay-shared.ts
// for why. Test bodies are unchanged.
import { describe, expect, test } from "bun:test"
import { Permission } from "../../../src/permission"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"
import { json, req, setGlobal, setup, type Agent, type Overlay } from "./config-overlay-shared"

setup()

describe("config overlay routes: effective config", () => {
  test.serial("refreshes effective config after project permission update", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir()
    await setGlobal(global.path, { permission: { edit: "allow" } })

    const before = await json<Agent[]>(await req(project.path, "/agent"))
    expect(Permission.evaluate("edit", "*", before.find((item) => item.name === "code")?.permission ?? []).action).toBe(
      "allow",
    )

    await json(
      await req(project.path, "/config/overlay", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "project", set: { permission: { edit: { "*": "ask" } } } }),
      }),
    )
    const body = await json<Overlay & { effective: { permission: Record<string, string | Record<string, string>> } }>(
      await req(project.path, "/config/overlay?scope=project"),
    )
    const edit = body.effective.permission.edit
    const after = await json<Agent[]>(await req(project.path, "/agent"))

    expect(typeof edit === "string" ? edit : edit?.["*"]).toBe("ask")
    expect(Permission.evaluate("edit", "*", after.find((item) => item.name === "code")?.permission ?? []).action).toBe(
      "ask",
    )
    expect(body.collections.permission.find((item) => item.key === "edit")).toMatchObject({
      source: "project",
      overridden: true,
    })
  })

  test.serial("refreshes agent permissions after global permission update", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir()
    await setGlobal(global.path, { permission: { edit: "allow" } })

    const before = await json<Agent[]>(await req(project.path, "/agent"))
    expect(Permission.evaluate("edit", "*", before.find((item) => item.name === "code")?.permission ?? []).action).toBe(
      "allow",
    )

    await json(
      await req(project.path, "/config/overlay", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "global", set: { permission: { edit: { "*": "ask" } } } }),
      }),
    )
    const body = await json<Overlay & { effective: { permission: Record<string, string | Record<string, string>> } }>(
      await req(project.path, "/config/overlay?scope=global"),
    )
    const edit = body.effective.permission.edit
    const after = await json<Agent[]>(await req(project.path, "/agent"))

    expect(typeof edit === "string" ? edit : edit?.["*"]).toBe("ask")
    expect(Permission.evaluate("edit", "*", after.find((item) => item.name === "code")?.permission ?? []).action).toBe(
      "ask",
    )
  })

  test.serial("sets and unsets privacy_mode at project scope using tuple-array unset paths", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir()
    await setGlobal(global.path, { privacy_mode: false })
    await disposeAllInstances()

    await json(
      await req(project.path, "/config/overlay", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "project", set: { privacy_mode: true } }),
      }),
    )

    const overlay1 = await json<Overlay>(await req(project.path, "/config/overlay"))
    expect(overlay1.effective?.privacy_mode).toBe(true)

    await json(
      await req(project.path, "/config/overlay", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "project", unset: [["privacy_mode"]] }),
      }),
    )

    const overlay2 = await json<Overlay>(await req(project.path, "/config/overlay"))
    expect(overlay2.effective?.privacy_mode).toBe(false)
  })
})
// kilocode_change end
