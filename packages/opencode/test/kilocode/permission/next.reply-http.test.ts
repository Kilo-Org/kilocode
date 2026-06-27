import { describe, expect, test } from "bun:test"
import { provideTestInstance } from "../../fixture/fixture"
import { tmpdir } from "../../fixture/fixture"

async function app() {
  const { Server } = await import("../../../src/server/server")
  return Server.Default().app
}

describe("POST /permission/:requestID/reply", () => {
  test("returns 404 when requestID is not pending", async () => {
    await using tmp = await tmpdir({ git: true })

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const server = await app()

        const response = await server.request("/permission/permission_missing/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kilo-directory": tmp.path },
          body: JSON.stringify({ reply: "once" }),
        })

        expect(response.status).toBe(404)
        const body = (await response.json()) as { _tag: string; requestID: string; message: string }
        expect(body).toEqual({
          _tag: "PermissionNotFoundError",
          requestID: "permission_missing",
          message: "Permission request not found: permission_missing",
        })
      },
    })
  })
})

describe("POST /permission/:requestID/always-rules", () => {
  test("returns 404 when requestID is not pending", async () => {
    await using tmp = await tmpdir({ git: true })

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const server = await app()

        const response = await server.request("/permission/permission_missing/always-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kilo-directory": tmp.path },
          body: JSON.stringify({ approvedAlways: ["npm *"] }),
        })

        expect(response.status).toBe(404)
        const body = (await response.json()) as { _tag: string; requestID: string; message: string }
        expect(body).toEqual({
          _tag: "PermissionNotFoundError",
          requestID: "permission_missing",
          message: "Permission request not found: permission_missing",
        })
      },
    })
  })
})
