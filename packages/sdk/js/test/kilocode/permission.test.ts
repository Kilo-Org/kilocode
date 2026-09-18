import { describe, expect, it } from "bun:test"
import { createKiloClient } from "../../src/v2/client"
import { permissionStatus, respondToPermission } from "../../src/kilocode/permission"

const route = { requestID: "p1", sessionID: "s1", directory: "/worktree/original" }
const permission = { id: "p1", sessionID: "s1", permission: "bash", patterns: ["*"], always: [], metadata: {} }

describe("permission response recovery", () => {
  it("permits an explicit retry after a completed HTTP error and pending reconciliation", async () => {
    let replies = 0
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname === "/permission") return Response.json([permission])
        replies += 1
        return Response.json({ message: "save failed" }, { status: 500 })
      },
    })
    try {
      const client = createKiloClient({ baseUrl: server.url.href })
      const input = { ...route, reply: "once" as const, approvedAlways: [], deniedAlways: [] }
      expect((await respondToPermission(client, input, 30)).status).toBe("pending")
      expect(replies).toBe(1)
      expect((await respondToPermission(client, input, 30)).status).toBe("pending")
      expect(replies).toBe(2)
    } finally {
      await server.stop(true)
    }
  })

  it.each(["always-rules", "reply"])("bounds stalled %s without allowing conflicting retries", async (operation) => {
    const requests: string[] = []
    const gate = Promise.withResolvers<Response>()
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        expect(url.searchParams.get("directory")).toBe(route.directory)
        requests.push(url.pathname)
        if (url.pathname === "/permission") return Response.json([permission])
        if (url.pathname.endsWith(operation)) return gate.promise
        return Response.json(true)
      },
    })
    try {
      const client = createKiloClient({ baseUrl: server.url.href })
      const result = await respondToPermission(
        client,
        { ...route, reply: "once", approvedAlways: ["bun *"], deniedAlways: [] },
        30,
      )
      expect(result.status).toBe("unknown")
      expect(requests).toEqual(
        operation === "always-rules"
          ? ["/permission", "/permission/p1/always-rules", "/permission"]
          : ["/permission", "/permission/p1/always-rules", "/permission/p1/reply", "/permission"],
      )
      expect(await permissionStatus(client, route)).toBe("unknown")
      expect(
        (
          await respondToPermission(
            client,
            { ...route, reply: "reject", approvedAlways: [], deniedAlways: ["bun *"] },
            30,
          )
        ).status,
      ).toBe("unknown")
      expect(requests.filter((path) => path.endsWith("/always-rules"))).toHaveLength(1)
      expect(requests.filter((path) => path.endsWith("/reply"))).toHaveLength(operation === "reply" ? 1 : 0)
      gate.resolve(Response.json(true))
      for (let attempt = 0; attempt < 20 && (await permissionStatus(client, route)) !== "pending"; attempt++)
        await Bun.sleep(5)
      expect(await permissionStatus(client, route)).toBe("pending")
      expect(requests.filter((path) => path.endsWith("/reply"))).toHaveLength(operation === "reply" ? 1 : 0)
    } finally {
      gate.resolve(Response.json(true))
      await server.stop(true)
    }
  })

  it("dismisses an accepted reply whose HTTP response was lost", async () => {
    let pending = true
    let replies = 0
    const gate = Promise.withResolvers<Response>()
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname === "/permission") return Response.json(pending ? [permission] : [])
        pending = false
        replies += 1
        return gate.promise
      },
    })
    try {
      const client = createKiloClient({ baseUrl: server.url.href })
      const input = { ...route, reply: "once" as const, approvedAlways: [], deniedAlways: [] }
      expect((await respondToPermission(client, input, 30)).status).toBe("missing")
      expect((await respondToPermission(client, input, 30)).status).toBe("missing")
      expect(replies).toBe(1)
    } finally {
      gate.resolve(Response.json(true))
      await server.stop(true)
    }
  })

  it("does not write when the original directory cannot be checked or the session differs", async () => {
    let unavailable = true
    const methods: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        methods.push(request.method)
        return unavailable
          ? new Response("unavailable", { status: 503 })
          : Response.json([{ ...permission, sessionID: "other" }])
      },
    })
    try {
      const client = createKiloClient({ baseUrl: server.url.href })
      const input = { ...route, reply: "once" as const, approvedAlways: [], deniedAlways: [] }
      expect((await respondToPermission(client, input)).status).toBe("unknown")
      unavailable = false
      expect((await respondToPermission(client, input)).status).toBe("missing")
      expect(methods).toEqual(["GET", "GET"])
    } finally {
      await server.stop(true)
    }
  })

  it.each(["headers", "body"])("bounds a status check with stalled %s", async (part) => {
    const gate = Promise.withResolvers<Response>()
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        part === "headers"
          ? gate.promise
          : new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode("["))
                },
              }),
              { headers: { "content-type": "application/json" } },
            ),
    })
    try {
      expect(await permissionStatus(createKiloClient({ baseUrl: server.url.href }), route, 30)).toBe("unknown")
    } finally {
      gate.resolve(Response.json([]))
      await server.stop(true)
    }
  })

  it.each([{ invalid: true }, [{}], [null]])("treats malformed pending lists as unknown (%j)", async (data) => {
    const methods: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        methods.push(request.method)
        return Response.json(data)
      },
    })
    try {
      const client = createKiloClient({ baseUrl: server.url.href })
      expect(
        (await respondToPermission(client, { ...route, reply: "once", approvedAlways: [], deniedAlways: [] })).status,
      ).toBe("unknown")
      expect(methods).toEqual(["GET"])
    } finally {
      await server.stop(true)
    }
  })
})
