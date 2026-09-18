import { describe, expect, it } from "bun:test"
import { createKiloClient } from "../../src/v2/client"
import { respondToPermission } from "../../src/kilocode/permission"

const route = { requestID: "p1", directory: "/worktree" }

describe("respondToPermission", () => {
  it("saves rules then replies", async () => {
    const paths: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        paths.push(new URL(request.url).pathname)
        return Response.json(true)
      },
    })
    try {
      const result = await respondToPermission(createKiloClient({ baseUrl: server.url.href }), {
        ...route,
        reply: "once",
        approvedAlways: ["bun *"],
        deniedAlways: [],
      })
      expect(result.error).toBeUndefined()
      expect(paths).toEqual(["/permission/p1/always-rules", "/permission/p1/reply"])
    } finally {
      await server.stop(true)
    }
  })

  it("bounds a stalled reply and returns the error", async () => {
    const gate = Promise.withResolvers<Response>()
    const server = Bun.serve({ port: 0, fetch: () => gate.promise })
    try {
      const result = await respondToPermission(
        createKiloClient({ baseUrl: server.url.href }),
        { ...route, reply: "once", approvedAlways: [], deniedAlways: [] },
        20,
      )
      expect(result.error).toBeDefined()
    } finally {
      gate.resolve(Response.json(true))
      await server.stop(true)
    }
  })

  it("does not reply when saving rules stalls", async () => {
    const paths: string[] = []
    const gate = Promise.withResolvers<Response>()
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname
        paths.push(path)
        return path.endsWith("always-rules") ? gate.promise : Response.json(true)
      },
    })
    try {
      const result = await respondToPermission(
        createKiloClient({ baseUrl: server.url.href }),
        { ...route, reply: "once", approvedAlways: ["bun *"], deniedAlways: [] },
        20,
      )
      expect(result.error).toBeDefined()
      expect(paths).toEqual(["/permission/p1/always-rules"])
    } finally {
      gate.resolve(Response.json(true))
      await server.stop(true)
    }
  })

  it("returns a 404 so the caller can treat the request as stale", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ name: "NotFoundError" }, { status: 404 }),
    })
    try {
      const result = await respondToPermission(createKiloClient({ baseUrl: server.url.href }), {
        ...route,
        reply: "once",
        approvedAlways: [],
        deniedAlways: [],
      })
      expect(result.error).toBeDefined()
    } finally {
      await server.stop(true)
    }
  })
})
