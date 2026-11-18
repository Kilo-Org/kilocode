import { describe, expect, test } from "bun:test"
import { Config } from "@opencode/core/config"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Effect, Exit, Scope } from "effect"
import { KiloSettingsPlugin } from "../src/settings"

// The read half of `kilocode.settings` applies the same scope guard as the write half. A config file that resolves
// outside its root — a symlinked `kilo2.json` in the global directory, for example — is refused instead of read.

const configRoot = "/tmp/kilo-settings-read/global"
const projectRoot = "/tmp/kilo-settings-read/project"
const outside = "/tmp/kilo-settings-read/outside/kilo2.json"

/** A filesystem where the global config file is a symlink whose target sits outside the global directory. */
const filesystem = {
  resolve: (file: string) => Effect.succeed(file === `${configRoot}/kilo2.json` ? outside : file),
  isFile: (file: string) => Effect.succeed(file === `${configRoot}/kilo2.json`),
  existsSafe: () => Effect.succeed(false),
  readFileString: (file: string) => Effect.succeed(file === outside ? `{ "shell": "zsh" }` : "{}"),
} as unknown as FSUtil.Interface

type Call = (
  input: { scope: "global" | "project" },
  context: { error: (type: string, message: string, data: Record<string, unknown>) => unknown },
) => Effect.Effect<{ target: { path: string }; document: unknown }, unknown>

type Handlers = { target: Call; read: Call }

/** The RPC context a handler fails through; the tests only read its message. */
const rpcContext = {
  error: (type: string, message: string, data: Record<string, unknown>) => ({ ...data, type, message }),
}

async function boot() {
  const handlers = {} as Handlers
  const ctx = {
    location: { directory: projectRoot, project: { directory: projectRoot } },
    rpc: {
      register: (_definition: unknown, registered: Handlers) =>
        Effect.sync(() => {
          Object.assign(handlers, registered)
          return { events: { emit: () => Effect.void }, dispose: Effect.void }
        }),
    },
  }
  const config = { entries: () => Effect.succeed([]) } as unknown as Config.Interface
  const scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(
    KiloSettingsPlugin.effect(ctx as never).pipe(
      Effect.provideService(Scope.Scope, scope),
      Effect.provideService(Config.Service, config),
      Effect.provideService(FSUtil.Service, filesystem),
      Effect.provideService(Global.Service, Global.Service.of(Global.make({ config: configRoot }))),
    ),
  )
  return { handlers, close: () => Effect.runPromise(Scope.close(scope, Exit.void)) }
}

describe("kilocode.settings scope guard", () => {
  test("read refuses a document that resolves outside the global config scope", async () => {
    const plugin = await boot()
    try {
      const result = await Effect.runPromise(Effect.result(plugin.handlers.read({ scope: "global" }, rpcContext)))
      expect(result._tag).toBe("Failure")
      expect(JSON.stringify(result)).not.toContain("zsh")
      expect(JSON.stringify(result)).toContain("outside the global config scope")
    } finally {
      await plugin.close()
    }
  })

  test("target refuses the same out-of-scope document", async () => {
    const plugin = await boot()
    try {
      const result = await Effect.runPromise(Effect.result(plugin.handlers.target({ scope: "global" }, rpcContext)))
      expect(result._tag).toBe("Failure")
      expect(JSON.stringify(result)).toContain("outside the global config scope")
    } finally {
      await plugin.close()
    }
  })

  test("read inside the scope still answers with the document", async () => {
    const plugin = await boot()
    try {
      const result = await Effect.runPromise(Effect.result(plugin.handlers.read({ scope: "project" }, rpcContext)))
      expect(result._tag).toBe("Success")
      expect(JSON.stringify(result)).toContain("document")
    } finally {
      await plugin.close()
    }
  })
})
