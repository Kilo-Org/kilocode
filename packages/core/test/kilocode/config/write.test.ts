import path from "node:path"
import fs from "node:fs/promises"
import { describe, expect } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Exit, Layer } from "effect"
import { parse, type ParseError } from "jsonc-parser"
import { KiloConfigWriter } from "@opencode/core/kilocode/config/write"
import { FSUtil } from "@opencode/util/fs-util"
import { tmpdirScoped } from "../../fixture/tmpdir"
import { it } from "../../lib/effect"

const layer = (options?: KiloConfigWriter.Options) =>
  KiloConfigWriter.layer(options).pipe(Layer.provide(FSUtil.layer), Layer.provide(NodeFileSystem.layer))

const put = (file: string, content: string) =>
  Effect.promise(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, content)
  })

const read = (file: string) => Effect.promise(() => fs.readFile(file, "utf8"))

const mode = (file: string) => Effect.promise(() => fs.stat(file).then((info) => info.mode & 0o777))

const valid = (text: string) => {
  const errors: ParseError[] = []
  parse(text, errors, { allowTrailingComma: true })
  return errors.length === 0
}

const privacy = (text: string) => JSON.parse(text)?.privacy_mode

describe("KiloConfigWriter", () => {
  it.effect("writes to the first existing global candidate", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const json = path.join(tmp.path, "kilo2.json")
      yield* put(json, `{\n  "shell": "zsh"\n}\n`)
      const writer = yield* KiloConfigWriter.Service
      const result = yield* writer.write({
        target: { directory: tmp.path, global: true },
        path: ["privacy_mode"],
        value: true,
      })
      expect(result.file).toBe(json)
      expect(result.created).toBe(false)
      expect(JSON.parse(yield* read(json))).toEqual({ shell: "zsh", privacy_mode: true })
    }).pipe(Effect.provide(layer())),
  )

  it.effect("prefers the global .jsonc candidate over .json", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const jsonc = path.join(tmp.path, "kilo2.jsonc")
      yield* put(path.join(tmp.path, "kilo2.json"), `{"shell": "zsh"}\n`)
      yield* put(jsonc, `{"shell": "bash"}\n`)
      const writer = yield* KiloConfigWriter.Service
      const result = yield* writer.write({
        target: { directory: tmp.path, global: true },
        path: ["privacy_mode"],
        value: true,
      })
      expect(result.file).toBe(jsonc)
      expect(privacy(yield* read(jsonc))).toBe(true)
    }).pipe(Effect.provide(layer())),
  )

  it.effect("creates kilo2.json when no global candidate exists", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const writer = yield* KiloConfigWriter.Service
      const result = yield* writer.write({
        target: { directory: tmp.path, global: true },
        path: ["privacy_mode"],
        value: true,
      })
      expect(result.file).toBe(path.join(tmp.path, "kilo2.json"))
      expect(result.created).toBe(true)
      const text = yield* read(result.file)
      expect(valid(text)).toBe(true)
      expect(privacy(text)).toBe(true)
    }).pipe(Effect.provide(layer())),
  )

  it.effect("resolves project candidates to the reader's winner: .kilo2 before root, later read file first", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const dot = path.join(tmp.path, ".kilo2")
      const expected = path.join(dot, "kilo2.json")
      yield* put(path.join(tmp.path, "kilo2.json"), `{"shell": "a"}\n`)
      yield* put(path.join(tmp.path, "kilo2.jsonc"), `{"shell": "b"}\n`)
      yield* put(expected, `{"shell": "c"}\n`)
      yield* put(path.join(dot, "kilo2.jsonc"), `{"shell": "d"}\n`)
      const writer = yield* KiloConfigWriter.Service
      expect(yield* writer.target({ directory: tmp.path })).toBe(expected)

      yield* Effect.promise(() => fs.rm(dot, { recursive: true, force: true }))
      expect(yield* writer.target({ directory: tmp.path })).toBe(path.join(tmp.path, "kilo2.jsonc"))

      const empty = yield* tmpdirScoped()
      expect(yield* writer.target({ directory: empty.path })).toBe(path.join(empty.path, "kilo2.json"))
    }).pipe(Effect.provide(layer())),
  )

  it.effect("preserves comments and formatting on rewrite", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const file = path.join(tmp.path, "kilo2.json")
      yield* put(file, `{\n  // keep this comment\n  "shell": "zsh"\n}\n`)
      const writer = yield* KiloConfigWriter.Service
      yield* writer.write({ target: { directory: tmp.path, global: true }, path: ["privacy_mode"], value: true })
      const text = yield* read(file)
      expect(text).toContain("// keep this comment")
      expect(text.endsWith("\n")).toBe(true)
      expect(text).toBe(`{\n  // keep this comment\n  "shell": "zsh",\n  "privacy_mode": true\n}\n`)
      expect(valid(text)).toBe(true)
    }).pipe(Effect.provide(layer())),
  )

  it.effect("sets and restores 0600 on create and rewrite", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const file = path.join(tmp.path, "kilo2.json")
      yield* put(file, `{"shell": "zsh"}\n`)
      yield* Effect.promise(() => fs.chmod(file, 0o644))
      const writer = yield* KiloConfigWriter.Service
      yield* writer.write({ target: { directory: tmp.path, global: true }, path: ["privacy_mode"], value: true })

      const fresh = path.join((yield* tmpdirScoped()).path, "kilo2.json")
      const result = yield* writer.write({ target: { directory: path.dirname(fresh), global: true }, path: ["privacy_mode"], value: true })
      expect(result.file).toBe(fresh)
      // POSIX permission bits; Windows has no mode bits to assert, so check the file was written instead.
      if (process.platform === "win32") {
        expect(valid(yield* read(fresh))).toBe(true)
      } else {
        expect(yield* mode(file)).toBe(0o600)
        expect(yield* mode(fresh)).toBe(0o600)
      }
    }).pipe(Effect.provide(layer())),
  )

  it.effect("reports a revision that changes after a write and is stable while unchanged", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const file = path.join(tmp.path, "kilo2.json")
      const writer = yield* KiloConfigWriter.Service
      expect(yield* writer.revision(file)).toBeUndefined()

      const first = yield* writer.write({
        target: { directory: tmp.path, global: true },
        path: ["privacy_mode"],
        value: true,
      })
      const stable = yield* writer.revision(file)
      expect(stable?.hash).toBe(first.revision)
      expect((yield* writer.revision(file))?.hash).toBe(first.revision)

      const second = yield* writer.write({
        target: { directory: tmp.path, global: true },
        path: ["privacy_mode"],
        value: false,
      })
      expect(second.revision).not.toBe(first.revision)
    }).pipe(Effect.provide(layer())),
  )

  it.effect("rejects a stale expectedRevision without touching the file", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const file = path.join(tmp.path, "kilo2.json")
      const writer = yield* KiloConfigWriter.Service
      const first = yield* writer.write({
        target: { directory: tmp.path, global: true },
        path: ["privacy_mode"],
        value: true,
      })
      yield* writer.write({ target: { directory: tmp.path }, path: ["privacy_mode"], value: false })
      const before = yield* read(file)
      const error = yield* Effect.flip(
        writer.write({ target: { directory: tmp.path, global: true }, path: ["shell"], value: "zsh", expectedRevision: first.revision }),
      )
      expect(error.reason).toBe("conflict")
      expect(yield* read(file)).toBe(before)
    }).pipe(Effect.provide(layer())),
  )

  it.effect("leaves an invalid existing file unchanged", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const file = path.join(tmp.path, "kilo2.json")
      const original = `{ // not valid\n  "shell": \n`
      yield* put(file, original)
      const writer = yield* KiloConfigWriter.Service
      const error = yield* Effect.flip(
        writer.write({ target: { directory: tmp.path, global: true }, path: ["privacy_mode"], value: true }),
      )
      expect(error.reason).toBe("invalid")
      expect(yield* read(file)).toBe(original)
    }).pipe(Effect.provide(layer())),
  )

  it.effect("creates only when absent with a null expectedRevision", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const writer = yield* KiloConfigWriter.Service
      const first = yield* writer.write({
        target: { directory: tmp.path, global: true },
        path: ["privacy_mode"],
        value: true,
        expectedRevision: null,
      })
      expect(first.created).toBe(true)
      const error = yield* Effect.flip(
        writer.write({
          target: { directory: tmp.path, global: true },
          path: ["shell"],
          value: "zsh",
          expectedRevision: null,
        }),
      )
      expect(error.reason).toBe("conflict")
      expect(JSON.parse(yield* read(first.file))).toEqual({ privacy_mode: true })
    }).pipe(Effect.provide(layer())),
  )

  it.effect("serializes concurrent writes so only one passes the revision guard", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const writer = yield* KiloConfigWriter.Service
      const seed = yield* writer.write({
        target: { directory: tmp.path, global: true },
        path: ["seed"],
        value: true,
      })
      const results = yield* Effect.forEach(
        [0, 1, 2, 3],
        (n) =>
          Effect.exit(
            writer.write({
              target: { directory: tmp.path, global: true },
              path: [`key_${n}`],
              value: n,
              expectedRevision: seed.revision,
            }),
          ),
        { concurrency: "unbounded" },
      )
      expect(results.filter(Exit.isSuccess).length).toBe(1)
      expect(results.filter(Exit.isFailure).length).toBe(3)
    }).pipe(Effect.provide(layer())),
  )

  it.effect("fails instead of overwriting a config it cannot read", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const file = path.join(tmp.path, "kilo2.json")
      // A directory at the target path makes the read fail with something other than NotFound.
      yield* Effect.promise(() => fs.mkdir(file))
      const writer = yield* KiloConfigWriter.Service
      const error = yield* Effect.flip(
        writer.write({ target: { directory: tmp.path, global: true }, path: ["privacy_mode"], value: true }),
      )
      expect(error.reason).toBe("io")
      expect((yield* Effect.promise(() => fs.stat(file))).isDirectory()).toBe(true)
    }).pipe(Effect.provide(layer())),
  )

  it.effect("runs the reload hook after a successful write", () => {
    let calls = 0
    return Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const writer = yield* KiloConfigWriter.Service
      yield* writer.write({ target: { directory: tmp.path, global: true }, path: ["privacy_mode"], value: true })
      expect(calls).toBe(1)
    }).pipe(
      Effect.provide(
        layer({
          reload: Effect.sync(() => {
            calls += 1
          }),
        }),
      ),
    )
  })

  it.effect("removes a key when the value is undefined", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const file = path.join(tmp.path, "kilo2.json")
      yield* put(file, `{\n  "shell": "zsh",\n  "privacy_mode": true\n}\n`)
      const writer = yield* KiloConfigWriter.Service
      yield* writer.write({ target: { directory: tmp.path, global: true }, path: ["privacy_mode"], value: undefined })
      expect(JSON.parse(yield* read(file))).toEqual({ shell: "zsh" })
    }).pipe(Effect.provide(layer())),
  )
})
