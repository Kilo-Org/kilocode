// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

describe("permission.allowEverything endpoint", () => {
  test("disables session-scoped allow-all without touching global config", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        await PermissionNext.allowEverything({
          enable: true,
          sessionID: session.id,
        })

        const response = await app.request("/permission/allow-everything", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-kilo-directory": tmp.path,
          },
          body: JSON.stringify({ enable: false, sessionID: session.id }),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toBe(true)

        const next = await Session.get(session.id)
        expect(next.permission ?? []).toEqual([])

        const pending = PermissionNext.ask({
          id: "permission_session_disable",
          sessionID: session.id,
          permission: "bash",
          patterns: ["ls"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        await PermissionNext.reply({
          requestID: "permission_session_disable",
          reply: "reject",
        })

        await expect(pending).rejects.toBeInstanceOf(PermissionNext.RejectedError)

        const other = await Session.create({})
        const blocked = PermissionNext.ask({
          id: "permission_other_session",
          sessionID: other.id,
          permission: "bash",
          patterns: ["pwd"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        await PermissionNext.reply({
          requestID: "permission_other_session",
          reply: "reject",
        })

        await expect(blocked).rejects.toBeInstanceOf(PermissionNext.RejectedError)
      },
    })
  })
})
