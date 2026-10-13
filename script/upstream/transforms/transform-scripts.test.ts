import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { transformAllScripts } from "./transform-scripts"

test("branding skips Kilo-owned scripts", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "kilo-upstream-scripts-"))
  const cwd = process.cwd()
  try {
    await mkdir(path.join(dir, "script"))
    const text = 'const url = "https://api.github.com/repos/anomalyco/opencode/releases"\n'
    await Bun.write(path.join(dir, "script/release.ts"), text)
    await Bun.write(path.join(dir, "script/dev-isolated.ts"), text)
    await Bun.write(path.join(dir, "script/check-workflows.ts"), text)
    process.chdir(dir)
    const results = await transformAllScripts({ dryRun: true })
    expect(results.filter((r) => r.replacements > 0).map((r) => r.file)).toEqual(["script/release.ts"])
  } finally {
    process.chdir(cwd)
    await rm(dir, { recursive: true, force: true })
  }
})
