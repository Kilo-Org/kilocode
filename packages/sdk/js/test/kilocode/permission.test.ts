import { describe, expect, it } from "bun:test"
import { createKiloClient } from "../../src/v2/client"
import { permissionSettled, respondToPermission } from "../../src/kilocode/permission"

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

  it("reports that rules were attempted so the caller can reconcile", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ name: "NotFoundError" }, { status: 404 }),
    })
    try {
      const result = await respondToPermission(createKiloClient({ baseUrl: server.url.href }), {
        ...route,
        reply: "always",
        approvedAlways: ["bun *"],
        deniedAlways: [],
      })
      expect(result.saved).toBe(true)
    } finally {
      await server.stop(true)
    }
  })

  it("shares one deadline across the save and the reply", async () => {
    const gate = Promise.withResolvers<Response>()
    const server = Bun.serve({ port: 0, fetch: () => gate.promise })
    try {
      const started = Date.now()
      const result = await respondToPermission(
        createKiloClient({ baseUrl: server.url.href }),
        { ...route, reply: "once", approvedAlways: ["bun *"], deniedAlways: [] },
        300,
      )
      expect(result.error).toBeDefined()
      expect(Date.now() - started).toBeLessThan(500)
    } finally {
      gate.resolve(Response.json(true))
      await server.stop(true)
    }
  })

  it("retries a dropped transport socket while replying", async () => {
    const paths: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        paths.push(new URL(request.url).pathname)
        return Response.json(true)
      },
    })
    let drops = 1
    const flaky = (request: Request) => {
      if (drops > 0) {
        drops -= 1
        return Promise.reject(new TypeError("terminated"))
      }
      return fetch(request)
    }
    try {
      const result = await respondToPermission(createKiloClient({ baseUrl: server.url.href, fetch: flaky }), {
        ...route,
        reply: "once",
        approvedAlways: [],
        deniedAlways: [],
      })
      expect(result.error).toBeUndefined()
      expect(paths).toEqual(["/permission/p1/reply"])
    } finally {
      await server.stop(true)
    }
  })

  it("retries a dropped transport socket while saving rules", async () => {
    const paths: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        paths.push(new URL(request.url).pathname)
        return Response.json(true)
      },
    })
    let drops = 1
    const flaky = (request: Request) => {
      if (drops > 0) {
        drops -= 1
        return Promise.reject(new TypeError("terminated"))
      }
      return fetch(request)
    }
    try {
      const result = await respondToPermission(createKiloClient({ baseUrl: server.url.href, fetch: flaky }), {
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

  it("does not retry a decisive not-found response", async () => {
    let calls = 0
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        calls += 1
        return Response.json({ name: "NotFoundError" }, { status: 404 })
      },
    })
    try {
      const result = await respondToPermission(createKiloClient({ baseUrl: server.url.href }), {
        ...route,
        reply: "once",
        approvedAlways: [],
        deniedAlways: [],
      })
      expect(result.error).toBeDefined()
      expect(calls).toBe(1)
    } finally {
      await server.stop(true)
    }
  })

  it("does not retry a status-less client error", async () => {
    let calls = 0
    const failing = () => {
      calls += 1
      return Promise.reject(new Error("Request is not supported by this version of OpenCode Server"))
    }
    const result = await respondToPermission(createKiloClient({ baseUrl: "http://127.0.0.1:1/", fetch: failing }), {
      ...route,
      reply: "once",
      approvedAlways: [],
      deniedAlways: [],
    })
    expect(result.error).toBeDefined()
    expect(calls).toBe(1)
  })
})

describe("permissionSettled", () => {
  it("reports settled when the request is no longer pending", async () => {
    const server = Bun.serve({ port: 0, fetch: () => Response.json([]) })
    try {
      expect(await permissionSettled(createKiloClient({ baseUrl: server.url.href }), route.directory, "p1")).toBe(true)
    } finally {
      await server.stop(true)
    }
  })

  it("reports pending when the request is still listed", async () => {
    const server = Bun.serve({ port: 0, fetch: () => Response.json([{ id: "p1" }]) })
    try {
      expect(await permissionSettled(createKiloClient({ baseUrl: server.url.href }), route.directory, "p1")).toBe(false)
    } finally {
      await server.stop(true)
    }
  })

  it("reports unknown when the list fails", async () => {
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ message: "boom" }, { status: 500 }) })
    try {
      expect(await permissionSettled(createKiloClient({ baseUrl: server.url.href }), route.directory, "p1")).toBe(false)
    } finally {
      await server.stop(true)
    }
  })
})
