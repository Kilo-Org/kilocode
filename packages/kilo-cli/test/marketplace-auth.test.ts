import { expect, spyOn, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { Effect } from "effect"
import { reportInstall } from "../src/marketplace/handlers/install"

const record: KiloMarketplaceRpc.Installed = {
  kind: "mcp",
  id: "catalog/unsanitized-id",
  registry: "kilo",
  scope: "global",
  paths: [],
  config: "/server/config/kilo.json",
  server: "catalog-sanitized-server",
  installedAt: 1,
}
const location = { directory: "/server/project" }
const document = (
  path = record.config,
  servers = { [record.server!]: { type: "remote", url: "https://fixture.invalid" } },
) => ({
  type: "document",
  path,
  info: { mcp: { servers } },
})

async function fixture(
  respond: (path: string, count: number) => Response | Promise<Response>,
  installed = record,
  timeout?: number,
) {
  const output: string[] = []
  const calls: string[] = []
  const counts = new Map<string, number>()
  const stdout = spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output.push(String(chunk))
    return true
  })
  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch: (request) => {
      const url = new URL(request.url)
      // Status requests must occur after the successful installation has already been printed.
      expect(output[0]).toStartWith("Installed ")
      expect(request.method).toBe("GET")
      expect(url.searchParams.get("location[directory]")).toBe(location.directory)
      expect(["/api/config", "/api/mcp"]).toContain(url.pathname)
      calls.push(url.pathname)
      counts.set(url.pathname, (counts.get(url.pathname) ?? 0) + 1)
      return respond(url.pathname, counts.get(url.pathname)!)
    },
  })
  const client = OpenCode.make({ baseUrl: server.url.origin })
  const start = performance.now()
  try {
    await Effect.runPromise(
      reportInstall(
        { client, rpc: client.rpc(KiloMarketplaceRpc.Definition), options: { location }, location },
        installed,
        timeout,
      ),
    )
    return { output: output.join(""), calls, elapsed: performance.now() - start }
  } finally {
    stdout.mockRestore()
  }
}

test("waits for config discovery, absent server and pending before offering auth for the exact returned key", async () => {
  const result = await fixture((path, count) => {
    if (path === "/api/config") return Response.json(count === 1 ? [] : [document()])
    return Response.json({
      data:
        count === 1
          ? []
          : [{ name: record.server, status: { status: count === 2 ? "pending" : "needs_auth", error: "Sign in" } }],
    })
  })
  expect(result.calls.filter((path) => path === "/api/config")).toHaveLength(4)
  expect(result.calls.filter((path) => path === "/api/mcp")).toHaveLength(3)
  expect(result.output).toContain("sign-in required; installation retained")
  expect(result.output).toContain("Run: kilo mcp auth 'catalog-sanitized-server'")
  expect(result.output).not.toContain("kilo mcp auth 'catalog/unsanitized-id'")
  expect(result.output).toContain("same server, project directory (/server/project), and profile")
  expect(result.output).toContain("KILO_V2_PROFILE")
  expect(result.output).toContain("native mcp auth has no --server flag")
  expect(result.output).toContain("callback forwarding")
})

test.each(["connected", "disabled", "failed"] as const)(
  "reports native %s without classifying it as auth",
  async (status) => {
    const result = await fixture((path) =>
      Response.json(
        path === "/api/config"
          ? [document()]
          : {
              data: [
                {
                  name: record.server,
                  integrationID: "integration-anonymous",
                  status: { status, error: "Transport failed, not needs_auth" },
                },
              ],
            },
      ),
    )
    expect(result.output).toContain(status === "failed" ? "connection failed: Transport failed" : `: ${status}`)
    expect(result.output).not.toContain("Run: kilo mcp auth")
    expect(result.calls).toEqual(["/api/config", "/api/mcp"])
  },
)

test("highest-precedence owning document shadows a global install, without checking the unrelated server's auth", async () => {
  const result = await fixture(() =>
    Response.json([
      document(),
      { type: "directory", path: "/server/project/.kilo2" },
      document("/server/project/kilo.json"),
    ]),
  )
  expect(result.output).toContain("overridden in this project")
  expect(result.output).not.toContain("sign-in required")
  expect(result.output).not.toContain("Run: kilo mcp auth")
  expect(result.calls).toEqual(["/api/config"])
})

