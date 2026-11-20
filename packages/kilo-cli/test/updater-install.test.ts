import { NodeFileSystem } from "@effect/platform-node"
import { expect, test } from "bun:test"
import { Effect, FileSystem } from "effect"
import { copyFile, link, mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { detect, ownsGlobalBin, packageName, type CommandResult, type Exec } from "../src/updater-install"

const posix = process.platform === "win32" ? test.skip : test
const windows = process.platform === "win32" ? test : test.skip

const ok = (stdout: string): CommandResult => ({ code: 0, stdout, stderr: "" })

function fake(responses: Record<string, CommandResult | Error> = {}) {
  const calls: string[][] = []
  const exec: Exec = (command) =>
    Effect.suspend(() => {
      calls.push(command)
      const response = responses[command.join(" ")]
      if (response instanceof Error) return Effect.fail(response)
      if (!response) return Effect.fail(new Error(`unexpected command: ${command.join(" ")}`))
      return Effect.succeed(response)
    })
  return { calls, exec }
}

// Every fixture lives under the worktree's node_modules, and each test gets its own home, temp and XDG roots. Nothing
// reads or cleans a shared scratch directory, and no user session or installed CLI is touched.
const worktree = path.resolve(import.meta.dirname, "..", "..", "..")
const scratch = path.join(worktree, "node_modules", ".kilo-updater-install")
const isolated = [
  "TMPDIR",
  "TMP",
  "TEMP",
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
] as const

async function withTemp<A>(body: (directory: string) => Promise<A>) {
  await mkdir(scratch, { recursive: true })
  const directory = await mkdtemp(path.join(scratch, `run-${process.pid}-`))
  const tmp = path.join(directory, "tmp")
  const home = path.join(directory, "home")
  const values = {
    TMPDIR: tmp,
    TMP: tmp,
    TEMP: tmp,
    HOME: home,
    XDG_CONFIG_HOME: path.join(directory, "xdg", "config"),
    XDG_DATA_HOME: path.join(directory, "xdg", "data"),
    XDG_CACHE_HOME: path.join(directory, "xdg", "cache"),
    XDG_STATE_HOME: path.join(directory, "xdg", "state"),
  }
  await Promise.all(Object.values(values).map((value) => mkdir(value, { recursive: true })))
  const saved = isolated.map((key) => [key, process.env[key]] as const)
  Object.assign(process.env, values)
  try {
    return await body(directory)
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(directory, { recursive: true, force: true })
  }
}

async function install(directory: string, input: { version?: string; name?: string; bin?: string } = {}) {
  const executable = path.join(directory, "bin", "kilo2.exe")
  await mkdir(path.dirname(executable), { recursive: true })
  await writeFile(executable, "#!/bin/sh\n")
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: input.name ?? packageName,
      version: input.version ?? "0.0.0-v2-226",
      bin: { kilo2: input.bin ?? "./bin/kilo2.exe" },
    }),
  )
  return executable
}

async function legacyShim(directory: string, executable: string) {
  const file = path.join(directory, "kilo2")
  await mkdir(directory, { recursive: true })
  const relative = path.relative(directory, executable)
  await writeFile(
    file,
    String.raw`#!/bin/sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\,/,g')")

if [ -z "$NODE_PATH" ]; then
  export NODE_PATH="${path.dirname(executable)}"
else
  export NODE_PATH="${path.dirname(executable)}:$NODE_PATH"
fi
"$basedir/${relative}"   "$@"
exit $?
`,
  )
  return file
}

async function markedShim(directory: string, executable: string) {
  const file = path.join(directory, "kilo2")
  await mkdir(directory, { recursive: true })
  await writeFile(
    file,
    `#!/bin/sh\nexec "$basedir_abs"/'${path.relative(directory, executable)}' "$@"\nexit $?\n# cmd-shim-target=${executable}\n`,
  )
  return file
}

