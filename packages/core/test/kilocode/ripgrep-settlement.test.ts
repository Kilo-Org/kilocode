import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Cause, Deferred, Effect, Fiber, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { RipgrepBinary } from "@opencode-ai/core/ripgrep/binary"
import { RelativePath } from "@opencode-ai/core/schema"
import { tmpdir } from "../fixture/tmpdir"
import { it } from "../lib/effect"

const record = (type: "match" | "context", line: number, text: string) =>
  JSON.stringify({
    type,
    data: {
      path: { text: "fixture.ts" },
      lines: { text: `${text}\n` },
      line_number: line,
      absolute_offset: line * 10,
      submatches: type === "match" ? [{ match: { text: "NEEDLE.*" }, start: 0, end: 8 }] : [],
    },
  })

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const read = async (file: string) => {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    const value = await fs.readFile(file, "utf8").catch(() => undefined)
    if (value) return value
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for ${file}`)
}

const cleanup = async (file: string) => {
  const pid = Number(await fs.readFile(file, "utf8").catch(() => ""))
  if (!pid || !alive(pid)) return
  try {
    process.kill(pid, "SIGKILL")
  } catch (err) {
    if (alive(pid)) throw err
  }
}

const gone = async (pid: number) => {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    if (!alive(pid)) return true
    await Bun.sleep(10)
  }
  return !alive(pid)
}

const fixture = async (dir: string, source: string) => {
  if (process.platform !== "win32") {
    const binary = path.join(dir, "rg")
    await fs.writeFile(binary, `#!${process.execPath}\n${source}`, { mode: 0o755 })
    return binary
  }

  const script = path.join(dir, "fake-rg.cjs")
  const binary = path.join(dir, "rg.cmd")
  await fs.writeFile(script, source)
  await fs.writeFile(binary, `@echo off\r\n"${process.execPath}" "%~dp0fake-rg.cjs" %*\r\n`)
  return binary
}

const layer = (binary: string, filepath = Effect.succeed(binary)) =>
  LayerNode.compile(Ripgrep.node, [
    [RipgrepBinary.node, Layer.succeed(RipgrepBinary.Service, RipgrepBinary.Service.of({ filepath }))],
  ] as const)

