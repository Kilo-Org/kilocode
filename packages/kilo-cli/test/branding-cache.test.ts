import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createBrandingPlugin } from "../src/branding/plugin"
import { createCachedSolidTransformPlugin } from "../src/branding/solid-cache"

describe("kilo-cli transform disk cache", () => {
  test("caches universal Solid JSX transforms on disk and invalidates on source edits", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "kilo-cli-solid-root-"))
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), "kilo-cli-solid-cache-"))
    try {
      const entry = path.join(root, "view.tsx")
      await writeFile(entry, `export const View = () => <text>alpha</text>\n`)

      const compile = async () => {
        const result = await Bun.build({
          entrypoints: [entry],
          target: "bun",
          external: ["@opentui/solid"],
          plugins: [createCachedSolidTransformPlugin({ cacheDir })],
        })
        expect(result.success, result.logs.map(String).join("\n")).toBe(true)
        return result.outputs[0]!.text()
      }

      const first = await compile()
      expect(first).toContain("alpha")
      expect(first).toContain("@opentui/solid")
      expect(first).not.toContain("<text>alpha</text>")

      const entries = (await readdir(cacheDir)).filter((file) => file.endsWith(".js"))
      expect(entries).toHaveLength(1)
      await writeFile(path.join(cacheDir, entries[0]!), `export const View = () => "cached-solid-hit"\n`)

      const hit = await compile()
      expect(hit).toContain("cached-solid-hit")

      await writeFile(entry, `export const View = () => <text>beta</text>\n`)
      const miss = await compile()
      expect(miss).toContain("beta")
      expect(miss).not.toContain("cached-solid-hit")
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("caches branding transforms on disk, invalidates on edits, and separates release config mode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "kilo-cli-brand-root-"))
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), "kilo-cli-brand-cache-"))
    const saved = process.env.KILO_USE_RELEASE_CONFIG
    try {
      const dir = path.join(root, "packages/tui/src/util")
      await mkdir(dir, { recursive: true })
      const entry = path.join(dir, "error.ts")
      await writeFile(entry, `export const hint = "Restart opencode now"\n`)

      const compile = async () => {
        const result = await Bun.build({
          entrypoints: [entry],
          target: "bun",
          plugins: [createBrandingPlugin({ cacheDir })],
        })
        expect(result.success, result.logs.map(String).join("\n")).toBe(true)
        return result.outputs[0]!.text()
      }

      delete process.env.KILO_USE_RELEASE_CONFIG
      const first = await compile()
      expect(first).toContain("Restart kilo2 now")

      const files = (await readdir(cacheDir)).filter((file) => file.endsWith(".ts"))
      expect(files).toHaveLength(1)
      const cachedPath = path.join(cacheDir, files[0]!)
      expect(await readFile(cachedPath, "utf8")).toContain("Restart kilo2 now")
      await writeFile(cachedPath, `export const hint = "cached-brand-hit"\n`)

      expect(await compile()).toContain("cached-brand-hit")

      // Switching config mode must not reuse the cached v2 entry.
      process.env.KILO_USE_RELEASE_CONFIG = "1"
      expect(await compile()).toContain("Restart kilo2 now")
      expect((await readdir(cacheDir)).filter((file) => file.endsWith(".ts"))).toHaveLength(2)

      // Editing source invalidates the entry cleanly.
      delete process.env.KILO_USE_RELEASE_CONFIG
      await writeFile(entry, `export const hint = "Check OpenCode logs"\n`)
      const edited = await compile()
      expect(edited).toContain("Check Kilo logs")
      expect(edited).not.toContain("cached-brand-hit")
    } finally {
      if (saved === undefined) delete process.env.KILO_USE_RELEASE_CONFIG
      else process.env.KILO_USE_RELEASE_CONFIG = saved
      await rm(root, { recursive: true, force: true })
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("disk: false keeps branding transforms in memory without reading or writing disk cache", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "kilo-cli-brand-mem-root-"))
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), "kilo-cli-brand-mem-cache-"))
    try {
      const dir = path.join(root, "packages/tui/src/util")
      await mkdir(dir, { recursive: true })
      const entry = path.join(dir, "error.ts")
      await writeFile(entry, `export const hint = "Restart opencode now"\n`)

      const result = await Bun.build({
        entrypoints: [entry],
        target: "bun",
        plugins: [createBrandingPlugin({ cacheDir, disk: false })],
      })
      expect(result.success, result.logs.map(String).join("\n")).toBe(true)
      expect(await result.outputs[0]!.text()).toContain("Restart kilo2 now")
      expect(await readdir(cacheDir)).toHaveLength(0)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(cacheDir, { recursive: true, force: true })
    }
  })
})