async function windowsShims(directory: string, executable: string) {
  await mkdir(directory, { recursive: true })
  const relative = path.relative(directory, executable)
  const command = relative.split("/").join("\\")
  await writeFile(path.join(directory, "kilo2"), `#!/bin/sh\nexec "$basedir/${relative}" "$@"\n`)
  await writeFile(path.join(directory, "kilo2.cmd"), `@SETLOCAL\r\n@"%~dp0\\${command}" %*\r\n`)
  await writeFile(path.join(directory, "kilo2.ps1"), `#!/usr/bin/env pwsh\n& "$basedir/${relative}" $args\n`)
}

async function pnpm10(directory: string) {
  const root = path.join(directory, "pnpm", "global", "5", "node_modules")
  const current = path.join(directory, "pnpm", "store", "@kilocode+cli@1")
  const manifest = path.join(root, "@kilocode", "cli")
  const executable = await install(current)
  await mkdir(path.dirname(manifest), { recursive: true })
  await symlink(current, manifest, "dir")
  const bin = path.join(directory, "pnpm", "bin")
  await mkdir(bin, { recursive: true })
  return { executable, bin, root }
}

const pnpm10Responses = (root: string, bin: string) => ({
  "pnpm --version": ok("10.5.0\n"),
  "pnpm root -g": ok(`${root}\n`),
  "pnpm bin -g": ok(`${bin}\n`),
})

const detected = (exec: Exec, executable: string) =>
  Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        return yield* detect(fs, exec, executable)
      }),
      NodeFileSystem.layer,
    ),
  )

const binOwned = (directory: string, executable: string, platform: string) =>
  Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        return yield* ownsGlobalBin(fs, directory, executable, platform)
      }),
      NodeFileSystem.layer,
    ),
  )

const npmArguments = (prefix: string, version: string) => [
  "npm",
  "install",
  "--global",
  "--prefix",
  prefix,
  "--registry=https://registry.npmjs.org",
  "--@kilocode:registry=https://registry.npmjs.org",
  "--allow-scripts=@kilocode/cli",
  `@kilocode/cli@${version}`,
]

posix("detects an npm global under a custom POSIX prefix", async () => {
  await withTemp(async (directory) => {
    const prefix = path.join(directory, "custom")
    const root = path.join(prefix, "lib", "node_modules", "@kilocode", "cli")
    const executable = await install(root)
    await mkdir(path.join(prefix, "bin"))
    await symlink(executable, path.join(prefix, "bin", "kilo2"))
    const canonical = await realpath(prefix)
    const { calls, exec } = fake({
      [`npm root -g --prefix ${canonical}`]: ok(`${path.join(canonical, "lib", "node_modules")}\n`),
    })

    const found = await detected(exec, executable)

    expect(found?.method).toBe("npm")
    expect(found?.manifest).toBe(path.join(canonical, "lib", "node_modules", "@kilocode", "cli", "package.json"))
    expect(found?.lockDirectory).toBe(canonical)
    expect(found?.command("0.0.0-v2-230.1")).toEqual([
      "npm",
      "install",
      "--global",
      "--prefix",
      canonical,
      "--registry=https://registry.npmjs.org",
      "--@kilocode:registry=https://registry.npmjs.org",
      "--allow-scripts=@kilocode/cli",
      "@kilocode/cli@0.0.0-v2-230.1",
    ])
    expect(calls).toEqual([["npm", "root", "-g", "--prefix", canonical]])
  })
})

windows("detects the Windows npm global layout", async () => {
  await withTemp(async (directory) => {
    const prefix = path.join(directory, "npm")
    const root = path.join(prefix, "node_modules", "@kilocode", "cli")
    const executable = await install(root)
    const canonical = await realpath(prefix)
    const { exec } = fake({ "npm root -g": ok(`${path.join(canonical, "node_modules")}\n`) })

    const found = await detected(exec, executable)

    expect(found?.method).toBe("npm")
    expect(found?.manifest).toBe(path.join(canonical, "node_modules", "@kilocode", "cli", "package.json"))
    expect(found?.lockDirectory).toBe(canonical)
    expect(found?.command("0.0.0-v2-231")).toEqual(npmArguments(canonical, "0.0.0-v2-231"))
  })
})

