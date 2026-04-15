// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { Permission } from "../../../src/permission"
import { PermissionID } from "../../../src/permission/schema"
import { Instance } from "../../../src/project/instance"
import { Server } from "../../../src/server/server"
import { Session } from "../../../src/session"
import { tmpdir } from "../../fixture/fixture"

describe("permission.allowEverything endpoint", () => {
  test("disables global allow-all and removes wildcard from config", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.Default().app

        // Enable global auto-approve
        const enable = await app.request("/permission/allow-everything", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kilo-directory": tmp.path },
          body: JSON.stringify({ enable: true }),
        })
        expect(enable.status).toBe(200)

        // Disable global auto-approve
        const disable = await app.request("/permission/allow-everything", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kilo-directory": tmp.path },
          body: JSON.stringify({ enable: false }),
        })
        expect(disable.status).toBe(200)
        expect(await disable.json()).toBe(true)

        // After disabling, permission requests should not be auto-approved
        const session = await Session.create({})
        const pending = Permission.ask({
          id: PermissionID.make("permission_global_disable"),
          sessionID: session.id,
          permission: "bash",
          patterns: ["ls"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        await Permission.reply({
          requestID: PermissionID.make("permission_global_disable"),
          reply: "reject",
        })

        await expect(pending).rejects.toBeInstanceOf(Permission.RejectedError)
      },
    })
  })

  test("disables session-scoped allow-all without touching global config", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.Default().app
        const session = await Session.create({
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        await Permission.allowEverything({
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

        const pending = Permission.ask({
          id: PermissionID.make("permission_session_disable"),
          sessionID: session.id,
          permission: "bash",
          patterns: ["ls"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        await Permission.reply({
          requestID: PermissionID.make("permission_session_disable"),
          reply: "reject",
        })

        await expect(pending).rejects.toBeInstanceOf(Permission.RejectedError)

        const other = await Session.create({})
        const blocked = Permission.ask({
          id: PermissionID.make("permission_other_session"),
          sessionID: other.id,
          permission: "bash",
          patterns: ["pwd"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        await Permission.reply({
          requestID: PermissionID.make("permission_other_session"),
          reply: "reject",
        })

        await expect(blocked).rejects.toBeInstanceOf(Permission.RejectedError)
      },
    })
  })
})
