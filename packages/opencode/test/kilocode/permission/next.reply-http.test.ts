import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Permission } from "../../../src/permission"
import { PermissionID } from "../../../src/permission/schema"
import { WithInstance } from "../../../src/project/with-instance"
import { Session } from "../../../src/session/session"
import { tmpdir } from "../../fixture/fixture"

const original = Flag.KILO_EXPERIMENTAL_HTTPAPI

afterEach(() => {
  Flag.KILO_EXPERIMENTAL_HTTPAPI = original
})

async function app(experimental = false) {
  const { Server } = await import("../../../src/server/server")
  Flag.KILO_EXPERIMENTAL_HTTPAPI = experimental
  return experimental ? Server.Default().app : Server.Legacy().app
}

describe("POST /permission/:requestID/reply", () => {
  test("returns 404 when requestID is not pending", async () => {
    await using tmp = await tmpdir({ git: true })

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const server = await app()

        const response = await server.request("/permission/permission_missing/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kilo-directory": tmp.path },
          body: JSON.stringify({ reply: "once" }),
        })

        expect(response.status).toBe(404)
        const body = (await response.json()) as { name: string; data: { message: string } }
        expect(body.name).toBe("NotFoundError")
        expect(body.data.message).toMatch(/permission_missing/)
      },
    })
  })

  test("returns 200 for an accepted reply", async () => {
    await using tmp = await tmpdir({ git: true })

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const server = await app()
        const session = await Session.create({})

        const asking = Permission.ask({
          id: PermissionID.make("permission_accepted_http"),
          sessionID: session.id,
          permission: "bash",
          patterns: ["ls"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        for (let i = 0; i < 100; i++) {
          const list = await Permission.list()
          if (list.length > 0) break
          await new Promise((resolve) => setTimeout(resolve, 10))
        }

        const response = await server.request("/permission/permission_accepted_http/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kilo-directory": tmp.path },
          body: JSON.stringify({ reply: "once" }),
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toBe(true)

        await asking
      },
    })
  })

  test("returns 404 when replying to an already-answered request (double-reply)", async () => {
    await using tmp = await tmpdir({ git: true })

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const server = await app()
        const session = await Session.create({})

        const asking = Permission.ask({
          id: PermissionID.make("permission_double_http"),
          sessionID: session.id,
          permission: "bash",
          patterns: ["pwd"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        for (let i = 0; i < 100; i++) {
          const list = await Permission.list()
          if (list.length > 0) break
          await new Promise((resolve) => setTimeout(resolve, 10))
        }

        const first = await server.request("/permission/permission_double_http/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kilo-directory": tmp.path },
          body: JSON.stringify({ reply: "once" }),
        })
        expect(first.status).toBe(200)
        await asking

        const second = await server.request("/permission/permission_double_http/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kilo-directory": tmp.path },
          body: JSON.stringify({ reply: "once" }),
        })
        expect(second.status).toBe(404)
      },
    })
  })

  test("returns 404 for unknown replies when experimental HttpApi is enabled", async () => {
    await using tmp = await tmpdir({ git: true })

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const server = await app(true)

        const response = await server.request("/permission/permission_missing/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kilo-directory": tmp.path },
          body: JSON.stringify({ reply: "once" }),
        })

        expect(response.status).toBe(404)
      },
    })
  })
})

describe("POST /permission/:requestID/always-rules", () => {
  test("returns 404 when requestID is not pending", async () => {
    await using tmp = await tmpdir({ git: true })

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const server = await app()

        const response = await server.request("/permission/permission_missing/always-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kilo-directory": tmp.path },
          body: JSON.stringify({ approvedAlways: ["npm *"] }),
        })

        expect(response.status).toBe(404)
        const body = (await response.json()) as { name: string }
        expect(body.name).toBe("NotFoundError")
      },
    })
  })

  test("returns 200 for an accepted save", async () => {
    await using tmp = await tmpdir({ git: true })

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const server = await app()
        const session = await Session.create({})

        const asking = Permission.ask({
          id: PermissionID.make("permission_always_http"),
          sessionID: session.id,
          permission: "bash",
          patterns: ["npm install"],
          metadata: { rules: ["npm *", "npm install"] },
          always: ["npm install *"],
          ruleset: [],
        })

        for (let i = 0; i < 100; i++) {
          const list = await Permission.list()
          if (list.length > 0) break
          await new Promise((resolve) => setTimeout(resolve, 10))
        }

        const save = await server.request("/permission/permission_always_http/always-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kilo-directory": tmp.path },
          body: JSON.stringify({ approvedAlways: ["npm install"] }),
        })
        expect(save.status).toBe(200)
        expect(await save.json()).toBe(true)

        await Permission.reply({
          requestID: PermissionID.make("permission_always_http"),
          reply: "once",
        })
        await asking
      },
    })
  })
})