windows("rejects a project node_modules that is not npm's configured global root", async () => {
  await withTemp(async (directory) => {
    const project = path.join(directory, "project")
    const root = path.join(project, "node_modules", "@kilocode", "cli")
    const executable = await install(root)
    const { exec } = fake({ "npm root -g": ok(`${path.join(directory, "npm", "node_modules")}\n`) })

    expect(await detected(exec, executable)).toBeUndefined()
  })
})

posix("rejects an npm-shaped package that is not a global install", async () => {
  await withTemp(async (directory) => {
    const root = path.join(directory, "project", "lib", "node_modules", "@kilocode", "cli")
    const executable = await install(root)

    expect(await detected(fake().exec, executable)).toBeUndefined()
  })
})

test("rejects a manifest whose name is not the published package", async () => {
  await withTemp(async (directory) => {
    const root = path.join(directory, "custom", "lib", "node_modules", "@kilocode", "cli")
    const executable = await install(root, { name: "@kilocode/kilo-cli" })

    expect(await detected(fake().exec, executable)).toBeUndefined()
  })
})

test("rejects the v1 line that shares the package name before probing", async () => {
  await withTemp(async (directory) => {
    const root = path.join(directory, "custom", "lib", "node_modules", "@kilocode", "cli")
    const executable = await install(root, { version: "7.8.27" })
    const { calls, exec } = fake()

    expect(await detected(exec, executable)).toBeUndefined()
    expect(calls).toEqual([])
  })
})

test("rejects a package whose kilo2 bin is not the running executable", async () => {
  await withTemp(async (directory) => {
    const root = path.join(directory, "custom", "lib", "node_modules", "@kilocode", "cli")
    await install(root, { bin: "./bin/other" })

    expect(await detected(fake().exec, path.join(root, "bin", "kilo2.exe"))).toBeUndefined()
  })
})

posix("detects pnpm 10 through its global root and follows the package link to a new install", async () => {
  await withTemp(async (directory) => {
    const root = path.join(directory, "pnpm", "global", "5", "node_modules")
    const current = path.join(directory, "pnpm", "store", "@kilocode+cli@1")
    const manifest = path.join(root, "@kilocode", "cli")
    const executable = await install(current)
    await mkdir(path.dirname(manifest), { recursive: true })
    await symlink(current, manifest, "dir")
    const bin = path.join(directory, "pnpm", "bin")
    await legacyShim(bin, executable)
    const { exec } = fake({
      "pnpm --version": ok("10.5.0\n"),
      "pnpm root -g": ok(`${root}\n`),
      "pnpm bin -g": ok(`${bin}\n`),
    })

    const found = await detected(exec, executable)

    expect(found?.method).toBe("pnpm")
    expect(found?.manifest).toBe(path.join(manifest, "package.json"))
    expect(found?.lockDirectory).toBe(await realpath(path.dirname(root)))
    expect(found?.command("0.0.0-v2-232")).toEqual([
      "pnpm",
      "add",
      "--global",
      "--registry=https://registry.npmjs.org",
      "--@kilocode:registry=https://registry.npmjs.org",
      "--allow-build=@kilocode/cli",
      "@kilocode/cli@0.0.0-v2-232",
    ])

    // A later pnpm install replaces the root link. The returned manifest must describe what is installed now, not
    // the versioned store directory the running process was started from.
    const next = path.join(directory, "pnpm", "store", "@kilocode+cli@2")
    await install(next, { version: "0.0.0-v2-233" })
    await unlink(manifest)
    await symlink(next, manifest, "dir")
    expect(JSON.parse(await readFile(found!.manifest, "utf8")).version).toBe("0.0.0-v2-233")
  })
})

