import { describe, expect, test } from "bun:test"
import type { OutputFile } from "esbuild"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  isTargetFresh,
  snapshotDirectories,
  stampFiles,
  stampOutputs,
  syncOutputFiles,
  type TargetState,
} from "../script/incremental"

function outputFile(filePath: string, text: string): OutputFile {
  const contents = new TextEncoder().encode(text)
  return { path: filePath, contents, hash: "", text }
}

describe("incremental build helpers", () => {
  test("detects unchanged targets and invalidates on input, directory, or output changes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "kilo-inc-root-"))
    const dist = path.join(root, "dist")
    const locales = path.join(root, "locales")
    try {
      await mkdir(dist, { recursive: true })
      await mkdir(locales, { recursive: true })
      const input = path.join(root, "input.ts")
      const locale = path.join(locales, "en.ts")
      const out = path.join(dist, "bundle.js")
      await writeFile(input, "export const a = 1\n")
      await writeFile(locale, "export const dict = {}\n")
      await writeFile(out, "console.log(1)\n")

      const state: TargetState = {
        version: 1,
        inputs: stampFiles([input, locale]),
        directories: snapshotDirectories([locales]),
        outputs: stampOutputs(dist, ["bundle.js"]),
      }

      expect(isTargetFresh(state, dist)).toBe(true)

      // Adding a file to a watched macro directory invalidates the target.
      const added = path.join(locales, "de.ts")
      await writeFile(added, "export const dict = {}\n")
      expect(isTargetFresh(state, dist)).toBe(false)
      await rm(added)
      expect(isTargetFresh(state, dist)).toBe(true)

      // Modifying an input file invalidates the target.
      await writeFile(input, "export const a = 22\n")
      expect(isTargetFresh(state, dist)).toBe(false)

      // Restoring inputs and deleting an output invalidates the target.
      const updatedState: TargetState = {
        ...state,
        inputs: stampFiles([input, locale]),
      }
      expect(isTargetFresh(updatedState, dist)).toBe(true)
      await rm(out)
      expect(isTargetFresh(updatedState, dist)).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("syncOutputFiles skips unchanged files, updates modified files, and deletes stale outputs", async () => {
    const dist = await mkdtemp(path.join(os.tmpdir(), "kilo-sync-dist-"))
    try {
      const keep = path.join(dist, "chunk-a.js")
      const edit = path.join(dist, "entry.js")
      const stale = path.join(dist, "old-chunk.js")

      const first = await syncOutputFiles(dist, undefined, [
        outputFile(keep, "same-content"),
        outputFile(edit, "version-1"),
        outputFile(stale, "obsolete"),
      ])
      const keepBefore = await stat(keep)

      // Sleep briefly so an accidental rewrite would advance mtimeMs.
      await Bun.sleep(20)

      const second = await syncOutputFiles(dist, first, [
        outputFile(keep, "same-content"),
        outputFile(edit, "version-2"),
      ])
      const keepAfter = await stat(keep)

      expect(keepAfter.mtimeMs).toBe(keepBefore.mtimeMs)
      expect(keepAfter.ino).toBe(keepBefore.ino)
      expect(await readFile(edit, "utf8")).toBe("version-2")
      expect(existsSync(stale)).toBe(false)
      expect(Object.keys(second).toSorted()).toEqual(["chunk-a.js", "entry.js"])
    } finally {
      await rm(dist, { recursive: true, force: true })
    }
  })
})
