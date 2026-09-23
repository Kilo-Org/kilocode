import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import { mkdir, readdir, symlink } from "fs/promises"
import { homedir } from "os"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "../../src/util/filesystem"
import { detect } from "../../src/kilocode/marketplace/detection"
import { install, remove } from "../../src/kilocode/marketplace/installer"
import { pluginIdentity } from "../../src/kilocode/marketplace/plugin-spec"
import { gitPluginIdentity, parseGitPluginSpec, resolveGitPluginTarget } from "../../src/kilocode/plugin/git-source"
import { resolvePluginTarget } from "../../src/plugin/shared"
import { tmpdir } from "../fixture/fixture"

async function commit(dir: string, files: Record<string, string>, message = "commit") {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(dir, rel)
    await mkdir(path.dirname(file), { recursive: true })
    await Bun.write(file, text)
  }
  await $`git add -A`.cwd(dir).quiet()
  await $`git commit -m ${message}`.cwd(dir).quiet()
}

const plugin = JSON.stringify({ name: "git-plugin", exports: { "./server": "./server.js" } })
const source = "export default { id: 'git-plugin', server: () => ({}) }\n"

describe("git plugin spec parsing", () => {
  test("parses repo, ref, and subpath", () => {
    expect(parseGitPluginSpec("git:github.com/owner/repo")).toEqual({
      repo: "github.com/owner/repo",
      ref: undefined,
      subpath: undefined,
    })
    expect(parseGitPluginSpec("git:github.com/owner/repo@v1.2.3")).toEqual({
      repo: "github.com/owner/repo",
      ref: "v1.2.3",
      subpath: undefined,
    })
    expect(parseGitPluginSpec("git:github.com/owner/repo#plugins/my-plugin")).toEqual({
      repo: "github.com/owner/repo",
      ref: undefined,
      subpath: "plugins/my-plugin",
    })
    expect(parseGitPluginSpec("git:https://github.com/owner/repo.git@main#sub/dir")).toEqual({
      repo: "https://github.com/owner/repo.git",
      ref: "main",
      subpath: "sub/dir",
    })
    expect(parseGitPluginSpec("git:file:///tmp/repo")).toEqual({
      repo: "file:///tmp/repo",
      ref: undefined,
      subpath: undefined,
    })
    expect(parseGitPluginSpec("git:/tmp/repo")).toEqual({ repo: "/tmp/repo", ref: undefined, subpath: undefined })
  })

  test("rejects npm specs, empty repos, and embedded user info", () => {
    expect(parseGitPluginSpec("pkg@1.2.3")).toBeUndefined()
    expect(parseGitPluginSpec("git:")).toBeUndefined()
    expect(parseGitPluginSpec("git:user@host/repo@main")).toBeUndefined()
  })

  test("rejects option-injection refs and malformed repos", () => {
    expect(parseGitPluginSpec("git:github.com/owner/repo@--upload-pack=/bin/sh")).toBeUndefined()
    expect(parseGitPluginSpec("git:github.com/owner/repo@-x")).toBeUndefined()
    expect(parseGitPluginSpec("git:github.com/owner/repo@feat..ure")).toBeUndefined()
    expect(parseGitPluginSpec("git:https://user:pass@host/repo")).toBeUndefined()
    expect(parseGitPluginSpec("git:git@github.com:owner/repo")).toBeUndefined()
    expect(parseGitPluginSpec("git:vendor/plugin")).toBeUndefined()
  })

  test("normalizes identity without scheme or .git suffix", () => {
    expect(gitPluginIdentity("git:github.com/owner/repo")).toBe("git/github.com/owner/repo")
    expect(gitPluginIdentity("git:https://github.com/owner/repo.git")).toBe("git/github.com/owner/repo")
    expect(gitPluginIdentity("git:github.com/owner/repo@v1.2.3")).toBe("git/github.com/owner/repo")
    expect(gitPluginIdentity("git:github.com/owner/repo#plugins/my-plugin")).toBe(
      "git/github.com/owner/repo/plugins/my-plugin",
    )
    expect(gitPluginIdentity("git:https://github.com/owner/repo.git@main#sub/dir")).toBe(
      "git/github.com/owner/repo/sub/dir",
    )
    expect(gitPluginIdentity("git:file:///tmp/repo")).toBe("git/tmp/repo")
    expect(gitPluginIdentity("git:/tmp/repo")).toBe("git/tmp/repo")
    // A trailing slash must not defeat the `.git` normalization.
    expect(gitPluginIdentity("git:github.com/owner/repo.git/")).toBe("git/github.com/owner/repo")
  })

  test("keeps a backslash in a POSIX path identity", () => {
    if (process.platform === "win32") return
    // On POSIX a backslash is a legal filename character, not a separator.
    expect(gitPluginIdentity("git:/tmp/repo\\name")).toBe("git/tmp/repo\\name")
  })

  test("normalizes Windows paths and their file URL form to one identity", () => {
    expect(gitPluginIdentity("git:C:\\repo")).toBe("git/C:/repo")
    expect(gitPluginIdentity("git:file:///C:/repo")).toBe("git/C:/repo")
  })

  test("keeps git identities distinct from npm and local path identities", () => {
    // A git plugin and a local path of the same text must not collapse onto one
    // detection key, or removing one would drop the other.
    expect(pluginIdentity("/tmp/repo")).toBe("/tmp/repo")
    expect(pluginIdentity("git:/tmp/repo")).toBe("git/tmp/repo")
    expect(pluginIdentity("repo")).toBe("repo")
    expect(pluginIdentity("git:github.com/owner/repo")).toBe("git/github.com/owner/repo")
  })
})

