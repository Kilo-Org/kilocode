import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Npm } from "@opencode/util/npm"
import { Effect } from "effect"
import { resolve } from "../src/marketplace/plugin-package"

const packageJSON = (input: { name: string; exports?: Record<string, string> }) =>
  JSON.stringify({ name: input.name, ...(input.exports ? { exports: input.exports } : {}) })

async function repository(files: Record<string, string>) {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-marketplace-plugin-package-")))
  await $`git init -q -b main`.cwd(dir).quiet()
  await $`git config user.email test@example.com`.cwd(dir).quiet()
  await $`git config user.name Test`.cwd(dir).quiet()
  await $`git config commit.gpgsign false`.cwd(dir).quiet()
  for (const [relative, text] of Object.entries(files)) {
    const file = path.join(dir, relative)
    await mkdir(path.dirname(file), { recursive: true })
    await Bun.write(file, text)
  }
  await $`git add -A`.cwd(dir).quiet()
  await $`git commit -q -m commit`.cwd(dir).quiet()
  return { path: dir, [Symbol.asyncDispose]: () => rm(dir, { recursive: true, force: true }) }
}

function npm(input: { directory: string; name: string; failure?: Error }): Npm.Interface {
  return {
    add: () =>
      input.failure
        ? Effect.fail(input.failure as never)
        : Effect.succeed({ directory: input.directory, name: input.name }),
    resolve: () => Effect.die("unused"),
    check: () => Effect.die("unused"),
    update: () => Effect.die("unused"),
    which: () => Effect.die("unused"),
  }
}

/** An installed npm package laid out the way npm places one: `node_modules/<name>` under the package root. */
async function installed(name: string, exports: Record<string, string> | undefined) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-marketplace-npm-")))
  const directory = path.join(root, "node_modules", name)
  await mkdir(directory, { recursive: true })
  await Bun.write(path.join(directory, "package.json"), packageJSON({ name, exports }))
  for (const file of Object.values(exports ?? {})) await Bun.write(path.join(directory, file), "export default {}\n")
  return { root, directory, [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }) }
}

describe("plugin package resolution", () => {
  test("resolves an npm package to its installed directory", async () => {
    await using target = await installed("kilo-plugin", { "./server": "./server.js" })
    const resolved = await Effect.runPromise(
      resolve({ spec: "kilo-plugin@1.2.3", npm: npm({ directory: target.directory, name: "kilo-plugin" }) }),
    )
    expect(resolved.directory).toBe(target.directory)
  })
  test("rejects a package with no server or GUI entrypoint", async () => {
    await using target = await installed("empty-plugin", undefined)
    await expect(
      Effect.runPromise(
        resolve({ spec: "empty-plugin", npm: npm({ directory: target.directory, name: "empty-plugin" }) }),
      ),
    ).rejects.toMatchObject({ reason: "invalid_params" })
  })
  test("rejects a TUI-only package", async () => {
    await using target = await installed("tui-plugin", { "./tui": "./tui.js" })
    const failure = await Effect.runPromise(
      resolve({ spec: "tui-plugin", npm: npm({ directory: target.directory, name: "tui-plugin" }) }).pipe(Effect.flip),
    )
    expect(failure).toMatchObject({
      reason: "invalid_params",
      message: "Plugin package has no server or GUI entrypoint: tui-plugin",
    })
  })
  test("fails installs that npm cannot complete", async () => {
    const failure = await Effect.runPromise(
      resolve({
        spec: "kilo-plugin",
        npm: npm({ directory: "/nowhere", name: "kilo-plugin", failure: new Error("registry unavailable") }),
      }).pipe(Effect.flip),
    )
    expect(failure).toMatchObject({ reason: "fetch_failed" })
    expect(failure.message).toContain("registry unavailable")
  })
  test("rejects a target that is neither a registry nor a git package", async () => {
    const failure = await Effect.runPromise(
      resolve({ spec: "./local-directory", npm: npm({ directory: "/nowhere", name: "x" }) }).pipe(Effect.flip),
    )
    expect(failure).toMatchObject({
      reason: "invalid_params",
      message: "Plugin target must be an npm registry package or Git package specifier",
    })
  })
  test("clones and resolves a git package", async () => {
    await using repo = await repository({
      "package.json": packageJSON({ name: "git-plugin", exports: { "./server": "./server.js" } }),
      "server.js": "export default {}\n",
    })
    const resolved = await Effect.runPromise(
      resolve({ spec: `git:${repo.path}`, npm: npm({ directory: "/nowhere", name: "x" }) }),
    )
    expect(resolved.directory).toContain("packages/git")
    expect(await Bun.file(path.join(resolved.directory, "server.js")).exists()).toBe(true)
  })
  test("rejects a git package without an entrypoint and a missing repository", async () => {
    await using bare = await repository({ "package.json": packageJSON({ name: "bare-plugin" }) })
    await expect(
      Effect.runPromise(resolve({ spec: `git:${bare.path}`, npm: npm({ directory: "/nowhere", name: "x" }) })),
    ).rejects.toMatchObject({ reason: "invalid_params" })
    const missing = path.join(await mkdtemp(path.join(os.tmpdir(), "kilo-marketplace-missing-")), "absent")
    const failure = await Effect.runPromise(
      resolve({ spec: `git:${missing}`, npm: npm({ directory: "/nowhere", name: "x" }) }).pipe(Effect.flip),
    )
    expect(failure).toMatchObject({ reason: "fetch_failed" })
  })
})