test("ignores higher-precedence documents that do not own the installed key", async () => {
  const result = await fixture((path) =>
    Response.json(
      path === "/api/config"
        ? [document("/server/low-priority.json"), document(), document("/server/project/kilo.json", {})]
        : { data: [{ name: record.server, status: { status: "needs_auth", error: "Sign in" } }] },
    ),
  )
  expect(result.output).toContain("Run: kilo mcp auth 'catalog-sanitized-server'")
  expect(result.output).not.toContain("overridden")
})

test("does not authenticate when an owning discovery document has no verifiable path", async () => {
  const result = await fixture(() => Response.json([document(), { ...document(), path: undefined }]))
  expect(result.output).toContain("overridden in this project")
  expect(result.calls).toEqual(["/api/config"])
})

test.each(["config", "absent", "pending", "wrong-key"])(
  "bounds %s discovery and leaves installation successful",
  async (state) => {
    const result = await fixture(
      (path) =>
        Response.json(
          path === "/api/config"
            ? state === "config"
              ? []
              : [document()]
            : {
                data:
                  state === "absent"
                    ? []
                    : [{ name: state === "wrong-key" ? record.id : record.server, status: { status: "pending" } }],
              },
        ),
      record,
      600,
    )
    expect(result.output).toContain("status not ready; installation retained")
    expect(result.output).not.toContain("Run: kilo mcp auth")
    expect(result.elapsed).toBeLessThan(1_500)
    expect(result.calls.length).toBeGreaterThan(1)
  },
)

test.each(["/api/config", "/api/mcp"])("aborts slow %s requests within the readiness budget", async (slow) => {
  const result = await fixture(
    async (path) => {
      if (path === slow) await Bun.sleep(1_000)
      return Response.json(path === "/api/config" ? [document()] : { data: [] })
    },
    record,
    100,
  )
  expect(result.elapsed).toBeLessThan(800)
  expect(result.output).toContain("Installed mcp")
  expect(result.output).toContain("MCP status unavailable; installation retained")
  expect(result.output).not.toContain("Run: kilo mcp auth")
  expect(result.calls).toContain(slow)
})

test("the production default bounds an unresponsive API request to 15 seconds", async () => {
  const result = await fixture(() => new Promise<Response>(() => {}))
  expect(result.elapsed).toBeGreaterThanOrEqual(14_500)
  expect(result.elapsed).toBeLessThan(18_000)
  expect(result.output).toContain("MCP status unavailable; installation retained")
  expect(result.calls).toEqual(["/api/config"])
}, 25_000)

test.each(["http-error", "invalid-config", "invalid-mcp"])(
  "status %s cannot fail a successful install",
  async (state) => {
    const result = await fixture((path) => {
      if (state === "http-error") return new Response("private transport details", { status: 503 })
      if (path === "/api/config") return Response.json(state === "invalid-config" ? {} : [document()])
      return Response.json({ data: {} })
    })
    expect(result.output).toContain("Installed mcp")
    expect(result.output).toContain("MCP status unavailable; installation retained")
    expect(result.output).not.toContain("private transport details")
  },
)

test("shell-quotes the exact server key in recovery instructions", async () => {
  const installed = { ...record, server: "server's name; $(unsafe)" }
  const result = await fixture(
    (path) =>
      Response.json(
        path === "/api/config"
          ? [document(record.config, { [installed.server]: { type: "remote", url: "https://fixture.invalid" } })]
          : { data: [{ name: installed.server, status: { status: "needs_auth", error: "Sign in" } }] },
      ),
    installed,
  )
  expect(result.output).toContain("Run: kilo mcp auth 'server'\\''s name; $(unsafe)'")
})

test.each(["server", "config"] as const)("missing %s identity defers auth without requests", async (key) => {
  const result = await fixture(() => new Response(null, { status: 500 }), { ...record, [key]: undefined })
  expect(result.output).toContain("MCP status not verified")
  expect(result.calls).toEqual([])
})

test("skill installs retain existing output and make no native status requests", async () => {
  const result = await fixture(() => new Response(null, { status: 500 }), {
    ...record,
    kind: "skill",
    server: undefined,
    config: undefined,
    paths: ["/server/skills/demo"],
  })
  expect(result.output).toBe("Installed skill catalog/unsanitized-id from kilo (global)\n  /server/skills/demo\n")
  expect(result.calls).toEqual([])
})
