import { expect, mock, test } from "bun:test"
import { chmod, mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sent: Array<{ event: string; properties?: Record<string, unknown> }> = []

void mock.module("posthog-node", () => ({
  PostHog: class {
    capture(value: { event: string; properties?: Record<string, unknown> }) {
      sent.push(value)
    }
    on() {}
    optIn() {}
    optOut() {}
    async shutdown() {}
  },
}))

const shell = process.platform === "win32" ? test.skip : test

shell("CLI events carry the enabled conda client token", async () => {
  const root = await mkdtemp(join(tmpdir(), "kilo-aau-"))
  const home = process.env.HOME
  const exe = process.env.CONDA_EXE
  const token = "abcdefghijklmnopqrstuv"

  try {
    await mkdir(join(root, ".conda"))
    await Bun.write(join(root, ".conda", "aau_token"), token)
    const conda = join(root, "conda")
    await Bun.write(
      conda,
      `#!/bin/sh\n[ "$1" = "info" ] && [ "$2" = "--json" ] && [ "$3" = "--offline" ] || exit 3\nprintf '%s\\n' '{"user_agent":"conda/26.1 aau/0.7.6 c/${token} s/session"}'\n`,
    )
    await chmod(conda, 0o755)
    process.env.HOME = root
    process.env.CONDA_EXE = conda

    const { Telemetry } = await import("../telemetry.js")
    await Telemetry.init({ dataPath: root, version: "test", enabled: true })
    Telemetry.trackCliStart()
    expect(sent.at(-1)?.properties?.aauClientToken).toBe(token)
    sent.length = 0
    Telemetry.setEnabled(false)
    Telemetry.trackCliStart()
    expect(sent).toHaveLength(0)
    await Telemetry.shutdown()
  } finally {
    if (home === undefined) delete process.env.HOME
    else process.env.HOME = home
    if (exe === undefined) delete process.env.CONDA_EXE
    else process.env.CONDA_EXE = exe
    await rm(root, { recursive: true, force: true })
  }
})
