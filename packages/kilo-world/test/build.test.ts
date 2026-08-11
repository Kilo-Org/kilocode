import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fingerprint } from "../src/daemon/build"

test("fingerprints relative package roots", async () => {
  const root = join(import.meta.dirname, "..")
  expect(await fingerprint(".")).toBe(await fingerprint(root))
})

test("invalidates only for relevant dependency lock changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kilo-world-fingerprint-"))
  const root = join(dir, "packages", "kilo-world")
  const lock = (version: string, other: string) => `{
  "workspaces": {
    "packages/kilo-world": {
      "name": "@kilocode/world",
      "dependencies": {
        "playwright": "catalog:",
      },
    },
    "packages/other": {
      "name": "other",
    },
  },
  "packages": {
    "other": ["other@${other}", "", {}, "other-integrity"],
    "playwright": ["playwright@${version}", "", { "dependencies": { "playwright-core": "${version}" } }, "playwright-integrity"],
    "playwright-core": ["playwright-core@${version}", "", {}, "playwright-core-integrity"],
  }
}`
  try {
    await Promise.all([mkdir(join(root, "script"), { recursive: true }), mkdir(join(root, "src"), { recursive: true })])
    await Promise.all([
      writeFile(join(dir, "package.json"), JSON.stringify({ workspaces: { catalog: { playwright: "1.57.0" } } })),
      writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { playwright: "catalog:" } })),
      writeFile(join(root, "script", "build-daemon.ts"), ""),
      writeFile(join(root, "script", "daemon.ts"), ""),
      writeFile(join(root, "src", "index.ts"), ""),
      writeFile(join(dir, "bun.lock"), lock("1.57.0", "1.0.0")),
    ])
    const first = await fingerprint(root)
    await writeFile(join(dir, "bun.lock"), lock("1.57.0", "2.0.0"))
    expect(await fingerprint(root)).toBe(first)
    await writeFile(join(dir, "bun.lock"), lock("1.58.0", "2.0.0"))
    expect(await fingerprint(root)).not.toBe(first)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
