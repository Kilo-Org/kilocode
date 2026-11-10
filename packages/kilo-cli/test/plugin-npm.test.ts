import { expect, test } from "bun:test"
import { $ } from "bun"
import { Effect } from "effect"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PluginGitSource } from "@kilocode/kilo-plugin/plugin/git-source"
import { Host } from "@opencode/plugin/host"
import { Npm } from "@opencode/util/npm"
import { KiloPluginNpm } from "../src/plugin-npm"

// Paths differ by separator per platform; compare and assert on one spelling.
const slash = (value: string) => value.replaceAll("\\", "/")

// The native npm service, recording what reached it. A `git:` spec must never reach these.
const native = () => {
  const calls: string[] = []
  const pkg = (name: string) => ({ directory: `/native/${name}`, name })
  const npm: Npm.Interface = {
    add: (name) => Effect.sync(() => (calls.push(`add:${name}`), pkg(name))),
    resolve: (name) => Effect.sync(() => (calls.push(`resolve:${name}`), pkg(name))),
    check: (name) => Effect.sync(() => (calls.push(`check:${name}`), false)),
    update: (name) => Effect.sync(() => (calls.push(`update:${name}`), pkg(name))),
    which: (name) => Effect.sync(() => (calls.push(`which:${name}`), undefined)),
  }
  return { npm, calls }
}

async function repository() {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-plugin-npm-")))
  await mkdir(directory, { recursive: true })
  await $`git init -q -b main`.cwd(directory).quiet()
  await $`git config user.email test@example.com`.cwd(directory).quiet()
  await $`git config user.name Test`.cwd(directory).quiet()
  await $`git config commit.gpgsign false`.cwd(directory).quiet()
  await Bun.write(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: "npm-wrapper-probe",
      exports: { "./server": "./server.js", "./tui": "./server.js" },
    }),
  )
  await Bun.write(path.join(directory, "server.js"), "export default { id: 'npm-wrapper-probe' }\n")
  await $`git add -A`.cwd(directory).quiet()
  await $`git commit -q -m plugin`.cwd(directory).quiet()
  return directory
}

test("resolves a git plugin spec from the clone cache and leaves npm specs to npm", async () => {
  const directory = await repository()
  const { npm, calls } = native()
  const service = KiloPluginNpm.wrap(npm)
  try {
    const installed = await Effect.runPromise(service.add(`git:${directory}`))
    expect(slash(installed.directory)).toContain("packages/git/")
    // No package name is supplied, so `Host.resolve` reads the clone's own manifest like the server's directory path.
    expect(installed.name).toBe("")
    expect(Host.resolve(installed).tui).toBeDefined()
    // `resolve` reads the same cache the server loaded, so the TUI does not send the spec to npm.
    expect(await Effect.runPromise(service.resolve(`git:${directory}`))).toEqual(installed)
    // A git plugin has no registry to compare with, and an update is a clone refresh.
    expect(await Effect.runPromise(service.check(`git:${directory}`))).toBe(false)
    expect(await Effect.runPromise(service.update(`git:${directory}`))).toEqual(installed)

    expect(await Effect.runPromise(service.add("@scope/plugin@1"))).toEqual({
      directory: "/native/@scope/plugin@1",
      name: "@scope/plugin@1",
    })
    expect(await Effect.runPromise(service.resolve("plain-plugin"))).toEqual({
      directory: "/native/plain-plugin",
      name: "plain-plugin",
    })
    expect(await Effect.runPromise(service.check("plain-plugin"))).toBe(false)
    expect(await Effect.runPromise(service.which("plain-plugin"))).toBeUndefined()

    expect(calls).toEqual([
      "add:@scope/plugin@1",
      "resolve:plain-plugin",
      "check:plain-plugin",
      "which:plain-plugin",
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("reads the cache on the resolve path instead of cloning", async () => {
  const directory = await repository()
  const { npm, calls } = native()
  const service = KiloPluginNpm.wrap(npm)
  try {
    // Nothing is cached yet: `resolve` reports the directory a clone would use, like `Npm.resolve` does for a
    // package that is not installed, and never goes to the network.
    const reported = await Effect.runPromise(service.resolve(`git:${directory}`))
    expect(reported.directory).toBe(PluginGitSource.cacheDirectory(`git:${directory}`)!)
    expect(slash(reported.directory)).toContain("packages/git/")
    expect(await Bun.file(reported.directory).exists()).toBe(false)
    expect(calls).toEqual([])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("an explicit update fetches even inside the clone refresh window", async () => {
  const directory = await repository()
  const { npm } = native()
  const service = KiloPluginNpm.wrap(npm)
  try {
    const installed = await Effect.runPromise(service.add(`git:${directory}`))
    expect(await Bun.file(path.join(installed.directory, "later.txt")).exists()).toBe(false)
    await Bun.write(path.join(directory, "later.txt"), "later\n")
    await $`git add -A`.cwd(directory).quiet()
    await $`git commit -q -m later`.cwd(directory).quiet()

    const updated = await Effect.runPromise(service.update(`git:${directory}`))
    expect(updated.directory).toBe(installed.directory)
    expect(await Bun.file(path.join(updated.directory, "later.txt")).exists()).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("reports a failed git clone as an npm install failure", async () => {
  const { npm } = native()
  const service = KiloPluginNpm.wrap(npm)
  const token = `kilo-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const error = await Effect.runPromise(service.add(`git:/tmp/${token}`).pipe(Effect.flip))
  expect(error).toBeInstanceOf(Npm.InstallFailedError)
  expect((error as Npm.InstallFailedError).add).toEqual([`git:/tmp/${token}`])
})
