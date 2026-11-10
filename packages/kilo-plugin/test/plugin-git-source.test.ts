import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, utimes } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { PluginModule } from "@opencode/core/plugin/module"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { PluginGitSource } from "../src/plugin/git-source"

async function repo(
  files: Record<string, string>,
  init?: (dir: string) => Promise<void>,
  message = "commit",
) {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-git-plugin-")))
  await $`git init -q -b main`.cwd(dir).quiet()
  await $`git config user.email test@example.com`.cwd(dir).quiet()
  await $`git config user.name Test`.cwd(dir).quiet()
  await $`git config commit.gpgsign false`.cwd(dir).quiet()
  await commit(dir, files, message)
  if (init) await init(dir)
  return { path: dir, [Symbol.asyncDispose]: () => rm(dir, { recursive: true, force: true }) }
}

async function commit(dir: string, files: Record<string, string>, message = "commit") {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(dir, rel)
    await mkdir(path.dirname(file), { recursive: true })
    await Bun.write(file, text)
  }
  await $`git add -A`.cwd(dir).quiet()
  await $`git commit -q -m ${message}`.cwd(dir).quiet()
}

const plugin = JSON.stringify({ name: "git-plugin", exports: { "./server": "./server.js" } })
const source = "export default { id: 'git-plugin', server: () => ({}) }\n"

