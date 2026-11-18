import { describe, expect, test } from "bun:test"
import { Config } from "@opencode/core/config"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Effect, Exit, Scope } from "effect"
import os from "node:os"
import path from "node:path"
import { KiloSettingsPlugin, within } from "../src/settings"

// The read half of `kilocode.settings` applies the same scope guard as the write half. A config file that resolves
// outside its root — a symlinked `kilo2.json` in the global directory, for example — is refused instead of read.
//
// Paths are built with `path.join`, not spelled with slashes: the writer joins its target the same way, and on win32
// that is a backslash path, so a hand-written `/tmp/...` string would never equal the file the plugin asks about.

const root = path.join(os.tmpdir(), "kilo-settings-read")
const configRoot = path.join(root, "global")
const projectRoot = path.join(root, "project")
const configFile = path.join(configRoot, "kilo2.json")
const outside = path.join(root, "outside", "kilo2.json")

/** Same file, whatever spelling the caller used: the mock sees what the writer built, not a fixed string. */
const same = (a: string, b: string) => path.resolve(a) === path.resolve(b)

/** A filesystem where the global config file is a symlink whose target sits outside the global directory. */
const filesystem = {
  resolve: (file: string) => Effect.succeed(same(file, configFile) ? outside : file),
  isFile: (file: string) => Effect.succeed(same(file, configFile)),
  existsSafe: () => Effect.succeed(false),
  readFileString: (file: string) => Effect.succeed(same(file, outside) ? `{ "shell": "zsh" }` : "{}"),
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

describe("scope containment", () => {
  test("win32: a child is inside, a sibling and an escape are not", () => {
    const global = "C:\\Users\\igor\\AppData\\Roaming\\kilo"
    expect(within(global, "C:\\Users\\igor\\AppData\\Roaming\\kilo\\kilo2.json", path.win32)).toBe(true)
    expect(within(global, global, path.win32)).toBe(true)
    expect(within(global, "C:\\Users\\igor\\AppData\\Roaming\\kilo2\\kilo2.json", path.win32)).toBe(false)
    expect(within(global, "C:\\Users\\igor\\AppData\\Roaming\\kilo\\..\\outside\\kilo2.json", path.win32)).toBe(false)
    expect(within(global, "C:\\Users\\igor\\AppData\\Roaming\\kilo\\..foo\\kilo2.json", path.win32)).toBe(true)
  })

  test("win32: case and drive letter decide the way the filesystem does", () => {
    // `fs.resolve` realpaths both sides but keeps the caller's casing when it matches, so case must fold here.
    expect(within("C:\\Kilo", "c:\\kilo\\kilo2.json", path.win32)).toBe(true)
    expect(within("c:\\kilo", "C:\\KILO\\kilo2.json", path.win32)).toBe(true)
    expect(within("C:\\kilo", "D:\\kilo\\kilo2.json", path.win32)).toBe(false)
  })

  test("posix: separators and case are exact", () => {
    expect(within("/home/igor/.config/kilo", "/home/igor/.config/kilo/kilo2.json")).toBe(true)
    expect(within("/home/igor/.config/kilo", "/home/igor/.config/kilo2/kilo2.json")).toBe(false)
    expect(within("/home/igor/.config/kilo", "/home/igor/.config/kilo/../outside/kilo2.json")).toBe(false)
    // No folding on posix: these are different directories.
    expect(within("/Kilo", "/kilo/kilo2.json")).toBe(false)
    expect(within("/Kilo", "/Kilo/kilo2.json")).toBe(true)
  })
})
