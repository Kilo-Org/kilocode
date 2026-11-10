import { expect, test } from "bun:test"
import { $ } from "bun"
import { Effect } from "effect"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Npm } from "@opencode/util/npm"
import { KiloPluginNpm } from "../src/plugin-npm"

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
    JSON.stringify({ name: "npm-wrapper-probe", exports: { "./server": "./server.js" } }),
  )
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
    expect(installed).toEqual({
      directory: expect.stringContaining("packages/git/"),
      name: "npm-wrapper-probe",
    })
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

test("reports a failed git clone as an npm install failure", async () => {
  const { npm } = native()
  const service = KiloPluginNpm.wrap(npm)
  const token = `kilo-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const error = await Effect.runPromise(service.add(`git:/tmp/${token}`).pipe(Effect.flip))
  expect(error).toBeInstanceOf(Npm.InstallFailedError)
  expect((error as Npm.InstallFailedError).add).toEqual([`git:/tmp/${token}`])
})
