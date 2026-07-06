import { expect } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { Snapshot } from "../../src/snapshot"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Snapshot.defaultLayer, AppFileSystem.defaultLayer))
const fwd = (...parts: string[]) => path.join(...parts).replaceAll("\\", "/")
const write = (file: string, content: string) => AppFileSystem.Service.use((fs) => fs.writeWithDirs(file, content))
const read = (file: string) => AppFileSystem.Service.use((fs) => fs.readFileString(file))
const exists = (file: string) => AppFileSystem.Service.use((fs) => fs.existsSafe(file))
const mkdir = (dir: string) => AppFileSystem.Service.use((fs) => fs.ensureDir(dir))

it.instance(
  "restores both paths after moving a file",
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const snapshot = yield* Snapshot.Service
    const source = path.join(tmp.directory, "source", "file.txt")
    const destination = path.join(tmp.directory, "moved folder", "file.txt")

    yield* write(source, "original content")
    const before = yield* snapshot.track()
    expect(before).toBeTruthy()
    if (!before) throw new Error("snapshot tracking failed")

    yield* mkdir(path.dirname(destination))
    yield* Effect.promise(() => fs.rename(source, destination))

    const patch = yield* snapshot.patch(before)
    expect(patch.files).toContain(fwd(source))
    expect(patch.files).toContain(fwd(destination))

    yield* snapshot.revert([patch])
    expect(yield* read(source)).toBe("original content")
    expect(yield* exists(destination)).toBe(false)
  }),
  { git: true },
)
