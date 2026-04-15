// kilocode_change - new file
import { afterEach, test, expect } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { Global } from "../../src/global"

afterEach(async () => {
  await Instance.disposeAll()
})

test("code agent allows global config directory reads by default", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const code = await Agent.get("code")
      expect(code).toBeDefined()
      expect(Permission.evaluate("external_directory", `${Global.Path.config}/*`, code!.permission).action).toBe(
        "allow",
      )
    },
  })
})
