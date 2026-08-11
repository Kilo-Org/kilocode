import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { World } from "../src"
import { Runner } from "../src/core/browser/runner"

const config = World.currentConfig()
const root = mkdtempSync(join(tmpdir(), "kilo-world-runner-"))

try {
  await Runner.configure({ ...config, home: join(root, "state") })

  const browsers = await Promise.all([Runner.ensureBrowser(), Runner.ensureBrowser(), Runner.ensureBrowser()])
  assert.strictEqual(browsers[1], browsers[0])
  assert.strictEqual(browsers[2], browsers[0])

  const first = await Runner.ensureBrowser()
  await Runner.configure({ browser: { ...config.browser, args: [...config.browser.args, "--disable-notifications"] } })
  const second = await Runner.ensureBrowser()
  assert.equal(first.isConnected(), false)
  assert.notStrictEqual(second, first)
  await Runner.configure({ browser: config.browser })

  const victim = join(root, "victim")
  const marker = join(victim, "marker")
  mkdirSync(victim)
  writeFileSync(marker, "keep")
  await Runner.configure({ ...config, home: join(root, "state") })
  await Runner.attach("../../victim")
  await Runner.close("../../victim")
  assert.equal(existsSync(marker), true)
} finally {
  await Runner.shutdown()
  await Runner.configure(config)
  rmSync(root, { recursive: true, force: true })
}
