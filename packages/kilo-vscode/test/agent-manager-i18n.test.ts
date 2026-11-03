import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const DIR = join(import.meta.dir, "../webview-ui/agent-manager/i18n")

const keys = (file: string) => {
  const source = readFileSync(join(DIR, file), "utf8")
  return new Set(Array.from(source.matchAll(/"(agentManager\.[A-Za-z0-9_.]+)"\s*:/g), (match) => match[1]))
}

describe("agent manager translations", () => {
  it("every locale defines the same keys as English", () => {
    const english = keys("en.ts")
    const missing = readdirSync(DIR)
      .filter((file) => file.endsWith(".ts") && file !== "en.ts")
      .flatMap((file) => {
        const locale = keys(file)
        return [...english].filter((key) => !locale.has(key)).map((key) => `${file}: ${key}`)
      })
    expect(missing).toEqual([])
  })
})
