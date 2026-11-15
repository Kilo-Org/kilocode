// kilocode_change - new file
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { describe, expect, spyOn } from "bun:test"
import path from "path"
import { Effect, FileSystem, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { NodeFileSystem } from "@effect/platform-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Instruction } from "../../src/session/instruction"
import { Global } from "@opencode-ai/core/global"
import { TestConfig } from "../fixture/config"
import { provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Config } from "../../src/config/config"
import * as Log from "@opencode-ai/core/util/log"

const it = testEffect(
  Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), NodeFileSystem.layer, RuntimeFlags.layer(), testInstanceStoreLayer),
)

const configLayer = TestConfig.layer()

const instructionLayer = (global: Partial<Global.Interface>) =>
  AppNodeBuilder.build(Instruction.node, [
    [Config.node, configLayer],
    [Global.node, Global.layerWith(global)],
  ])

const provideInstruction =
  (global: Partial<Global.Interface>) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(Effect.provide(instructionLayer(global)))

const write = (filepath: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(path.dirname(filepath), { recursive: true })
    yield* fs.writeFileString(filepath, content)
  })

const writeFiles = (dir: string, files: Record<string, string>) =>
  Effect.all(
    Object.entries(files).map(([file, content]) => write(path.join(dir, file), content)),
    { discard: true },
  )

const tmpWithFiles = (files: Record<string, string>) =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    yield* writeFiles(dir, files)
    return dir
  })

const withConfigDir =
  (value: string | undefined) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const original = process.env["KILO_CONFIG_DIR"]
      if (value === undefined) delete process.env["KILO_CONFIG_DIR"]
      else process.env["KILO_CONFIG_DIR"] = value
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (original === undefined) delete process.env["KILO_CONFIG_DIR"]
          else process.env["KILO_CONFIG_DIR"] = original
        }),
      )
      return yield* self
    })

describe("Instruction.systemPaths KILO_CONFIG_DIR profile fallback", () => {
  it.live("prefers KILO_CONFIG_DIR AGENTS.md over global when both exist", () =>
    Effect.gen(function* () {
      const profileTmp = yield* tmpWithFiles({ "AGENTS.md": "# Profile Instructions" })
      const globalTmp = yield* tmpWithFiles({ "AGENTS.md": "# Global Instructions" })
      const projectTmp = yield* tmpdirScoped()

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(profileTmp, "AGENTS.md"))).toBe(true)
        expect(paths.has(path.join(globalTmp, "AGENTS.md"))).toBe(false)
      }).pipe(
        provideInstance(projectTmp),
        provideInstruction({ home: globalTmp, config: globalTmp }),
        withConfigDir(profileTmp),
      )
    }),
  )

  it.live("falls back to global AGENTS.md when KILO_CONFIG_DIR has no AGENTS.md", () =>
    Effect.gen(function* () {
      const profileTmp = yield* tmpdirScoped()
      const globalTmp = yield* tmpWithFiles({ "AGENTS.md": "# Global Instructions" })
      const projectTmp = yield* tmpdirScoped()

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(profileTmp, "AGENTS.md"))).toBe(false)
        expect(paths.has(path.join(globalTmp, "AGENTS.md"))).toBe(true)
      }).pipe(
        provideInstance(projectTmp),
        provideInstruction({ home: globalTmp, config: globalTmp }),
        withConfigDir(profileTmp),
      )
    }),
  )

  it.live("uses global AGENTS.md when KILO_CONFIG_DIR is not set", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpWithFiles({ "AGENTS.md": "# Global Instructions" })
      const projectTmp = yield* tmpdirScoped()

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(globalTmp, "AGENTS.md"))).toBe(true)
      }).pipe(
        provideInstance(projectTmp),
        provideInstruction({ home: globalTmp, config: globalTmp }),
        withConfigDir(undefined),
      )
    }),
  )
})

const withInstructions = (
  global: Partial<Global.Interface>,
  instructions: string[],
  origins: Record<string, { trusted: boolean; source: string }>,
) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.provide(
        AppNodeBuilder.build(Instruction.node, [
          [Config.node, TestConfig.layer({ get: () => Effect.succeed({ instructions, instruction_origins: origins }) })],
          [Global.node, Global.layerWith(global)],
        ]),
      ),
    )

const warnings = () => {
  const spy = spyOn(Log.create({ service: "instruction" }), "warn").mockImplementation(() => {})
  return {
    spy,
    calls: (): Record<string, unknown>[] => spy.mock.calls.map((call) => ({ message: call[0], ...call[1] })),
  }
}

