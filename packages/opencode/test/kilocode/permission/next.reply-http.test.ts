import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { WithInstance } from "../../../src/project/with-instance"
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
})
