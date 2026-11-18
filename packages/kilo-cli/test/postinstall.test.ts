import { expect, test } from "bun:test"
import { chmod } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { launcherPostinstall } from "../script/postinstall"

// The fixture uses a POSIX executable; the Linux case also proves a missing macOS sidecar is harmless.
test.skipIf(process.platform === "win32").each([true, false])(
  "npm postinstall stages the renderer next to kilo2 when present (%s)",
  async (withRenderer) => {
    await using root = await tmpdir("kilo-postinstall-")
    const launcher = path.join(root.path, "node_modules/@kilocode/cli")
    const name = `@kilocode/cli-${process.platform}-${process.arch}`
    const platform = path.join(root.path, "node_modules", name)
    const source = path.join(platform, "bin/kilo2")
    await Bun.write(path.join(platform, "package.json"), JSON.stringify({ name, version: "0.0.0" }))
    await Bun.write(source, '#!/bin/sh\n[ "$1" = "--version" ]\n')
    await chmod(source, 0o755)
    if (withRenderer) await Bun.write(path.join(platform, "bin/libopentui.dylib"), "renderer contents")

    await Bun.write(
      path.join(launcher, "package.json"),
      JSON.stringify({ bin: { kilo2: "./bin/kilo2.exe" }, optionalDependencies: { [name]: "0.0.0" } }),
    )
    const entry = path.join(launcher, "postinstall.mjs")
    await Bun.write(entry, await launcherPostinstall())
    const result = Bun.spawnSync([process.execPath, entry], {
      cwd: launcher,
      env: { PATH: process.env.PATH, HOME: root.path, npm_config_offline: "true" },
      timeout: 10_000,
    })

    expect(result.exitCode, result.stderr.toString()).toBe(0)
    const installed = Bun.file(path.join(launcher, "bin/libopentui.dylib"))
    if (withRenderer) expect(await installed.text()).toBe("renderer contents")
    else expect(await installed.exists()).toBe(false)
  },
)