describe("git plugin spec parsing", () => {
  test("parses repo, ref, and subpath", () => {
    expect(PluginGitSource.parseGitPluginSpec("git:github.com/owner/repo")).toEqual({
      repo: "github.com/owner/repo",
      ref: undefined,
      subpath: undefined,
    })
    expect(PluginGitSource.parseGitPluginSpec("git:github.com/owner/repo@v1.2.3")).toEqual({
      repo: "github.com/owner/repo",
      ref: "v1.2.3",
      subpath: undefined,
    })
    expect(PluginGitSource.parseGitPluginSpec("git:github.com/owner/repo#plugins/my-plugin")).toEqual({
      repo: "github.com/owner/repo",
      ref: undefined,
      subpath: "plugins/my-plugin",
    })
    expect(PluginGitSource.parseGitPluginSpec("git:https://github.com/owner/repo.git@main#sub/dir")).toEqual({
      repo: "https://github.com/owner/repo.git",
      ref: "main",
      subpath: "sub/dir",
    })
    expect(PluginGitSource.parseGitPluginSpec("git:file:///tmp/repo")).toEqual({
      repo: "file:///tmp/repo",
      ref: undefined,
      subpath: undefined,
    })
    expect(PluginGitSource.parseGitPluginSpec("git:/tmp/repo")).toEqual({
      repo: "/tmp/repo",
      ref: undefined,
      subpath: undefined,
    })
  })

  test("rejects npm specs, empty repos, and embedded user info", () => {
    expect(PluginGitSource.parseGitPluginSpec("pkg@1.2.3")).toBeUndefined()
    expect(PluginGitSource.parseGitPluginSpec("git:")).toBeUndefined()
    expect(PluginGitSource.parseGitPluginSpec("git:user@host/repo@main")).toBeUndefined()
  })

  test("leaves the npm git protocol to npm", () => {
    // `git://host/repo` is a valid npm Git dependency; taking it as a Kilo spec would clone a bogus local path.
    expect(PluginGitSource.isGitPluginSpec("git://github.com/owner/repo")).toBe(false)
    expect(PluginGitSource.parseGitPluginSpec("git://github.com/owner/repo")).toBeUndefined()
    expect(PluginGitSource.isGitPluginSpec("git:github.com/owner/repo")).toBe(true)
  })

  test("rejects option-injection refs and malformed repos", () => {
    expect(PluginGitSource.parseGitPluginSpec("git:github.com/owner/repo@--upload-pack=/bin/sh")).toBeUndefined()
    expect(PluginGitSource.parseGitPluginSpec("git:github.com/owner/repo@-x")).toBeUndefined()
    expect(PluginGitSource.parseGitPluginSpec("git:github.com/owner/repo@feat..ure")).toBeUndefined()
    expect(PluginGitSource.parseGitPluginSpec("git:https://user:pass@host/repo")).toBeUndefined()
    expect(PluginGitSource.parseGitPluginSpec("git:git@github.com:owner/repo")).toBeUndefined()
    expect(PluginGitSource.parseGitPluginSpec("git:vendor/plugin")).toBeUndefined()
  })

  test("normalizes identity without scheme or .git suffix", () => {
    expect(PluginGitSource.gitPluginIdentity("git:github.com/owner/repo")).toBe("git/github.com/owner/repo")
    expect(PluginGitSource.gitPluginIdentity("git:https://github.com/owner/repo.git")).toBe(
      "git/github.com/owner/repo",
    )
    expect(PluginGitSource.gitPluginIdentity("git:github.com/owner/repo@v1.2.3")).toBe("git/github.com/owner/repo")
    expect(PluginGitSource.gitPluginIdentity("git:github.com/owner/repo#plugins/my-plugin")).toBe(
      "git/github.com/owner/repo/plugins/my-plugin",
    )
    expect(PluginGitSource.gitPluginIdentity("git:https://github.com/owner/repo.git@main#sub/dir")).toBe(
      "git/github.com/owner/repo/sub/dir",
    )
    expect(PluginGitSource.gitPluginIdentity("git:file:///tmp/repo")).toBe("git/tmp/repo")
    expect(PluginGitSource.gitPluginIdentity("git:/tmp/repo")).toBe("git/tmp/repo")
    // A trailing slash must not defeat the `.git` normalization.
    expect(PluginGitSource.gitPluginIdentity("git:github.com/owner/repo.git/")).toBe("git/github.com/owner/repo")
  })

  test("keeps a backslash in a POSIX path identity", () => {
    if (process.platform === "win32") return
    // On POSIX a backslash is a legal filename character, not a separator.
    expect(PluginGitSource.gitPluginIdentity("git:/tmp/repo\\name")).toBe("git/tmp/repo\\name")
  })

  test("normalizes Windows paths and their file URL form to one identity", () => {
    expect(PluginGitSource.gitPluginIdentity("git:C:\\repo")).toBe("git/C:/repo")
    expect(PluginGitSource.gitPluginIdentity("git:file:///C:/repo")).toBe("git/C:/repo")
  })

  test("namespaces git identities away from npm names and local paths", () => {
    // A git plugin and a local path of the same text must not collapse onto one installed-state key, or
    // removing one would drop the other.
    expect(PluginGitSource.gitPluginIdentity("git:/tmp/repo")).toBe("git/tmp/repo")
    expect(PluginGitSource.gitPluginIdentity("git:/tmp/repo")).not.toBe("/tmp/repo")
    expect(PluginGitSource.gitPluginIdentity("git:github.com/owner/repo")).not.toBe("repo")
  })

  test("normalizes a repository to one canonical identity", () => {
    // A URL folds its scheme, host case and default port, so one repository has one identity and one deny resource.
    expect(PluginGitSource.gitPluginIdentity("git:https://github.com:443/owner/repo")).toBe("git/github.com/owner/repo")
    expect(PluginGitSource.gitPluginIdentity("git:http://github.com:80/owner/repo")).toBe("git/github.com/owner/repo")
    if (process.platform !== "win32")
      expect(PluginGitSource.gitPluginIdentity("git:https://GitHub.com/owner/repo")).toBe("git/github.com/owner/repo")
    // A subpath normalizes, so `#./plugins/x` names the same plugin as `#plugins/x`.
    expect(PluginGitSource.gitPluginIdentity("git:github.com/owner/repo#./plugins/x")).toBe(
      "git/github.com/owner/repo/plugins/x",
    )
    expect(PluginGitSource.gitPluginIdentity("git:github.com/owner/repo#plugins//x")).toBe(
      "git/github.com/owner/repo/plugins/x",
    )
  })

  test("rejects a subpath that leaves the clone", () => {
    expect(PluginGitSource.parseGitPluginSpec("git:github.com/owner/repo#../etc")).toBeUndefined()
    expect(PluginGitSource.parseGitPluginSpec("git:github.com/owner/repo#plugins/../../etc")).toBeUndefined()
  })
})

