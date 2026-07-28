import { describe, expect } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { run, type Profile } from "@kilocode/sandbox"
import * as Network from "@/kilocode/sandbox/network"
import { it } from "../../lib/effect"

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

describe("model network boundaries", () => {
  it.effect("rejects MCP delegated authority without invoking it in deny mode", () =>
    Effect.gen(function* () {
      let called = false
      const exit = yield* Effect.exit(
        run(
          profile("deny"),
          Network.mcp(
            Network.remote({}),
            Effect.sync(() => {
              called = true
            }),
          ),
        ),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.pretty(exit.cause)).toContain("Sandbox denied outbound network access")
        expect(Cause.pretty(exit.cause)).toContain("remote MCP delegated authority")
      }
      expect(called).toBe(false)
    }),
  )

  it.effect("allows MCP delegated authority in allow mode", () =>
    Effect.gen(function* () {
      let called = false
      yield* run(
        profile("allow"),
        Network.mcp(
          Network.remote({}),
          Effect.sync(() => {
            called = true
          }),
        ),
      )
      expect(called).toBe(true)
    }),
  )

  it.effect("rejects local MCP delegated authority in deny mode", () =>
    Effect.gen(function* () {
      let called = false
      const exit = yield* Effect.exit(
        run(
          profile("deny"),
          Network.mcp(
            {},
            Effect.sync(() => {
              called = true
            }),
          ),
        ),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("local MCP delegated authority")
      expect(called).toBe(false)
    }),
  )

  it.effect("keeps classified non-network built-in tools available in deny mode", () =>
    Effect.gen(function* () {
      let called = false
      yield* run(
        profile("deny"),
        Network.tool(
          Network.builtin({ id: "read" }),
          Effect.sync(() => {
            called = true
          }),
        ),
      )
      expect(called).toBe(true)
    }),
  )

  it.effect("fails closed before opaque network helper tools run", () =>
    Effect.gen(function* () {
      let called = false
      const exit = yield* Effect.exit(
        run(
          profile("deny"),
          Network.tool(
            Network.builtin({ id: "codebase_search" }),
            Effect.sync(() => {
              called = true
            }),
          ),
        ),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      expect(called).toBe(false)
    }),
  )

  for (const id of ["interactive_terminal", "notebook_execute", "background_process"]) {
    for (const mode of ["allow", "deny"] as const) {
      it.effect(`fails closed before ${id} can execute outside the ${mode} sandbox`, () =>
        Effect.gen(function* () {
          let called = false
          const exit = yield* Effect.exit(
            run(
              profile(mode),
              Network.tool(
                Network.builtin({ id }),
                Effect.sync(() => {
                  called = true
                }),
              ),
            ),
          )
          expect(Exit.isFailure(exit)).toBe(true)
          expect(called).toBe(false)
        }),
      )
    }
  }

  it.live("fails closed before custom tool network code runs", () => {
    let requests = 0
    return Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: () => {
            requests++
            return new Response("unexpected")
          },
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const exit = yield* Effect.exit(
            run(
              profile("deny"),
              Network.tool(
                { id: "custom_network_tool" },
                Effect.promise(() => fetch(server.url)),
              ),
            ),
          )
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("custom tool:custom_network_tool")
          expect(requests).toBe(0)
        }),
      (server) => Effect.promise(() => server.stop(true)),
    )
  })
})