posix("keeps the pnpm 11 hash link as the manifest for a later global install", async () => {
  await withTemp(async (directory) => {
    const global = path.join(directory, "pnpm", "global", "v11")
    const link = path.join(global, "9f86d081")
    const current = path.join(global, "100-1")
    const packageDirectory = path.join(current, "node_modules", "@kilocode", "cli")
    const executable = await install(packageDirectory)
    await writeFile(
      path.join(current, "package.json"),
      JSON.stringify({ dependencies: { [packageName]: "0.0.0-v2-226" } }),
    )
    await symlink(current, link, "dir")
    const bin = path.join(directory, "pnpm", "bin")
    // pnpm points the shim at the stable hash link, not the disposable physical install directory.
    await markedShim(bin, path.join(link, "node_modules", "@kilocode", "cli", "bin", "kilo2.exe"))
    const { exec } = fake({
      "pnpm --version": ok("11.1.1\n"),
      // pnpm has written warnings to stdout before the path. The last absolute line is still the root.
      "pnpm root -g": ok(`WARN using --force\n${global}\n`),
      "pnpm bin -g": ok(`${bin}\n`),
    })

    const found = await detected(exec, executable)

    expect(found?.method).toBe("pnpm")
    expect(found?.manifest).toBe(path.join(link, "node_modules", "@kilocode", "cli", "package.json"))
    expect(found?.lockDirectory).toBe(await realpath(path.dirname(global)))

    const next = path.join(global, "200-2")
    await install(path.join(next, "node_modules", "@kilocode", "cli"), { version: "0.0.0-v2-236" })
    await writeFile(
      path.join(next, "package.json"),
      JSON.stringify({ dependencies: { [packageName]: "0.0.0-v2-236" } }),
    )
    await unlink(link)
    await symlink(next, path.join(global, "new-registry-hash"), "dir")
    const updated = await Effect.runPromise(found!.installedManifest!)
    expect(JSON.parse(await readFile(updated!, "utf8")).version).toBe("0.0.0-v2-236")
  })
})

posix("rejects a stale pnpm 10 root that the running pnpm 11 no longer updates", async () => {
  await withTemp(async (directory) => {
    const root = path.join(directory, "pnpm", "global", "5", "node_modules")
    const owner = path.join(directory, "pnpm", "store", "@kilocode+cli@1")
    const executable = await install(owner)
    const manifest = path.join(root, "@kilocode", "cli")
    await mkdir(path.dirname(manifest), { recursive: true })
    await symlink(owner, manifest, "dir")
    const { exec } = fake({ "pnpm --version": ok("11.1.1\n"), "pnpm root -g": ok(root) })

    expect(await detected(exec, executable)).toBeUndefined()
  })
})

posix("rejects a stale pnpm 11 physical install when the hash link points to another install", async () => {
  await withTemp(async (directory) => {
    const global = path.join(directory, "pnpm", "global", "v11")
    const stale = path.join(global, "100-1")
    const current = path.join(global, "200-2")
    const executable = await install(path.join(stale, "node_modules", "@kilocode", "cli"))
    await install(path.join(current, "node_modules", "@kilocode", "cli"), { version: "0.0.0-v2-237" })
    await symlink(current, path.join(global, "9f86d081"), "dir")
    const { exec } = fake({ "pnpm --version": ok("11.1.1\n"), "pnpm root -g": ok(`${global}\n`) })

    expect(await detected(exec, executable)).toBeUndefined()
  })
})

posix("rejects ambiguous pnpm 11 group links that both contain the package", async () => {
  await withTemp(async (directory) => {
    const global = path.join(directory, "pnpm", "global", "v11")
    const previous = path.join(global, "100-1")
    const current = path.join(global, "200-2")
    const executable = await install(path.join(previous, "node_modules", "@kilocode", "cli"))
    await install(path.join(current, "node_modules", "@kilocode", "cli"), { version: "0.0.0-v2-238" })
    await symlink(previous, path.join(global, "9f86d081"), "dir")
    await symlink(current, path.join(global, "0a1b2c3d"), "dir")
    for (const directory of [previous, current])
      await writeFile(path.join(directory, "package.json"), JSON.stringify({ dependencies: { [packageName]: "*" } }))
    const { exec } = fake({ "pnpm --version": ok("11.1.1\n"), "pnpm root -g": ok(global) })

    expect(await detected(exec, executable)).toBeUndefined()
  })
})