describe("git plugin resolution", () => {
  test("clones a local repo, resolves the subpath, and drops .git", async () => {
    await using fixture = await repo({
      "package.json": plugin,
      "server.js": source,
      "plugins/my-plugin/package.json": JSON.stringify({
        name: "my-plugin",
        exports: { "./server": "./server.js" },
      }),
      "plugins/my-plugin/server.js": source,
    })

    const out = await PluginGitSource.resolveGitPluginTarget(`git:${fixture.path}#plugins/my-plugin`)
    expect(out.ok).toBe(true)
    if (!out.ok) return

    expect(path.isAbsolute(out.target)).toBe(true)
    expect(out.target).not.toBe(fixture.path)
    expect(path.basename(out.target)).toBe("my-plugin")
    expect(await Bun.file(path.join(out.target, "package.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(out.target, ".git")).exists()).toBe(false)
    const rel = fixture.path.replace(/\\/g, "/").replace(/^\/+/, "")
    expect(PluginGitSource.gitPluginIdentity(`git:${fixture.path}#plugins/my-plugin`)).toBe(
      `git/${rel}/plugins/my-plugin`,
    )

    // The `file://` URL form of a local repo resolves to the same cache target.
    const fileUrl = await PluginGitSource.resolveGitPluginTarget(
      `git:${pathToFileURL(fixture.path).href}#plugins/my-plugin`,
    )
    expect(fileUrl.ok).toBe(true)
    if (fileUrl.ok) expect(fileUrl.target).toBe(out.target)

    const bad = await PluginGitSource.resolveGitPluginTarget(`git:${fixture.path}#missing-dir`)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.code).toBe("subpath_missing")
  })

  test("checks out a requested ref from a shallow clone", async () => {
    await using fixture = await repo(
      { "package.json": JSON.stringify({ name: "git-plugin", version: "1.0.0" }), "server.js": source },
      async (dir) => {
        await $`git tag v1`.cwd(dir).quiet()
        await commit(dir, { "package.json": JSON.stringify({ name: "git-plugin", version: "2.0.0" }) }, "two")
      },
      "one",
    )

    const out = await PluginGitSource.resolveGitPluginTarget(`git:${fixture.path}@v1`)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect((await Bun.file(path.join(out.target, "package.json")).json()).version).toBe("1.0.0")

    // Same repo, default branch: the cached clone of the other ref is not reused.
    const head = await PluginGitSource.resolveGitPluginTarget(`git:${fixture.path}`)
    expect(head.ok).toBe(true)
    if (!head.ok) return
    expect((await Bun.file(path.join(head.target, "package.json")).json()).version).toBe("2.0.0")
  })

  test("keeps different refs of one repo in separate cache entries", async () => {
    await using fixture = await repo(
      { "package.json": JSON.stringify({ name: "git-plugin", version: "1.0.0" }) },
      async (dir) => {
        await $`git tag v1`.cwd(dir).quiet()
        await commit(dir, { "package.json": JSON.stringify({ name: "git-plugin", version: "2.0.0" }) }, "two")
        await $`git tag v2`.cwd(dir).quiet()
      },
      "one",
    )

    const a = await PluginGitSource.resolveGitPluginTarget(`git:${fixture.path}@v1`)
    const b = await PluginGitSource.resolveGitPluginTarget(`git:${fixture.path}@v2`)
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(a.target).not.toBe(b.target)
    expect((await Bun.file(path.join(a.target, "package.json")).json()).version).toBe("1.0.0")
    expect((await Bun.file(path.join(b.target, "package.json")).json()).version).toBe("2.0.0")
  })

  test("rejects a symlinked subpath that escapes the clone", async () => {
    await using outside = await repo({ "package.json": plugin, "server.js": source })
    await using fixture = await repo(
      { "package.json": plugin, "server.js": source },
      async (dir) => {
        await symlink(outside.path, path.join(dir, "escape"))
        await $`git add -A`.cwd(dir).quiet()
        await $`git commit -q -m escape`.cwd(dir).quiet()
      },
    )

    const out = await PluginGitSource.resolveGitPluginTarget(`git:${fixture.path}#escape`)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe("subpath_missing")
  })

  test("removes the staging directory after a failed clone", async () => {
    const token = `kilo-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const out = await PluginGitSource.resolveGitPluginTarget(`git:/tmp/${token}`)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe("clone_failed")

    const root = path.join(Global.Path.cache, "packages", "git")
    const entries = await readdir(root).catch(() => [] as string[])
    expect(entries.filter((entry) => entry.includes(token))).toEqual([])
  })

  test("reads only a fresh cached clone when a refresh is not allowed", async () => {
    await using fixture = await repo({ "package.json": plugin, "server.js": source })
    const spec = `git:${fixture.path}`

    const cold = await PluginGitSource.resolveGitPluginTarget(spec, { refresh: false })
    expect(cold.ok).toBe(false)
    if (!cold.ok) expect(cold.code).toBe("not_cached")

    expect((await PluginGitSource.resolveGitPluginTarget(spec)).ok).toBe(true)
    const warm = await PluginGitSource.resolveGitPluginTarget(spec, { refresh: false })
    expect(warm.ok).toBe(true)
  })

  test("shares one clone between subpaths of one repository", async () => {
    await using fixture = await repo({
      "package.json": plugin,
      "a/package.json": JSON.stringify({ name: "a", exports: { "./server": "./server.js" } }),
      "a/server.js": source,
      "b/package.json": JSON.stringify({ name: "b", exports: { "./server": "./server.js" } }),
      "b/server.js": source,
    })

    const a = await PluginGitSource.resolveGitPluginTarget(`git:${fixture.path}#a`)
    const b = await PluginGitSource.resolveGitPluginTarget(`git:${fixture.path}#b`)
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    // A subpath is resolved inside one clone, so a repository with several plugins is cloned once.
    expect(path.dirname(a.target)).toBe(path.dirname(b.target))
    expect(path.basename(a.target)).toBe("a")
    expect(path.basename(b.target)).toBe("b")
  })

  test("a cache hit does not postpone the mutable-ref refresh", async () => {
    await using fixture = await repo({ "package.json": plugin, "server.js": source })
    const spec = `git:${fixture.path}`
    const first = await PluginGitSource.resolveGitPluginTarget(spec)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const marker = `${first.target}.json`
    const cloned = (await Bun.file(marker).json()) as { updatedAt: number }

    expect((await PluginGitSource.resolveGitPluginTarget(spec)).ok).toBe(true)
    const reused = (await Bun.file(marker).json()) as { updatedAt: number; usedAt?: number }
    // Only the retention stamp moves, so resolving a branch plugin often still re-checks it after the TTL.
    expect(reused.updatedAt).toBe(cloned.updatedAt)
    expect(reused.usedAt).toBeGreaterThanOrEqual(cloned.updatedAt)
  })

  test("fetches on demand even inside the refresh window", async () => {
    await using fixture = await repo({ "package.json": plugin, "server.js": source })
    const spec = `git:${fixture.path}`
    const first = await PluginGitSource.resolveGitPluginTarget(spec)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    await Bun.write(path.join(fixture.path, "later.txt"), "later\n")
    await $`git add -A`.cwd(fixture.path).quiet()
    await $`git commit -q -m later`.cwd(fixture.path).quiet()

    const cached = await PluginGitSource.resolveGitPluginTarget(spec)
    expect(cached.ok).toBe(true)
    if (!cached.ok) return
    expect(await Bun.file(path.join(cached.target, "later.txt")).exists()).toBe(false)

    const forced = await PluginGitSource.resolveGitPluginTarget(spec, { force: true })
    expect(forced.ok).toBe(true)
    if (!forced.ok) return
    expect(await Bun.file(path.join(forced.target, "later.txt")).exists()).toBe(true)
  })

  test("keeps a clone whose identity contains .tmp- and one whose marker has no timestamp", async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-git.tmp-plugin-")))
    await $`git init -q -b main`.cwd(directory).quiet()
    await $`git config user.email test@example.com`.cwd(directory).quiet()
    await $`git config user.name Test`.cwd(directory).quiet()
    await $`git config commit.gpgsign false`.cwd(directory).quiet()
    try {
      await commit(directory, { "package.json": plugin, "server.js": source })
      const resolved = await PluginGitSource.resolveGitPluginTarget(`git:${directory}`)
      expect(resolved.ok).toBe(true)
      if (!resolved.ok) return

      // An entry is aged by its marker, never by a name that happens to contain a staging-like segment.
      const old = new Date(0)
      await utimes(resolved.target, old, old)
      await PluginGitSource.collect()
      expect(await Bun.file(path.join(resolved.target, "package.json")).exists()).toBe(true)

      // A marker without a timestamp falls back to the directory age, so a fresh clone survives.
      const now = new Date()
      await utimes(resolved.target, now, now)
      await Bun.write(`${resolved.target}.json`, JSON.stringify({ identity: directory }))
      await PluginGitSource.collect()
      expect(await Bun.file(path.join(resolved.target, "package.json")).exists()).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("sweeps an unused clone and an interrupted staging directory", async () => {
    await using fixture = await repo({ "package.json": plugin, "server.js": source })
    const resolved = await PluginGitSource.resolveGitPluginTarget(`git:${fixture.path}`)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const marker = `${resolved.target}.json`
    const staging = path.join(PluginGitSource.cacheRoot(), ".staging", path.basename(resolved.target))
    await mkdir(staging, { recursive: true })
    const old = new Date(0)
    await utimes(resolved.target, old, old)
    await utimes(staging, old, old)
    await Bun.write(marker, JSON.stringify({ identity: fixture.path, updatedAt: 0 }))

    await PluginGitSource.collect()

    expect(await Bun.file(resolved.target).exists()).toBe(false)
    expect(await Bun.file(marker).exists()).toBe(false)
    expect(await Bun.file(staging).exists()).toBe(false)
  })

  test("expands a ~/ repo to the home directory before cloning", async () => {
    const token = `kilo-missing-${Date.now()}`
    const out = await PluginGitSource.resolveGitPluginTarget(`git:~/${token}`)
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.code).toBe("clone_failed")
    const message = out.error instanceof Error ? out.error.message : String(out.error)
    // Before expansion the repo became `https://~/...`; the clone must instead
    // target a path under the home directory.
    expect(message).toContain(path.join(os.homedir(), token))
    expect(message).not.toContain("https://")
  })
})

describe("git plugin loader hook", () => {
  const hook = (spec: string, install: boolean) => Effect.runPromise(PluginGitSource.pluginSource(spec, { install }))

  test("leaves npm specs and the npm git protocol to the loader", async () => {
    expect(await hook("pkg@1.2.3", true)).toBeUndefined()
    expect(await hook("git://github.com/owner/repo", true)).toBeUndefined()
  })

  test("defers an uncached clone to the installing pass, then resolves it with its policy resources", async () => {
    await using fixture = await repo({ "package.json": plugin, "server.js": source })
    const spec = `git:${fixture.path}`

    // The read pass names the resources from the spec alone, so a loader can deny the plugin before the clone.
    expect(await hook(spec, false)).toMatchObject({
      pending: true,
      resources: expect.arrayContaining([PluginGitSource.gitPluginIdentity(spec)!]),
    })

    const resolved = await hook(spec, true)
    expect(resolved).toMatchObject({ target: expect.any(String) })
    if (!resolved || !("target" in resolved)) return
    const identity = PluginGitSource.gitPluginIdentity(spec)
    // The canonical local path and its real path are named alongside the identity, so a deny on any spelling of
    // the same directory matches. Paths differ by separator per platform, so compare one spelling.
    const resources = (resolved.resources ?? []).map((resource) => resource.replaceAll("\\", "/"))
    expect(resources).toContain(identity!)
    expect(resources).toContain(fixture.path.replaceAll("\\", "/"))

    // With the clone cached, the non-installing pass reads it instead of asking for another pass.
    expect(await hook(spec, false)).toEqual(resolved)
  })

  test("names a relative local repo by its canonical path", async () => {
    await using fixture = await repo({ "package.json": plugin, "server.js": source })
    const resolved = await hook(`git:${path.relative(process.cwd(), fixture.path)}`, true)
    expect(resolved).toMatchObject({ target: expect.any(String) })
    if (!resolved || !("target" in resolved)) return
    // A relative repo must still name the absolute directory a policy denies, not a cwd-dependent spelling.
    const resources = (resolved.resources ?? []).map((resource) => resource.replaceAll("\\", "/"))
    expect(resources).toContain(fixture.path.replaceAll("\\", "/"))
  })

  test("rejects an invalid git spec before touching the network", async () => {
    const error = await Effect.runPromise(PluginGitSource.pluginSource("git:vendor/plugin", { install: true }).pipe(Effect.flip))
    expect(error).toBeInstanceOf(PluginModule.LoadError)
    expect((error as PluginModule.LoadError).message).toContain("Invalid git plugin spec")
  })
})