describe("Instruction same-basename files", () => {
  it.live("loads two MEMORY.md files at different paths", () =>
    Effect.gen(function* () {
      const home = yield* tmpWithFiles({ ".agents/memory/MEMORY.md": "global memory" })
      const project = yield* tmpWithFiles({ ".agents/memory/MEMORY.md": "project memory" })
      const globalFile = path.join(home, ".agents/memory/MEMORY.md")
      const projectFile = path.join(project, ".agents/memory/MEMORY.md")

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        expect(yield* svc.system()).toStrictEqual([
          `Instructions from: ${globalFile}\nglobal memory`,
          `Instructions from: ${projectFile}\nproject memory`,
        ])
      }).pipe(
        provideInstance(project),
        withInstructions(
          { home, config: home },
          ["~/.agents/memory/MEMORY.md", ".agents/memory/MEMORY.md"],
          {
            "~/.agents/memory/MEMORY.md": { trusted: true, source: "global" },
            ".agents/memory/MEMORY.md": { trusted: false, source: "project" },
          },
        ),
        withConfigDir(undefined),
      )
    }),
  )
})

describe("Instruction skipped file warnings", () => {
  it.live("warns when a project entry points outside the project root", () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const outside = yield* tmpWithFiles({ "MEMORY.md": "outside memory" })
      const project = yield* tmpdirScoped()
      const file = path.join(outside, "MEMORY.md")
      const logged = warnings()
      yield* Effect.addFinalizer(() => Effect.sync(() => logged.spy.mockRestore()))

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        expect(yield* svc.system()).toStrictEqual([])
      }).pipe(
        provideInstance(project),
        withInstructions({ home, config: home }, [file], { [file]: { trusted: false, source: "project" } }),
        withConfigDir(undefined),
      )

      expect(logged.calls().filter((item) => item.path === file)).toStrictEqual([
        {
          message: "instruction file skipped",
          path: file,
          reason: "blocked: outside project config scope",
          detail: expect.stringContaining("blocked file reference outside project config scope"),
        },
      ])
    }),
  )

  it.live("warns when a configured entry matches no file", () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const project = yield* tmpdirScoped()
      const entry = path.join(project, "missing", "NOPE.md")
      const logged = warnings()
      yield* Effect.addFinalizer(() => Effect.sync(() => logged.spy.mockRestore()))

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        expect(yield* svc.system()).toStrictEqual([])
      }).pipe(
        provideInstance(project),
        withInstructions({ home, config: home }, [entry], { [entry]: { trusted: true, source: "global" } }),
        withConfigDir(undefined),
      )

      expect(logged.calls().filter((item) => item.directory === project)).toStrictEqual([
        {
          message: "instruction file skipped",
          source: "global",
          entry: expect.stringMatching(/^sha256:[0-9a-f]{8}$/),
          directory: project,
          reason: "no matching file",
        },
      ])
    }),
  )

  it.live("does not log the value of an unmatched entry", () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const project = yield* tmpdirScoped()
      const secret = "sk-test-SECRET-value-1234567890"
      const logged = warnings()
      yield* Effect.addFinalizer(() => Effect.sync(() => logged.spy.mockRestore()))

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        expect(yield* svc.system()).toStrictEqual([])
      }).pipe(
        provideInstance(project),
        withInstructions({ home, config: home }, [secret], { [secret]: { trusted: false, source: "project" } }),
        withConfigDir(undefined),
      )

      expect(logged.calls().length).toBe(1)
      expect(JSON.stringify(logged.calls())).not.toContain(secret)
    }),
  )

  it.live("warns once per project for the same relative entry", () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const first = yield* tmpdirScoped()
      const second = yield* tmpdirScoped()
      const entry = "rules-unmatched-per-project/*.md"
      const logged = warnings()
      yield* Effect.addFinalizer(() => Effect.sync(() => logged.spy.mockRestore()))

      for (const project of [first, second, first]) {
        yield* Effect.gen(function* () {
          const svc = yield* Instruction.Service
          yield* svc.system()
        }).pipe(
          provideInstance(project),
          withInstructions({ home, config: home }, [entry], { [entry]: { trusted: false, source: "project" } }),
          withConfigDir(undefined),
        )
      }

      expect(logged.calls().map((item) => item.directory)).toStrictEqual([first, second])
    }),
  )

  it.live("reports the blocked file reference inside an instruction file without leaking its contents", () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const outside = yield* tmpWithFiles({ ".env": "API_KEY=sk-leak-me" })
      const project = yield* tmpWithFiles({ "rules.md": `use {file:${path.join(outside, ".env")}}` })
      const file = path.join(project, "rules.md")
      const logged = warnings()
      yield* Effect.addFinalizer(() => Effect.sync(() => logged.spy.mockRestore()))

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        expect(yield* svc.system()).toStrictEqual([])
      }).pipe(
        provideInstance(project),
        withInstructions({ home, config: home }, [file], { [file]: { trusted: false, source: "project" } }),
        withConfigDir(undefined),
      )

      const calls = logged.calls().filter((item) => item.path === file)
      expect(calls).toStrictEqual([
        {
          message: "instruction file skipped",
          path: file,
          reason: "blocked: outside project config scope",
          detail: expect.stringContaining("blocked file reference outside project config scope"),
        },
      ])
      expect(JSON.stringify(calls)).not.toContain("sk-leak-me")
    }),
  )
})