posix("does not replace a pnpm 11 group that also owns another package", async () => {
  await withTemp(async (directory) => {
    const global = path.join(directory, "pnpm", "global", "v11")
    const current = path.join(global, "100-1")
    const executable = await install(path.join(current, "node_modules", "@kilocode", "cli"))
    const other = path.join(current, "node_modules", "@kilocode", "other")
    await mkdir(other, { recursive: true })
    await writeFile(path.join(other, "package.json"), "{}")
    await writeFile(
      path.join(current, "package.json"),
      JSON.stringify({ dependencies: { [packageName]: "*", "@kilocode/other": "*" } }),
    )
    await symlink(current, path.join(global, "9f86d081"), "dir")
    const { exec } = fake({ "pnpm --version": ok("11.1.1\n"), "pnpm root -g": ok(global) })

    expect(await detected(exec, executable)).toBeUndefined()
  })
})

posix("rejects a pnpm 10 node_modules root under a pnpm 11 global directory", async () => {
  await withTemp(async (directory) => {
    const global = path.join(directory, "pnpm", "global", "v11")
    const root = path.join(global, "node_modules")
    const executable = await install(path.join(root, "@kilocode", "cli"))
    const { exec } = fake({ "pnpm --version": ok("11.1.1\n"), "pnpm root -g": ok(global) })

    expect(await detected(exec, executable)).toBeUndefined()
  })
})

posix("does not let a pnpm list entry stand in for exact ownership", async () => {
  await withTemp(async (directory) => {
    const root = path.join(directory, "pnpm", "global", "5", "node_modules")
    const owner = path.join(directory, "pnpm", "store", "@kilocode+cli@1")
    const other = path.join(directory, "pnpm", "store", "@kilocode+cli@2")
    await install(owner)
    const executable = await install(other)
    await mkdir(path.join(root, "@kilocode"), { recursive: true })
    await symlink(owner, path.join(root, "@kilocode", "cli"), "dir")
    const { calls, exec } = fake({ "pnpm --version": ok("10.5.0\n"), "pnpm root -g": ok(root) })

    expect(await detected(exec, executable)).toBeUndefined()
    expect(calls.some((command) => command.includes("list"))).toBe(false)
  })
})

posix("updates pnpm when the configured global bin slot is absent", async () => {
  await withTemp(async (directory) => {
    const { executable, bin, root } = await pnpm10(directory)
    const { exec } = fake(pnpm10Responses(root, bin))

    const found = await detected(exec, executable)

    expect(found?.method).toBe("pnpm")
    expect(found?.lockDirectory).toBe(await realpath(path.dirname(root)))
  })
})

posix("rejects a pnpm global bin slot that belongs to another install", async () => {
  await withTemp(async (directory) => {
    const { executable, bin, root } = await pnpm10(directory)
    const other = await install(path.join(directory, "other"))
    await symlink(other, path.join(bin, "kilo2"))
    const { exec } = fake(pnpm10Responses(root, bin))

    expect(await detected(exec, executable)).toBeUndefined()
  })
})

posix("rejects a pnpm global bin slot that is not a verifiable shim", async () => {
  await withTemp(async (directory) => {
    const { executable, bin, root } = await pnpm10(directory)
    await writeFile(path.join(bin, "kilo2"), '#!/bin/sh\nexec /opt/other/kilo2 "$@"\n')
    const { exec } = fake(pnpm10Responses(root, bin))

    expect(await detected(exec, executable)).toBeUndefined()

    await writeFile(path.join(bin, "kilo2"), "not a shim")
    expect(await detected(exec, executable)).toBeUndefined()
  })
})

posix("fails closed when pnpm reports no configured global bin directory", async () => {
  await withTemp(async (directory) => {
    const { executable, root } = await pnpm10(directory)
    // The launcher cannot be updated through pnpm when pnpm has no global bin directory configured.
    const { exec } = fake({ "pnpm --version": ok("10.5.0\n"), "pnpm root -g": ok(`${root}\n`) })

    expect(await detected(exec, executable)).toBeUndefined()
  })
})

