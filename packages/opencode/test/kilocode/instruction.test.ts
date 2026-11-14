// kilocode_change - new file
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { describe, expect } from "bun:test"
import path from "path"
import { Effect, FileSystem, Layer, Logger } from "effect"
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

describe("Instruction config instructions entries", () => {
  const capture = () => {
    const logs: string[] = []
    const logger = Logger.make(({ message }) => {
      logs.push(String(message))
    })
    return { logs, layer: Logger.layer([logger], { mergeWithExisting: false }) }
  }

  const run = (
    instructions: string[],
    origins: Record<string, { trusted: boolean; source: string; root?: string }>,
    project: string,
    home: string,
    logs: string[],
    logLayer: Layer.Layer<Logger.CurrentLoggers>,
  ) =>
    Effect.gen(function* () {
      const svc = yield* Instruction.Service
      const paths = yield* svc.systemPaths()
      const sys = yield* svc.system()
      return { paths, joined: sys.join("\n"), logs }
    }).pipe(
      provideInstance(project),
      Effect.provide(
        AppNodeBuilder.build(Instruction.node, [
          [
            Config.node,
            TestConfig.layer({
              get: () => Effect.succeed({ instructions, instruction_origins: origins }),
            }),
          ],
          [Global.node, Global.layerWith({ home, config: home })],
        ]),
      ),
      Effect.provide(logLayer),
    )

  it.live("loads both entries when two files share a basename", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpdirScoped()
      const projectTmp = yield* tmpdirScoped()
      const home = yield* tmpdirScoped()
      const globalMem = path.join(globalTmp, ".agents", "memory", "MEMORY.md")
      const projectMem = path.join(projectTmp, "memory", "MEMORY.md")
      yield* write(globalMem, "GLOBAL MEMORY BODY")
      yield* write(projectMem, "PROJECT MEMORY BODY")
      const cap = capture()

      const out = yield* run(
        [globalMem, projectMem],
        {
          [globalMem]: { trusted: true, source: globalMem },
          [projectMem]: { trusted: false, source: projectMem, root: projectTmp },
        },
        projectTmp,
        home,
        cap.logs,
        cap.layer,
      )
      expect(out.paths.has(globalMem)).toBe(true)
      expect(out.paths.has(projectMem)).toBe(true)
      expect(out.joined).toContain("GLOBAL MEMORY BODY")
      expect(out.joined).toContain("PROJECT MEMORY BODY")
    }),
  )

  it.live("warns when a discovered instruction file cannot be read", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpdirScoped()
      const projectTmp = yield* tmpdirScoped()
      const outsideTmp = yield* tmpdirScoped()
      const home = yield* tmpdirScoped()
      const globalMem = path.join(globalTmp, ".agents", "memory", "MEMORY.md")
      const outsideMem = path.join(outsideTmp, "shared", "MEMORY.md")
      yield* write(globalMem, "GLOBAL MEMORY BODY")
      yield* write(outsideMem, "OUTSIDE MEMORY BODY")
      const cap = capture()

      const out = yield* run(
        [globalMem, outsideMem],
        {
          [globalMem]: { trusted: true, source: globalMem },
          [outsideMem]: { trusted: false, source: outsideMem, root: projectTmp },
        },
        projectTmp,
        home,
        cap.logs,
        cap.layer,
      )
      expect(out.joined).toContain("GLOBAL MEMORY BODY")
      expect(out.joined).not.toContain("OUTSIDE MEMORY BODY")
      expect(cap.logs.some((line) => line.includes("skipping instruction file that could not be read") && line.includes(outsideMem))).toBe(true)
    }),
  )

  it.live("warns when an instructions entry matches no files", () =>
    Effect.gen(function* () {
      const projectTmp = yield* tmpdirScoped()
      const home = yield* tmpdirScoped()
      const missing = path.join(projectTmp, "nope", "MEMORY.md")
      const cap = capture()

      const out = yield* run([missing], { [missing]: { trusted: false, source: missing, root: projectTmp } }, projectTmp, home, cap.logs, cap.layer)
      expect(out.paths.has(missing)).toBe(false)
      expect(cap.logs.some((line) => line.includes("instructions entry matched no files") && line.includes(missing))).toBe(true)
    }),
  )
})
