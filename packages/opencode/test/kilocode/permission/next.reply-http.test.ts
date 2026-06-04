import { describe, expect, test } from "bun:test"
import { WithInstance } from "../../../src/project/with-instance"
import { tmpdir } from "../../fixture/fixture"

async function app() {
  const { Server } = await import("../../../src/server/server")
  return Server.Default().app
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
