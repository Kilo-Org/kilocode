import { describe, expect, test } from "bun:test"
import { build } from "esbuild"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createSolidPlugin } from "../script/solid-cache"

async function compile(root: string, cacheDir: string, entry: string) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    external: ["solid-js/web"],
    logLevel: "silent",
    plugins: [createSolidPlugin({ root, cacheDir })],
  })
  return result.outputFiles[0]!.text
}

describe("solid transform cache", () => {
  test("hits an unchanged source, misses a changed one, and emits compiled JSX", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "kilo-solid-root-"))
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), "kilo-solid-cache-"))
    try {
      const card = path.join(root, "card.tsx")
      const entry = path.join(root, "entry.tsx")
      await writeFile(card, `export const Card = () => <div class="card">alpha</div>\n`)
      await writeFile(entry, `import { Card } from "./card"\nconsole.log(Card)\n`)

      const first = await compile(root, cacheDir, entry)
      expect(first).toContain("alpha")
      expect(first).toContain("template")
      expect(first).not.toContain('<div class="card">')

      // A fresh plugin instance reads the disk cache. Replacing the card entry proves the next build is a hit.
      const entries = (await readdir(cacheDir)).filter((file) => file.endsWith(".js"))
      expect(entries).toHaveLength(2)
      const cardEntry = (
        await Promise.all(
          entries.map(async (file) => [file, await readFile(path.join(cacheDir, file), "utf8")] as const),
        )
      ).find(([, code]) => code.includes("alpha"))?.[0]
      expect(cardEntry).toBeDefined()
      await writeFile(path.join(cacheDir, cardEntry!), `export const Card = () => "poison-hit"\n`)

      const hit = await compile(root, cacheDir, entry)
      expect(hit).toContain("poison-hit")

      await writeFile(card, `export const Card = () => <div class="card">beta</div>\n`)
      const changed = await compile(root, cacheDir, entry)
      expect(changed).toContain("beta")
      expect(changed).not.toContain("poison-hit")
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
      await rm(cacheDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    }
  })
})