posix("preserves owned pnpm Windows shims and rejects foreign slots", async () => {
  await withTemp(async (directory) => {
    const executable = await install(path.join(directory, "install"))
    const other = await install(path.join(directory, "other"))
    const bin = path.join(directory, "bin")
    await windowsShims(bin, executable)

    expect(await binOwned(bin, executable, "win32")).toBe(true)

    // npm's cmd shims use %dp0% and also reference the same native target.
    const own = path.relative(bin, executable).split("/").join("\\")
    await writeFile(path.join(bin, "kilo2.cmd"), `@ECHO off\r\n"%dp0%\\${own}" %*\r\n`)
    expect(await binOwned(bin, executable, "win32")).toBe(true)

    await windowsShims(bin, executable)
    const foreign = path.relative(bin, other).split("/").join("\\")
    await writeFile(path.join(bin, "kilo2.cmd"), `@SETLOCAL\r\n@"%~dp0\\${foreign}" %*\r\n`)
    expect(await binOwned(bin, executable, "win32")).toBe(false)

    await windowsShims(bin, executable)
    await copyFile(executable, path.join(bin, "kilo2.exe"))
    expect(await binOwned(bin, executable, "win32")).toBe(false)

    await unlink(path.join(bin, "kilo2.exe"))
    await symlink(executable, path.join(bin, "kilo2.exe"))
    expect(await binOwned(bin, executable, "win32")).toBe(true)
  })
})

posix("requires the pnpm shim invocation and marker to agree with the verified executable", async () => {
  await withTemp(async (directory) => {
    const executable = await install(path.join(directory, "install"))
    const other = await install(path.join(directory, "other"))
    const bin = path.join(directory, "bin")
    const file = path.join(bin, "kilo2")
    await mkdir(bin, { recursive: true })
    const relative = (target: string) => path.relative(bin, target)

    await writeFile(
      file,
      `#!/bin/sh\nexec "$basedir_abs"/'${relative(other)}' "$@"\nexit $?\n# cmd-shim-target=${executable}\n`,
    )
    expect(await binOwned(bin, executable, "linux")).toBe(false)

    await writeFile(
      file,
      `#!/bin/sh\nexec "$basedir_abs"/'${relative(executable)}' "$@"\nexit $?\n# cmd-shim-target=${other}\n`,
    )
    expect(await binOwned(bin, executable, "linux")).toBe(false)

    // A marker without a supported invocation, a path in a comment, and a non-shim file do not count.
    await writeFile(file, `#!/bin/sh\necho ok\n# cmd-shim-target=${executable}\n`)
    expect(await binOwned(bin, executable, "linux")).toBe(false)

    await writeFile(file, `#!/bin/sh\nexec "${other}" "$@"\n# cmd-shim-target=${executable}\n`)
    expect(await binOwned(bin, executable, "linux")).toBe(false)

    await writeFile(file, `#!/bin/sh\nexec echo "$basedir/${relative(executable)}" "$@"\n`)
    expect(await binOwned(bin, executable, "linux")).toBe(false)

    await writeFile(file, `#!/bin/sh\n# "$basedir/${relative(executable)}"\nexec /opt/other/kilo2 "$@"\n`)
    expect(await binOwned(bin, executable, "linux")).toBe(false)

    const owned = `#!/bin/sh\nexec "$basedir_abs"/'${relative(executable)}' "$@"\nexit $?\n# cmd-shim-target=${executable}\n`
    await writeFile(file, owned)
    expect(await binOwned(bin, executable, "linux")).toBe(true)

    // Anything larger than a generated shim is rejected before its text is read.
    await writeFile(file, owned + "x".repeat(65 * 1024))
    expect(await binOwned(bin, executable, "linux")).toBe(false)
  })
})

posix("accepts a pnpm Windows executable slot that is a hard link to the verified file", async () => {
  await withTemp(async (directory) => {
    const executable = await install(path.join(directory, "install"))
    const bin = path.join(directory, "bin")
    await mkdir(bin, { recursive: true })
    await link(executable, path.join(bin, "kilo2.exe"))

    expect(await binOwned(bin, executable, "win32")).toBe(true)
  })
})

