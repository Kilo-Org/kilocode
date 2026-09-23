import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import { mkdir } from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { Effect } from "effect"
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

  test("normalizes identity without scheme or .git suffix", () => {
    expect(gitPluginIdentity("git:github.com/owner/repo")).toBe("github.com/owner/repo")
    expect(gitPluginIdentity("git:https://github.com/owner/repo.git")).toBe("github.com/owner/repo")
    expect(gitPluginIdentity("git:github.com/owner/repo@v1.2.3")).toBe("github.com/owner/repo")
    expect(gitPluginIdentity("git:github.com/owner/repo#plugins/my-plugin")).toBe(
      "github.com/owner/repo/plugins/my-plugin",
    )
    expect(gitPluginIdentity("git:https://github.com/owner/repo.git@main#sub/dir")).toBe(
      "github.com/owner/repo/sub/dir",
    )
    expect(gitPluginIdentity("git:file:///tmp/repo")).toBe("/tmp/repo")
    expect(gitPluginIdentity("git:/tmp/repo")).toBe("/tmp/repo")
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
    expect(pluginIdentity(`git:${repo.path}#plugins/my-plugin`)).toBe(`${repo.path}/plugins/my-plugin`)

    // resolvePluginTarget is the shared entrypoint used by the loader and installer.
    expect(await resolvePluginTarget(`git:${repo.path}#plugins/my-plugin`)).toBe(out.target)

    // The `file://` form of a local repo resolves to the same cache target.
    const fileUrl = await resolveGitPluginTarget(`git:file://${repo.path}#plugins/my-plugin`)
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
  })
})