describe("Kilo ripgrep settlement", () => {
  it.effect(
    "starts the glob deadline after cached binary initialization",
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const binary = yield* Effect.promise(() => fixture(tmp.path, 'process.stdout.write("fixture.ts\\n")'))
          const started = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const state = { initialized: 0 }
          const filepath = yield* Effect.cached(
            Effect.gen(function* () {
              state.initialized++
              yield* Deferred.succeed(started, undefined)
              yield* Deferred.await(release)
              return binary
            }),
          )

          yield* Effect.gen(function* () {
            const ripgrep = yield* Ripgrep.Service
            const first = yield* ripgrep.glob({ cwd: tmp.path, pattern: "*.ts", limit: 100 }).pipe(Effect.forkScoped)
            yield* Deferred.await(started)
            yield* TestClock.adjust(120_001)
            expect(first.pollUnsafe()).toBeUndefined()
            yield* Deferred.succeed(release, undefined)

            const result = yield* Fiber.join(first)
            const retry = yield* ripgrep.glob({ cwd: tmp.path, pattern: "*.ts", limit: 100 })
            expect(result.items.map((item) => item.path)).toEqual([RelativePath.make("fixture.ts")])
            expect(retry.items).toEqual(result.items)
            expect(state.initialized).toBe(1)
          }).pipe(Effect.provide(layer(binary, filepath)))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
    10_000,
  )

  it.effect(
    "times out a glob after two minutes despite partial matches and continuous errors",
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const ready = path.join(tmp.path, "ready.pid")
          const source = `const { writeFileSync, writeSync } = require("node:fs")
const error = "readdir: Invalid argument\\n".repeat(512)
writeSync(1, "partial.ts\\n")
writeSync(2, error)
writeFileSync(${JSON.stringify(ready)}, String(process.pid))
setInterval(() => writeSync(2, error), 10)
setTimeout(() => process.exit(1), 30_000)
`
          const binary = yield* Effect.promise(() => fixture(tmp.path, source))
          const fiber = yield* Ripgrep.Service.pipe(
            Effect.flatMap((ripgrep) => ripgrep.glob({ cwd: tmp.path, pattern: "*.ts", limit: 100 })),
            Effect.provide(layer(binary)),
            Effect.exit,
            Effect.forkScoped,
          )
          const pid = Number(yield* Effect.promise(() => read(ready)))

          yield* TestClock.adjust(119_999)
          expect(fiber.pollUnsafe()).toBeUndefined()
          expect(alive(pid)).toBe(true)
          yield* TestClock.adjust(1)
          const exit = yield* Fiber.join(fiber)

          if (exit._tag !== "Failure") throw new Error("Glob unexpectedly completed")
          expect(Cause.prettyErrors(exit.cause).map((err) => err.message)).toContain(
            "Glob search timed out after 2 minutes. Narrow the search path or pattern.",
          )
          expect(alive(pid)).toBe(false)
        }),
      (tmp) =>
        Effect.promise(async () => {
          await cleanup(path.join(tmp.path, "ready.pid"))
          await tmp[Symbol.asyncDispose]()
        }),
    ),
    10_000,
  )

  it.live(
    "settles a bounded parameterized grep when inherited output stays open",
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const retained = path.join(tmp.path, "retained.pid")
          const owned = path.join(tmp.path, "owned.pid")
          const args = path.join(tmp.path, "args.json")
          const output =
            [
              record("context", 1, "before"),
              record("match", 2, "NEEDLE.*"),
              record("context", 3, "after"),
              record("context", 5, "later before"),
              record("match", 6, "NEEDLE.*"),
            ].join("\n") + "\n"
          const source = `const { spawn } = require("node:child_process")
const { writeFileSync, writeSync } = require("node:fs")
const retained = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 30_000)"], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
})
retained.unref()
${
  process.platform === "win32"
    ? ""
    : `const owned = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 30_000)"], {
  stdio: "ignore",
})
owned.unref()`
}
writeFileSync(${JSON.stringify(retained)}, String(retained.pid))
${process.platform === "win32" ? "" : `writeFileSync(${JSON.stringify(owned)}, String(owned.pid))`}
writeFileSync(${JSON.stringify(args)}, JSON.stringify(process.argv.slice(2)))
writeSync(1, ${JSON.stringify(output)})
`
          const binary = yield* Effect.promise(() => fixture(tmp.path, source))

          const result = yield* Ripgrep.Service.pipe(
            Effect.flatMap((ripgrep) =>
              ripgrep.grep({
                cwd: tmp.path,
                pattern: "NEEDLE.*",
                include: "*.ts",
                context: 1,
                limit: 1,
                literal: true,
                ignoreCase: true,
              }),
            ),
            Effect.provide(layer(binary)),
            Effect.timeout("5 seconds"),
          )
          const pid = Number(yield* Effect.promise(() => read(retained)))
          const passed: unknown = JSON.parse(yield* Effect.promise(() => read(args)))
          if (!Array.isArray(passed) || !passed.every((arg) => typeof arg === "string")) {
            throw new Error("Fake ripgrep did not capture string arguments")
          }

          expect(result.truncated).toBe(true)
          expect(result.items.map((item) => [item.context, item.line, item.text.trim()])).toEqual([
            [true, 1, "before"],
            [false, 2, "NEEDLE.*"],
            [true, 3, "after"],
          ])
          expect(passed).toContain("--fixed-strings")
          expect(passed).toContain("--ignore-case")
          expect(passed).toContain("--context=1")
          expect(passed).toContain("--glob=*.ts")
          expect(alive(pid)).toBe(true)
          if (process.platform !== "win32") {
            const child = Number(yield* Effect.promise(() => read(owned)))
            expect(yield* Effect.promise(() => gone(child))).toBe(true)
          }
        }),
      (tmp) =>
        Effect.promise(async () => {
          await cleanup(path.join(tmp.path, "retained.pid"))
          await cleanup(path.join(tmp.path, "owned.pid"))
          await tmp[Symbol.asyncDispose]()
        }),
    ),
    10_000,
  )

  for (const tool of ["glob", "grep"] as const) {
    it.live(
      `force kills a ${tool} that does not exit after cancellation`,
      Effect.acquireUseRelease(
        Effect.promise(() => tmpdir()),
        (tmp) =>
          Effect.gen(function* () {
            const ready = path.join(tmp.path, "ready.pid")
            const source = `const { writeFileSync } = require("node:fs")
if (process.platform !== "win32") process.on("SIGTERM", () => {})
writeFileSync(${JSON.stringify(ready)}, String(process.pid))
setInterval(() => {}, 10_000)
setTimeout(() => process.exit(1), 30_000)
`
            const binary = yield* Effect.promise(() => fixture(tmp.path, source))

            const controller = new AbortController()
            const fiber = yield* Ripgrep.Service.pipe(
              Effect.flatMap((ripgrep) => {
                const input = { cwd: tmp.path, pattern: "needle", limit: 1, signal: controller.signal }
                return tool === "glob"
                  ? ripgrep.glob(input).pipe(Effect.asVoid)
                  : ripgrep.grep({ ...input, context: 1 }).pipe(Effect.asVoid)
              }),
              Effect.provide(layer(binary)),
              Effect.exit,
              Effect.forkScoped,
            )
            const pid = Number(yield* Effect.promise(() => read(ready)))
            controller.abort()
            const exit = yield* Fiber.join(fiber).pipe(Effect.timeout("5 seconds"))

            expect(exit._tag).toBe("Failure")
            expect(alive(pid)).toBe(false)
          }),
        (tmp) =>
          Effect.promise(async () => {
            await cleanup(path.join(tmp.path, "ready.pid"))
            await tmp[Symbol.asyncDispose]()
          }),
      ),
      10_000,
    )
  }

  it.live(
    "force kills a glob when its fiber is interrupted",
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const ready = path.join(tmp.path, "ready.pid")
          const source = `const { writeFileSync } = require("node:fs")
if (process.platform !== "win32") process.on("SIGTERM", () => {})
writeFileSync(${JSON.stringify(ready)}, String(process.pid))
setInterval(() => {}, 10_000)
setTimeout(() => process.exit(1), 30_000)
`
          const binary = yield* Effect.promise(() => fixture(tmp.path, source))
          const fiber = yield* Ripgrep.Service.pipe(
            Effect.flatMap((ripgrep) => ripgrep.glob({ cwd: tmp.path, pattern: "*.ts", limit: 100 })),
            Effect.provide(layer(binary)),
            Effect.forkScoped,
          )
          const pid = Number(yield* Effect.promise(() => read(ready)))

          yield* Fiber.interrupt(fiber).pipe(Effect.timeout("5 seconds"))
          expect(alive(pid)).toBe(false)
        }),
      (tmp) =>
        Effect.promise(async () => {
          await cleanup(path.join(tmp.path, "ready.pid"))
          await tmp[Symbol.asyncDispose]()
        }),
    ),
    10_000,
  )
})
