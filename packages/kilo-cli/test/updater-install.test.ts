import { NodeFileSystem } from "@effect/platform-node"
import { expect, test } from "bun:test"
import { Effect, FileSystem } from "effect"
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { detect, packageName, type CommandResult, type Exec } from "../src/updater-install"

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

async function withTemp<A>(body: (directory: string) => Promise<A>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-updater-install-"))
  try {
    return await body(directory)
  } finally {
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
    const { exec } = fake({ "pnpm --version": ok("10.5.0\n"), "pnpm root -g": ok(`${root}\n`) })

    const found = await detected(exec, executable)

    expect(found?.method).toBe("pnpm")
    expect(found?.manifest).toBe(path.join(manifest, "package.json"))
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
    const { exec } = fake({
      "pnpm --version": ok("11.1.1\n"),
      // pnpm has written warnings to stdout before the path. The last absolute line is still the root.
      "pnpm root -g": ok(`WARN using --force\n${global}\n`),
    })

    const found = await detected(exec, executable)

    expect(found?.method).toBe("pnpm")
    expect(found?.manifest).toBe(path.join(link, "node_modules", "@kilocode", "cli", "package.json"))

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