posix("leaves Bun globals to manual updates because its scoped registry cannot be forced", async () => {
  await withTemp(async (directory) => {
    const root = path.join(directory, "bun", "install", "global", "node_modules", "@kilocode", "cli")
    const executable = await install(root)
    const bin = path.join(directory, "bun", "bin")
    await mkdir(bin, { recursive: true })
    await symlink(executable, path.join(bin, "kilo2"))
    const { calls, exec } = fake({ "bun pm bin -g": ok(`${bin}\n`) })

    expect(await detected(exec, executable)).toBeUndefined()
    expect(calls.some((command) => command[0] === "bun")).toBe(false)
  })
})

posix("detects Yarn Classic through its global directory and owning bin prefix", async () => {
  await withTemp(async (directory) => {
    const home = path.join(directory, "yarn", "global")
    const root = path.join(home, "node_modules", "@kilocode", "cli")
    const executable = await install(root)
    const prefix = path.join(directory, "commands")
    const bin = path.join(prefix, "bin")
    await mkdir(bin, { recursive: true })
    await symlink(executable, path.join(bin, "kilo2"))
    const yarn = {
      "yarn --no-default-rc --version": ok("1.22.22\n"),
      "yarn --no-default-rc global dir": ok(`${home}\n`),
      "yarn --no-default-rc global bin": ok(`${bin}\n`),
      "yarn --no-default-rc config get @kilocode:registry": ok("undefined\n"),
    }
    const { exec } = fake(yarn)

    const found = await detected(exec, executable)

    expect(found?.method).toBe("yarn")
    expect(found?.manifest).toBe(path.join(root, "package.json"))
    expect(found?.lockDirectory).toBe(await realpath(home))
    // The script policy is read with the user rc enabled, while the install command stays rc-free for registry
    // pinning. A user who configured ignore-scripts must not have scripts run behind their back.
    expect(found?.scriptsSetting).toEqual(["yarn", "config", "get", "ignore-scripts"])
    expect(found?.command("0.0.0-v2-235")).toEqual([
      "yarn",
      "--no-default-rc",
      "global",
      "add",
      "--prefix",
      prefix,
      "--registry",
      "https://registry.npmjs.org",
      "@kilocode/cli@0.0.0-v2-235",
    ])
    const custom = fake({
      ...yarn,
      "yarn --no-default-rc config get @kilocode:registry": ok("https://mirror.example/\n"),
    })
    expect(await detected(custom.exec, executable)).toBeUndefined()
    const other = await install(path.join(directory, "another-install"))
    await unlink(path.join(bin, "kilo2"))
    await symlink(other, path.join(bin, "kilo2"))
    expect(await detected(exec, executable)).toBeUndefined()
  })
})

test("rejects Yarn Berry and missing global directories", async () => {
  await withTemp(async (directory) => {
    const root = path.join(directory, "global", "node_modules", "@kilocode", "cli")
    const executable = await install(root)

    expect(await detected(fake({ "yarn --no-default-rc --version": ok("4.5.0\n") }).exec, executable)).toBeUndefined()
    expect(
      await detected(
        fake({
          "yarn --no-default-rc --version": ok("1.22.22\n"),
          "yarn --no-default-rc global dir": ok(`${path.dirname(root)}\n`),
        }).exec,
        executable,
      ),
    ).toBeUndefined()
  })
})

test("fails closed for Volta, mise, standalone and unverifiable copies", async () => {
  await withTemp(async (directory) => {
    const roots = [
      path.join(directory, "volta", "tools", "image", "packages", "@kilocode", "cli"),
      path.join(directory, "mise", "installs", "npm-@kilocode", "cli"),
      path.join(directory, "standalone", "releases", "release-1"),
    ]
    for (const root of roots) {
      const executable = await install(root)
      expect(await detected(fake().exec, executable)).toBeUndefined()
    }

    const standalone = path.join(directory, "standalone", "bin", "kilo2")
    await mkdir(path.dirname(standalone), { recursive: true })
    await writeFile(standalone, "binary")
    expect(await detected(fake().exec, standalone)).toBeUndefined()
  })
})
