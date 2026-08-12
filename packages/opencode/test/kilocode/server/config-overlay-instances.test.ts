// kilocode_change start - split out of config-overlay.test.ts; see config-overlay-shared.ts
// for why. Test bodies are unchanged.
import { describe, expect, test } from "bun:test"
import { Permission } from "../../../src/permission"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"
import { app, json, request, setGlobal, setup, type Agent } from "./config-overlay-shared"

setup()

describe("config overlay routes: instance refresh", () => {
  for (const value of [false, true]) {
    test.serial(
      `${value ? "httpapi" : "legacy"} global overlay update refreshes existing project instances without a project directory`,
      async () => {
        await using global = await tmpdir()
        await using project = await tmpdir()
        await setGlobal(global.path, { permission: { edit: "ask" } })
        await disposeAllInstances()
        const target = app(value)

        const before = await json<Agent[]>(await request(target, project.path, "/agent"))
        expect(
          Permission.evaluate("edit", "*", before.find((item) => item.name === "code")?.permission ?? []).action,
        ).toBe("ask")

        await json(
          await request(target, undefined, "/config/overlay", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ scope: "global", set: { permission: { edit: { "*": "allow" } } } }),
          }),
        )
        const after = await json<Agent[]>(await request(target, project.path, "/agent"))

        expect(
          Permission.evaluate("edit", "*", after.find((item) => item.name === "code")?.permission ?? []).action,
        ).toBe("allow")
      },
      // Cold Windows CI runs take ~32s (observed timeout at 30s); give the two
      // instance create/dispose cycles of each iteration real headroom.
      90_000,
    )
  }
})
// kilocode_change end
