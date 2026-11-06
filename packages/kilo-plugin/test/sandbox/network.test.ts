import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { run, type Profile } from "@kilocode/sandbox"
import * as Network from "../../src/sandbox/network"

function profile(mode: Profile["network"]["mode"]): Profile {
  return {
    filesystem: {
      allowWrite: [{ path: process.cwd(), kind: "subtree" }],
      denyWrite: [],
      denyNames: [".git"],
    },
    network: { mode, allowedHosts: [] },
    environment: { deny: [], set: {} },
  }
}

function denied(exit: Exit.Exit<unknown, unknown>) {
  if (Exit.isFailure(exit)) return Cause.pretty(exit.cause)
  return ""
}

describe("sandbox tool network classification", () => {
  // kilo_port(sandbox:fd6329a01ac1)
  test("treats a namespaced tool as MCP unless it is a built-in in the opencode namespace", () => {
    const tool = (name: string, namespace?: string) => ({ name, options: namespace ? { namespace } : undefined })
    expect(Network.isMcp(tool("session_move", "session"))).toBe(true)
    expect(Network.isMcp(tool("touch", "probe"))).toBe(true)
    expect(Network.isMcp(tool("custom", "opencode"))).toBe(true)
    expect(Network.isMcp(tool("artifact_create", "opencode"))).toBe(false)
    expect(Network.isMcp(tool("list_mcp_resources", "opencode"))).toBe(false)
    expect(Network.isMcp(tool("session_move"))).toBe(false)
  })

  test("reads the MCP mark from a registry entry whose namespace and name match a built-in", () => {
    // The registry entry of a `read` tool from an MCP server named `opencode` (see core test/kilocode/mcp-provenance).
    const read = { id: "opencode_read", name: "read", options: { namespace: "opencode", codemode: true, mcp: true } } as const
    expect(Network.isMcp(read)).toBe(true)
    expect(Network.isMcp({ ...read, options: { namespace: "opencode", codemode: true } })).toBe(false)
  })

  test("recognizes the built-in tools and treats every other id as custom", () => {
    expect(Network.isBuiltin("read")).toBe(true)
    expect(Network.isBuiltin("webfetch")).toBe(true)
    expect(Network.isBuiltin("background_process")).toBe(true)
    expect(Network.isBuiltin("custom_network_tool")).toBe(false)
    expect(Network.isBuiltin("mcp__weather__current")).toBe(false)
  })

  test("keeps classified non-network built-in tools available in deny mode", async () => {
    let called = false
    await Effect.runPromise(
      run(
        profile("deny"),
        Network.tool({ id: "read" }, Effect.sync(() => void (called = true))),
      ),
    )
    expect(called).toBe(true)
  })

  test("runs an opencode-namespaced built-in under the sandbox profile in deny mode", async () => {
    let called = false
    await Effect.runPromise(
      run(
        profile("deny"),
        Network.tool(
          { id: "opencode_artifact_create", name: "artifact_create" },
          Effect.sync(() => void (called = true)),
        ),
      ),
    )
    expect(called).toBe(true)
  })

  test("fails closed before opaque network helper tools run", async () => {
    for (const id of ["semantic_search", "lsp", "list_mcp_resources", "read_mcp_resource"]) {
      let called = false
      const exit = await Effect.runPromise(
        run(profile("deny"), Network.tool({ id }, Effect.sync(() => void (called = true)))).pipe(Effect.exit),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      expect(called).toBe(false)
    }
  })

  // kilo_port(sandbox:d1999e0669a5) kilo_port(sandbox:859933ff55db)
  test("rejects MCP delegated authority without invoking it in deny mode", async () => {
    let called = false
    const exit = await Effect.runPromise(
      run(
        profile("deny"),
        Network.tool({ id: "mcp__weather__current", mcp: true }, Effect.sync(() => void (called = true))),
      ).pipe(Effect.exit),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(denied(exit)).toContain("Sandbox denied outbound network access")
    expect(denied(exit)).toContain("MCP delegated authority")
    expect(called).toBe(false)
  })

  test("allows MCP delegated authority in allow mode", async () => {
    let called = false
    await Effect.runPromise(
      run(
        profile("allow"),
        Network.tool({ id: "mcp__weather__current", mcp: true }, Effect.sync(() => void (called = true))),
      ),
    )
    expect(called).toBe(true)
  })

  for (const id of ["notebook_execute", "background_process"]) {
    for (const mode of ["allow", "deny"] as const) {
      test(`fails closed before ${id} can execute outside the ${mode} sandbox`, async () => {
        let called = false
        const exit = await Effect.runPromise(
          run(profile(mode), Network.tool({ id }, Effect.sync(() => void (called = true)))).pipe(Effect.exit),
        )
        expect(Exit.isFailure(exit)).toBe(true)
        expect(denied(exit)).toContain("execution outside its process boundary")
        expect(called).toBe(false)
      })
    }
  }

  test("fails closed before custom tool network code runs", async () => {
    let requests = 0
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        requests++
        return new Response("unexpected")
      },
    })
    try {
      const exit = await Effect.runPromise(
        run(
          profile("deny"),
          Network.tool({ id: "custom_network_tool" }, Effect.promise(() => fetch(server.url))),
        ).pipe(Effect.exit),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      expect(denied(exit)).toContain("custom tool:custom_network_tool")
      expect(requests).toBe(0)
    } finally {
      await server.stop(true)
    }
  })
})
