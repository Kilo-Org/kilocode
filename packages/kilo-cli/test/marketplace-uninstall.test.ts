import { expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { Effect, Option } from "effect"
import { UserError } from "../src/error"
import { selectUninstall, uninstall } from "../src/marketplace/handlers/uninstall"

const input = {
  kind: "skill" as const,
  id: "theme-factory",
  project: false,
  global: false,
  registry: Option.none<string>(),
}
const project: KiloMarketplaceRpc.Installed = {
  kind: "skill",
  id: "theme-factory",
  registry: "kilo",
  scope: "project",
  project: "/project",
  paths: ["/project/.kilo2/skills/theme-factory"],
  installedAt: 1,
}
const global: KiloMarketplaceRpc.Installed = { ...project, scope: "global", project: undefined }

test("infers the only installed scope without a flag", () => {
  expect(selectUninstall([project], input)).toBe(project)
  expect(selectUninstall([global], input)).toBe(global)
})

test("does not guess when the item is installed in both scopes", () => {
  expect(() => selectUninstall([project, global], input)).toThrow("pass --project or --global")
  expect(selectUninstall([project, global], { ...input, project: true })).toBe(project)
  expect(selectUninstall([project, global], { ...input, global: true })).toBe(global)
})

test("explicit scope flags never fall back to another scope", () => {
  expect(() => selectUninstall([project], { ...input, global: true })).toThrow("rerun with --project")
  expect(() => selectUninstall([global], { ...input, project: true })).toThrow("rerun with --global")
  expect(() => selectUninstall([project], { ...input, project: true, global: true })).toThrow("Pass only one")
})

test("filters the requested item and registry before inferring scope", () => {
  const other = { ...global, registry: "other" }
  expect(() => selectUninstall([project, other], input)).toThrow("pass --project or --global")
  expect(selectUninstall([project, other], { ...input, registry: Option.some("kilo") })).toBe(project)
  expect(selectUninstall([project, { ...global, id: "other" }, { ...global, kind: "mcp" }], input)).toBe(project)
  expect(() => selectUninstall([project, { ...project, registry: "other" }], input)).toThrow("pass --registry")
})

test("missing installations produce expected user errors", () => {
  expect(() => selectUninstall([], input)).toThrow("not installed from a marketplace")
  expect(() => selectUninstall([], input)).toThrow(UserError)
})

test.each([true, false])(
  "only removes captured credentials after successful uninstall (success=%s)",
  async (success) => {
    const calls: string[] = []
    using server = Bun.serve({
      port: 0,
      fetch: (request) => {
        const pathname = new URL(request.url).pathname
        calls.push(`${request.method} ${pathname}`)
        if (pathname === "/api/mcp")
          return Response.json({ data: [{ name: "demo", integrationID: "integration-demo" }] })
        if (pathname === "/api/integration/integration-demo")
          return Response.json({
            data: {
              connections: [
                { type: "credential", id: "credential-demo" },
                { type: "environment", id: "env-demo" },
              ],
            },
          })
        if (pathname === "/api/rpc/kilocode.marketplace/uninstall")
          return success
            ? Response.json({ output: {} })
            : Response.json(
                { _tag: "RpcError", type: "invalid_params", message: "Fix the config first" },
                { status: 400 },
              )
        if (pathname === "/api/credential/credential-demo") return new Response(null, { status: 204 })
        return new Response("Unexpected request", { status: 500 })
      },
    })
    const client = OpenCode.make({ baseUrl: server.url.origin })
    const location = { directory: "/project" }
    const result = Effect.runPromise(
      uninstall(
        { client, rpc: client.rpc(KiloMarketplaceRpc.Definition), options: { location }, location },
        { ...project, kind: "mcp", server: "demo" },
      ),
    )
    if (success) await result
    if (!success) await expect(result).rejects.toThrow("Fix the config first")
    expect(calls).toEqual([
      "GET /api/mcp",
      "GET /api/integration/integration-demo",
      "POST /api/rpc/kilocode.marketplace/uninstall",
      ...(success ? ["DELETE /api/credential/credential-demo"] : []),
    ])
  },
)
