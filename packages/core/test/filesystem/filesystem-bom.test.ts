import { describe, expect } from "bun:test"
import { Effect, FileSystem, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { testEffect } from "../lib/effect"
import path from "path"

const live = AppFileSystem.layer.pipe(Layer.provideMerge(NodeFileSystem.layer))
const { effect: it } = testEffect(live)

const UTF8_BOM_TEXT = String.fromCharCode(0xfeff)

function startsWithUtf8Bom(bytes: Uint8Array) {
  if (bytes[0] !== 0xef) return false
  if (bytes[1] !== 0xbb) return false
  return bytes[2] === 0xbf
}

function utf8BomBytes(text: string) {
  const body = new TextEncoder().encode(text)
  const bytes = new Uint8Array(body.length + 3)
  bytes[0] = 0xef
  bytes[1] = 0xbb
  bytes[2] = 0xbf
  bytes.set(body, 3)
  return bytes
}

function decodeAfterUtf8Bom(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes.slice(3))
}

describe("UTF-8 BOM preservation", function () {
  it(
    "preserves the marker when reading BOM files",
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const filesys = yield* FileSystem.FileSystem
      const tmp = yield* filesys.makeTempDirectoryScoped()
      const file = path.join(tmp, "bom.txt")
      yield* filesys.writeFile(file, utf8BomBytes("hello"))

      const result = yield* fs.readFileString(file)

      expect(result).toBe(UTF8_BOM_TEXT + "hello")
    }),
  )

  it(
    "preserves the marker when overwriting BOM files",
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const filesys = yield* FileSystem.FileSystem
      const tmp = yield* filesys.makeTempDirectoryScoped()
      const file = path.join(tmp, "bom-overwrite.txt")
      yield* filesys.writeFile(file, utf8BomBytes("before"))

      yield* fs.writeFileString(file, "after")
      const bytes = yield* filesys.readFile(file)

      expect(startsWithUtf8Bom(bytes)).toBe(true)
      expect(decodeAfterUtf8Bom(bytes)).toBe("after")
    }),
  )

  it(
    "preserves the marker when editing through writeWithDirs",
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const filesys = yield* FileSystem.FileSystem
      const tmp = yield* filesys.makeTempDirectoryScoped()
      const file = path.join(tmp, "bom-edit.txt")
      yield* filesys.writeFile(file, utf8BomBytes("before"))

      const edited = (yield* fs.readFileString(file)).replace("before", "after")
      yield* fs.writeWithDirs(file, edited)
      const bytes = yield* filesys.readFile(file)

      expect(startsWithUtf8Bom(bytes)).toBe(true)
      expect(decodeAfterUtf8Bom(bytes)).toBe("after")
    }),
  )

  it(
    "preserves the marker when reading and writing JSON",
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const filesys = yield* FileSystem.FileSystem
      const tmp = yield* filesys.makeTempDirectoryScoped()
      const file = path.join(tmp, "bom.json")
      yield* filesys.writeFile(file, utf8BomBytes(JSON.stringify({ old: true })))

      expect(yield* fs.readJson(file)).toEqual({ old: true })

      yield* fs.writeJson(file, { next: true })
      const bytes = yield* filesys.readFile(file)

      expect(startsWithUtf8Bom(bytes)).toBe(true)
      expect(yield* fs.readJson(file)).toEqual({ next: true })
    }),
  )
})
