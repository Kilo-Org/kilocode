// kilocode_change - new file
//
// Kilo uses @npmcli/arborist instead of bun for dependency installation.
// Users may have pnpm or yarn as their system package manager, which can
// produce lockfiles in the .kilo/ config directory. These must be ignored
// so they don't appear as untracked files in the user's project.

import { expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Config } from "../../src/config/config"
import { Npm } from "../../src/npm"
import * as Network from "../../src/util/network"
import { Filesystem } from "../../src/util/filesystem"
import { AppRuntime } from "../../src/effect/app-runtime"
import { tmpdir } from "../fixture/fixture"

test(".gitignore includes pnpm and yarn lockfile patterns", async () => {
  await using tmp = await tmpdir()
  const dir = path.join(tmp.path, "a")
  await fs.mkdir(dir, { recursive: true })

  const online = spyOn(Network, "online").mockReturnValue(false)
  const run = spyOn(Npm, "install").mockImplementation(async (d: string) => {
    const mod = path.join(d, "node_modules", "@kilocode", "plugin")
    await fs.mkdir(mod, { recursive: true })
    await Filesystem.write(
      path.join(mod, "package.json"),
      JSON.stringify({ name: "@kilocode/plugin", version: "1.0.0" }),
    )
  })

  try {
    await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.installDependencies(dir)))
    const ignore = await Filesystem.readText(path.join(dir, ".gitignore"))
    expect(ignore).toContain("pnpm-lock.yaml")
    expect(ignore).toContain("yarn.lock")
  } finally {
    online.mockRestore()
    run.mockRestore()
  }
})