describe("git plugin resolution", () => {
  test("clones a local repo, resolves the subpath, and drops .git", async () => {
    await using repo = await tmpdir({
      git: true,
      init: (dir) =>
        commit(dir, {
          "package.json": plugin,
          "server.js": source,
          "plugins/my-plugin/package.json": JSON.stringify({
            name: "my-plugin",
            exports: { "./server": "./server.js" },
          }),
          "plugins/my-plugin/server.js": source,
        }),
    })

    const out = await resolveGitPluginTarget(`git:${repo.path}#plugins/my-plugin`)
    expect(out.ok).toBe(true)
    if (!out.ok) return

    expect(out.target.startsWith("file://")).toBe(true)
    const target = fileURLToPath(out.target)
    expect(target).not.toBe(repo.path)
    expect(path.basename(target)).toBe("my-plugin")
    expect(await Filesystem.exists(path.join(target, "package.json"))).toBe(true)
    expect(await Filesystem.exists(path.join(target, ".git"))).toBe(false)
    const rel = repo.path.replace(/\\/g, "/").replace(/^\/+/, "")
    expect(pluginIdentity(`git:${repo.path}#plugins/my-plugin`)).toBe(`git/${rel}/plugins/my-plugin`)

    // resolvePluginTarget is the shared entrypoint used by the loader and installer.
    expect(await resolvePluginTarget(`git:${repo.path}#plugins/my-plugin`)).toBe(out.target)

    // The `file://` URL form of a local repo resolves to the same cache target.
    const fileUrl = await resolveGitPluginTarget(`git:${pathToFileURL(repo.path).href}#plugins/my-plugin`)
    expect(fileUrl.ok).toBe(true)
    if (fileUrl.ok) expect(fileUrl.target).toBe(out.target)

    const bad = await resolveGitPluginTarget(`git:${repo.path}#missing-dir`)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.code).toBe("subpath_missing")
  })

  test("checks out a requested ref from a shallow clone", async () => {
    await using repo = await tmpdir({ git: true })
    await commit(
      repo.path,
      { "package.json": JSON.stringify({ name: "git-plugin", version: "1.0.0" }), "server.js": source },
      "one",
    )
    await $`git tag v1`.cwd(repo.path).quiet()
    await commit(repo.path, { "package.json": JSON.stringify({ name: "git-plugin", version: "2.0.0" }) }, "two")

    const out = await resolveGitPluginTarget(`git:${repo.path}@v1`)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const target = fileURLToPath(out.target)
    expect((await Bun.file(path.join(target, "package.json")).json()).version).toBe("1.0.0")

    // Same repo, default branch: the stale cached clone is replaced.
    const head = await resolveGitPluginTarget(`git:${repo.path}`)
    expect(head.ok).toBe(true)
    if (!head.ok) return
    expect((await Bun.file(path.join(fileURLToPath(head.target), "package.json")).json()).version).toBe("2.0.0")
  })

  test("keeps different refs of one repo in separate cache entries", async () => {
    await using repo = await tmpdir({ git: true })
    await commit(repo.path, { "package.json": JSON.stringify({ name: "git-plugin", version: "1.0.0" }) }, "one")
    await $`git tag v1`.cwd(repo.path).quiet()
    await commit(repo.path, { "package.json": JSON.stringify({ name: "git-plugin", version: "2.0.0" }) }, "two")
    await $`git tag v2`.cwd(repo.path).quiet()

    const a = await resolveGitPluginTarget(`git:${repo.path}@v1`)
    const b = await resolveGitPluginTarget(`git:${repo.path}@v2`)
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(a.target).not.toBe(b.target)
    expect((await Bun.file(path.join(fileURLToPath(a.target), "package.json")).json()).version).toBe("1.0.0")
    expect((await Bun.file(path.join(fileURLToPath(b.target), "package.json")).json()).version).toBe("2.0.0")
  })

  test("rejects a symlinked subpath that escapes the clone", async () => {
    await using outside = await tmpdir()
    await Bun.write(path.join(outside.path, "package.json"), plugin)
    await Bun.write(path.join(outside.path, "server.js"), source)
    await using repo = await tmpdir({
      git: true,
      init: async (dir) => {
        await commit(dir, { "package.json": plugin, "server.js": source })
        await symlink(outside.path, path.join(dir, "escape"))
        await $`git add -A`.cwd(dir).quiet()
        await $`git commit -m escape`.cwd(dir).quiet()
      },
    })

    const out = await resolveGitPluginTarget(`git:${repo.path}#escape`)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe("subpath_missing")
  })

  test("removes the staging directory after a failed clone", async () => {
    const token = `kilo-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const out = await resolveGitPluginTarget(`git:/tmp/${token}`)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe("clone_failed")

    const root = path.join(Global.Path.cache, "packages", "git")
    const entries = await readdir(root)
    expect(entries.filter((entry) => entry.includes(token))).toEqual([])
  })

  test("expands a ~/ repo to the home directory before cloning", async () => {
    const token = `kilo-missing-${Date.now()}`
    const out = await resolveGitPluginTarget(`git:~/${token}`)
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.code).toBe("clone_failed")
    const message = out.error instanceof Error ? out.error.message : String(out.error)
    // Before expansion the repo became `https://~/...`; the clone must instead
    // target a path under the home directory.
    expect(message).toContain(path.join(homedir(), token))
    expect(message).not.toContain("https://")
  })

  test("installs, detects, and removes a git plugin", async () => {
    await using repo = await tmpdir({
      git: true,
      init: (dir) => commit(dir, { "package.json": plugin, "server.js": source }),
    })
    await using tmp = await tmpdir()
    const spec = `git:${repo.path}`
    const id = pluginIdentity(spec)
    expect(id).toBeDefined()
    if (!id) return

    const resolved = await resolveGitPluginTarget(spec)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const clone = fileURLToPath(resolved.target)
    expect(await Filesystem.exists(clone)).toBe(true)

    const out = await Effect.runPromise(
      install({ directory: tmp.path, worktree: tmp.path } as never, {
        item: { type: "plugin", id, content: spec },
        target: "project",
      }),
    )
    expect(out.success).toBe(true)
    if (out.success && out.filePath) expect((await Bun.file(out.filePath).json()).plugin).toEqual([spec])

    const detected = await detect({ directory: tmp.path, worktree: tmp.path })
    expect(detected.project[`plugin:${id}`]).toEqual({ type: "plugin" })

    const removed = await Effect.runPromise(
      remove({ directory: tmp.path, worktree: tmp.path } as never, { id, type: "plugin" }, "project"),
    )
    expect(removed.success).toBe(true)
    expect((await detect({ directory: tmp.path, worktree: tmp.path })).project[`plugin:${id}`]).toBeUndefined()
    // Uninstalling the only install removes the shared clone cache.
    expect(await Filesystem.exists(clone)).toBe(false)
  })

  test("keeps the clone cache while another scope still installs the plugin", async () => {
    await using repo = await tmpdir({
      git: true,
      init: (dir) => commit(dir, { "package.json": plugin, "server.js": source }),
    })
    await using tmp = await tmpdir()
    const spec = `git:${repo.path}`
    const id = pluginIdentity(spec)
    if (!id) return

    const resolved = await resolveGitPluginTarget(spec)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const clone = fileURLToPath(resolved.target)

    const svc = { directory: tmp.path, worktree: tmp.path } as never
    const item = { type: "plugin" as const, id, content: spec }
    const project = await Effect.runPromise(install(svc, { item, target: "project" }))
    const global = await Effect.runPromise(install(svc, { item, target: "global" }))
    expect(project.success).toBe(true)
    expect(global.success).toBe(true)

    const removed = await Effect.runPromise(remove(svc, { id, type: "plugin" }, "project"))
    expect(removed.success).toBe(true)
    // The global install still references the clone, so the cache must remain.
    expect((await detect({ directory: tmp.path, worktree: tmp.path })).global[`plugin:${id}`]).toEqual({
      type: "plugin",
    })
    expect(await Filesystem.exists(clone)).toBe(true)
  })
})
