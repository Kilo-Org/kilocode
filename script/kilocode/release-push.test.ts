import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { check, lines, rule, shape } from "./release-check"
import { pack } from "./release-bundle"
import { push } from "./release-push"

// A throwaway "origin" stands in for GitHub: the release-commit side writes the bundle with pack(),
// the release-push side runs script/kilocode/release-push.ts against the bare repository. A stand-in
// `gh` answers the two read-only lookups of release-commit.ts from the same repository.

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function temp() {
  const root = await mkdtemp(path.join(os.tmpdir(), "release-push-"))
  roots.push(root)
  return root
}

const saved = { ...process.env }
let tools = ""
let config = ""
beforeAll(async () => {
  tools = await mkdtemp(path.join(os.tmpdir(), "release-push-tools-"))
  config = path.join(tools, "gitconfig")
  await writeFile(config, "[user]\n\tname = test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n")
  const gh = path.join(tools, "gh")
  await writeFile(
    gh,
    [
      "#!/usr/bin/env bun",
      'import { execFileSync } from "node:child_process"',
      "const origin = process.env.STUB_ORIGIN",
      'const endpoint = process.argv.slice(2).find((arg) => arg.startsWith("repos/")) ?? ""',
      'const git = (...args) => execFileSync("git", ["-C", origin, ...args], { encoding: "utf8" })',
      'if (endpoint.includes("/commits?")) {',
      '  for (const item of git("log", "main", "-n", "100", "--format=%H%x00%B%x01").split("\\x01")) {',
      '    const [sha, message] = item.replace(/^\\n/, "").split("\\0")',
      "    if (sha) console.log(JSON.stringify({ sha, commit: { message } }))",
      "  }",
      '} else if (endpoint.includes("/compare/")) {',
      '  const from = endpoint.split("/compare/")[1].split("...")[0]',
      '  const main = git("rev-parse", "main").trim()',
      '  let status = "diverged"',
      '  if (from === main) status = "identical"',
      "  else {",
      "    try {",
      '      git("merge-base", "--is-ancestor", from, "main")',
      '      status = "ahead"',
      "    } catch {}",
      "  }",
      "  console.log(status)",
      "} else process.exit(1)",
      "",
    ].join("\n"),
  )
  await chmod(gh, 0o755)
  Object.assign(process.env, {
    PATH: `${tools}${path.delimiter}${process.env.PATH}`,
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_NOSYSTEM: "1",
    GH_REPO: "test/kilocode",
  })
})
afterAll(async () => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
  await rm(tools, { recursive: true, force: true })
})

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

const json = (name: string, version: string) =>
  `{\n  "name": "${name}",\n  "version": "${version}",\n  "private": true\n}\n`
const lock = (cli: string, pin: string) =>
  [
    "{",
    '  "lockfileVersion": 1,',
    '  "workspaces": {',
    '    "packages/kilo-jetbrains": {',
    '      "name": "@kilocode/kilo-jetbrains",',
    `      "version": "${pin}",`,
    "    },",
    '    "packages/opencode": {',
    '      "name": "@kilocode/cli",',
    `      "version": "${cli}",`,
    "    },",
    "  },",
    "}",
    "",
  ].join("\n")
const toml = (version: string) =>
  `id = "kilo"\nversion = "${version}"\n\n[targets]\narchive = "https://github.com/Kilo-Org/kilocode/releases/download/v${version}/kilo-linux-x64.tar.gz"\n`

/** Writes the release files of `version` the way the version bump does. */
async function release(dir: string, version: string) {
  await writeFile(path.join(dir, "package.json"), json("kilo", version))
  await writeFile(path.join(dir, "packages/opencode/package.json"), json("@kilocode/cli", version))
  await writeFile(path.join(dir, "bun.lock"), lock(version, "0.9.0"))
  await writeFile(path.join(dir, "packages/extensions/zed/extension.toml"), toml(version))
  const changelog = path.join(dir, "packages/opencode/CHANGELOG.md")
  await writeFile(changelog, `# @kilocode/cli\n\n## ${version}\n\n- A change\n${await readFile(changelog, "utf8")}`)
  await rm(path.join(dir, ".changeset/one.md"))
}

/** A bare origin whose main holds release 1.0.0, a clone of it, and that dispatch commit. */
type Fixture = { root: string; origin: string; work: string; base: string }

async function fixture(): Promise<Fixture> {
  const root = await temp()
  const origin = path.join(root, "origin.git")
  const work = path.join(root, "work")
  git(root, "init", "--bare", "--quiet", origin)
  git(root, "clone", "--quiet", origin, work)
  for (const dir of [
    "packages/opencode",
    "packages/kilo-jetbrains",
    "packages/extensions/zed",
    ".changeset",
    ".github/workflows",
    "script",
    "bin",
  ]) {
    await mkdir(path.join(work, dir), { recursive: true })
  }
  await writeFile(path.join(work, "package.json"), json("kilo", "1.0.0"))
  await writeFile(path.join(work, "packages/opencode/package.json"), json("@kilocode/cli", "1.0.0"))
  await writeFile(path.join(work, "packages/kilo-jetbrains/package.json"), json("@kilocode/kilo-jetbrains", "0.9.0"))
  await writeFile(path.join(work, "packages/opencode/CHANGELOG.md"), "## 1.0.0\n\n- First\n")
  await writeFile(path.join(work, "bun.lock"), lock("1.0.0", "0.9.0"))
  await writeFile(path.join(work, "packages/extensions/zed/extension.toml"), toml("1.0.0"))
  await writeFile(path.join(work, ".changeset/one.md"), "---\n'@kilocode/cli': patch\n---\n\nA change\n")
  await writeFile(path.join(work, ".changeset/README.md"), "Changesets\n")
  await writeFile(path.join(work, ".github/workflows/ci.yml"), "on: push\n")
  await writeFile(path.join(work, "script/tool.ts"), "export {}\n")
  await writeFile(path.join(work, "README.md"), "Kilo\n")
  git(work, "add", "-A")
  git(work, "commit", "--quiet", "-m", "release: v1.0.0")
  git(work, "push", "--quiet", "origin", "HEAD:main")
  const base = git(work, "rev-parse", "HEAD")
  process.env.STUB_ORIGIN = origin
  return { root, origin, work, base }
}

/** A bundle of tag v1.0.1 on a commit made by `edit`, without the checks pack() runs. */
async function forge(f: Fixture, edit: (dir: string) => Promise<void>, parents?: string[]) {
  await edit(f.work)
  git(f.work, "add", "-A")
  if (parents) {
    const tree = git(f.work, "write-tree")
    const commit = git(f.work, "commit-tree", tree, ...parents.flatMap((item) => ["-p", item]), "-m", "release: v1.0.1")
    git(f.work, "reset", "--quiet", "--hard", commit)
  } else git(f.work, "commit", "--quiet", "-m", "release: v1.0.1")
  git(f.work, "tag", "v1.0.1")
  const bundle = path.join(f.root, "forged.bundle")
  git(f.work, "bundle", "create", "--quiet", bundle, "refs/tags/v1.0.1", `^${f.base}`)
  const sha256 = createHash("sha256")
    .update(await readFile(bundle))
    .digest("hex")
  return { bundle, sha256, commit: git(f.work, "rev-parse", "HEAD") }
}

/** The release-push job: a fresh clone of origin at the dispatch commit, running the script. */
async function run(f: Fixture, bundle: string, sha256: string) {
  const keys = path.join(f.root, `keys-${Date.now()}-${Math.random()}`)
  git(f.root, "clone", "--quiet", f.origin, keys)
  git(keys, "checkout", "--quiet", "--detach", f.base)
  const result = spawnSync("bun", [path.join(import.meta.dir, "release-push.ts"), bundle], {
    cwd: keys,
    env: { ...process.env, BUNDLE_SHA256: sha256, VERSION: "1.0.1", BASE: f.base },
    encoding: "utf8",
  })
  return { code: result.status, output: `${result.stdout}${result.stderr}`, keys }
}

/** Moves origin's main by one commit that writes `files`. */
async function move(f: Fixture, files: Record<string, string>) {
  const other = path.join(f.root, `other-${Date.now()}-${Math.random()}`)
  git(f.root, "clone", "--quiet", f.origin, other)
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(other, name)), { recursive: true })
    await writeFile(path.join(other, name), text)
  }
  git(other, "add", "-A")
  git(other, "commit", "--quiet", "-m", "unrelated change")
  git(other, "push", "--quiet", "origin", "HEAD:main")
  return git(other, "rev-parse", "HEAD")
}

const refs = (origin: string) => ({
  main: git(origin, "rev-parse", "main"),
  tag: spawnSync("git", ["rev-parse", "--verify", "--quiet", "refs/tags/v1.0.1"], {
    cwd: origin,
    encoding: "utf8",
  }).stdout.trim(),
})

describe("release-check", () => {
  test("rules: version and changelog paths only, and never the denied paths", () => {
    const kind = (file: string, status = "M") => {
      const found = rule(file, status)
      return "refused" in found ? "refused" : found.kind
    }
    expect(kind("package.json")).toBe("json")
    expect(kind("packages/sdk/js/package.json")).toBe("json")
    expect(kind("bun.lock")).toBe("json")
    expect(kind("packages/extensions/zed/extension.toml")).toBe("toml")
    expect(kind("packages/opencode/CHANGELOG.md")).toBe("text")
    expect(kind(".changeset/one.md", "D")).toBe("delete")
    for (const [file, status] of [
      [".github/workflows/publish.yml", "M"],
      [".github/package.json", "M"],
      ["script/upstream/package.json", "M"],
      ["bin/package.json", "M"],
      ["nix/package.json", "M"],
      ["packages/x/bun.lock", "M"],
      ["package-lock.json", "M"],
      ["packages/kilo-jetbrains/package.json", "M"],
      ["packages/new/package.json", "A"],
      [".changeset/one.md", "M"],
      [".changeset/README.md", "D"],
      ["bun.lock", "D"],
      ["packages/opencode/src/index.ts", "M"],
    ]) {
      expect(kind(file!, status)).toBe("refused")
    }
  })

  test("lines: only version lines from the previous to the release version", () => {
    const old = json("a", "1.0.0")
    expect(lines("json", "p", old, json("a", "1.0.1"), "1.0.0", "1.0.1")).toEqual([])
    expect(lines("json", "p", old, json("a", "1.0.2"), "1.0.0", "1.0.1")).toEqual([
      "p:3: the new line is not version 1.0.1",
    ])
    expect(lines("json", "p", json("a", "0.1.0"), json("a", "1.0.1"), "1.0.0", "1.0.1")).toEqual([
      "p:3: the old version is 0.1.0, not 1.0.0",
    ])
    expect(lines("json", "p", old, old.replace('"private": true', '"private": false'), "1.0.0", "1.0.1")).toEqual([
      'p:4: only "version" lines may change',
    ])
    expect(lines("json", "p", old, `${old}\n`, "1.0.0", "1.0.1")).toEqual(["p: the line count changed"])
    expect(lines("toml", "t", toml("1.0.0"), toml("1.0.1"), "1.0.0", "1.0.1")).toEqual([])
    expect(
      lines("toml", "t", toml("1.0.0"), toml("1.0.0").replace("kilo-linux-x64", "evil"), "1.0.0", "1.0.1"),
    ).toEqual(["t:5: only the version line and release download URLs may change"])
  })

  test("a release commit made like the version bump passes", async () => {
    const f = await fixture()
    await release(f.work, "1.0.1")
    const packed = await pack({ cwd: f.work, version: "1.0.1", out: path.join(f.root, "out") })
    expect(check({ cwd: f.work, from: f.base, to: packed.commit, version: "1.0.1" })).toEqual([])
    expect(shape({ cwd: f.work, commit: packed.commit, parents: [f.base], subject: "release: v1.0.1" })).toEqual([])
    const manifest = JSON.parse(await readFile(path.join(f.root, "out/release-manifest.json"), "utf8"))
    expect(manifest.paths.map((item: { path: string }) => item.path).sort()).toEqual([
      ".changeset/one.md",
      "bun.lock",
      "package.json",
      "packages/extensions/zed/extension.toml",
      "packages/opencode/CHANGELOG.md",
      "packages/opencode/package.json",
    ])
  })

  test("a package.json that is executable on main may change while it keeps its mode", async () => {
    const f = await fixture()
    await chmod(path.join(f.work, "packages/opencode/package.json"), 0o755)
    git(f.work, "add", "-A")
    git(f.work, "commit", "--quiet", "-m", "executable package.json")
    const base = git(f.work, "rev-parse", "HEAD")
    await release(f.work, "1.0.1")
    const packed = await pack({ cwd: f.work, version: "1.0.1", out: path.join(f.root, "out") })
    expect(check({ cwd: f.work, from: base, to: packed.commit, version: "1.0.1" })).toEqual([])
  })

  test("pack leaves out a change the release commit may not carry", async () => {
    const f = await fixture()
    await release(f.work, "1.0.1")
    await writeFile(path.join(f.work, "script/tool.ts"), "export const drift = 1\n")
    const packed = await pack({ cwd: f.work, version: "1.0.1", out: path.join(f.root, "out") })
    expect(git(f.work, "show", `${packed.commit}:script/tool.ts`)).toBe("export {}")
  })

  const deny: [string, (dir: string) => Promise<void>, RegExp][] = [
    [
      "a .github edit",
      (dir) => writeFile(path.join(dir, ".github/workflows/ci.yml"), "on: workflow_dispatch\n"),
      /\.github\/workflows\/ci\.yml \(M\): path is never part of a release commit/,
    ],
    [
      "a script edit",
      (dir) => writeFile(path.join(dir, "script/tool.ts"), "process.exit(1)\n"),
      /script\/tool\.ts \(M\)/,
    ],
    [
      "a mode change",
      (dir) => chmod(path.join(dir, "packages/opencode/package.json"), 0o755),
      /packages\/opencode\/package\.json: mode 100644 -> 100755/,
    ],
    [
      "a symlink",
      async (dir) => {
        await rm(path.join(dir, "packages/opencode/CHANGELOG.md"))
        await symlink("../../README.md", path.join(dir, "packages/opencode/CHANGELOG.md"))
      },
      /packages\/opencode\/CHANGELOG\.md: mode 100644 -> 120000/,
    ],
    [
      "a package.json change beyond its version",
      (dir) =>
        writeFile(path.join(dir, "package.json"), json("kilo", "1.0.1").replace('"private": true', '"private": false')),
      /package\.json:4: only "version" lines may change/,
    ],
    ["an added file", (dir) => writeFile(path.join(dir, "packages/opencode/new.md"), "x\n"), /new\.md \(A\)/],
  ]
  for (const [name, edit, problem] of deny) {
    test(`refuses ${name}`, async () => {
      const f = await fixture()
      await release(f.work, "1.0.1")
      await edit(f.work)
      git(f.work, "add", "-A")
      git(f.work, "commit", "--quiet", "-m", "release: v1.0.1")
      const problems = check({ cwd: f.work, from: f.base, to: "HEAD", version: "1.0.1" })
      expect(problems.join("\n")).toMatch(problem)
    })
  }

  test("refuses an extra parent", async () => {
    const f = await fixture()
    const side = await move(f, { "README.md": "Side\n" })
    git(f.work, "fetch", "--quiet", "origin")
    const forged = await forge(f, (dir) => release(dir, "1.0.1"), [f.base, side])
    expect(shape({ cwd: f.work, commit: forged.commit, parents: [f.base], subject: "release: v1.0.1" })).toEqual([
      `commit ${forged.commit} has parents [${f.base}, ${side}], expected [${f.base}]`,
    ])
  })
})

describe("release-push", () => {
  test("pushes a valid bundle, and a re-run verifies the tag and pushes nothing", async () => {
    const f = await fixture()
    await release(f.work, "1.0.1")
    const packed = await pack({ cwd: f.work, version: "1.0.1", out: path.join(f.root, "out") })
    const bundle = path.join(f.root, "out/release.bundle")
    const first = await run(f, bundle, packed.sha256)
    expect(first.output).toContain(`Pushed main ${packed.commit} and tag v1.0.1`)
    expect(first.code).toBe(0)
    expect(refs(f.origin)).toEqual({ main: packed.commit, tag: packed.commit })
    const again = await run(f, bundle, packed.sha256)
    expect(again.code).toBe(0)
    expect(again.output).toContain("already on main at the release commit")
    expect(refs(f.origin)).toEqual({ main: packed.commit, tag: packed.commit })
  })

  const refused: [string, (f: Fixture) => Promise<{ bundle: string; sha256: string }>, string][] = [
    [
      "a path outside the allowlist",
      (f) =>
        forge(f, async (dir) => {
          await release(dir, "1.0.1")
          await writeFile(path.join(dir, ".github/workflows/ci.yml"), "on: workflow_dispatch\n")
        }),
      "path is never part of a release commit",
    ],
    [
      "a wrong parent",
      async (f) => {
        const side = await move(f, { "README.md": "Side\n" })
        git(f.work, "fetch", "--quiet", "origin")
        git(f.work, "reset", "--quiet", "--hard", side)
        return forge(f, (dir) => release(dir, "1.0.1"))
      },
      "expected [",
    ],
    [
      "an extra parent",
      async (f) => {
        const side = await move(f, { "README.md": "Side\n" })
        git(f.work, "fetch", "--quiet", "origin")
        return forge(f, (dir) => release(dir, "1.0.1"), [f.base, side])
      },
      "has parents [",
    ],
    [
      "a hash mismatch",
      async (f) => {
        const forged = await forge(f, (dir) => release(dir, "1.0.1"))
        return { bundle: forged.bundle, sha256: "0".repeat(64) }
      },
      "the release-commit job recorded",
    ],
    [
      "a tag object instead of a commit",
      async (f) => {
        await release(f.work, "1.0.1")
        git(f.work, "add", "-A")
        git(f.work, "commit", "--quiet", "-m", "release: v1.0.1")
        git(f.work, "tag", "-a", "-m", "tag", "v1.0.1")
        const bundle = path.join(f.root, "annotated.bundle")
        git(f.work, "bundle", "create", "--quiet", bundle, "refs/tags/v1.0.1", `^${f.base}`)
        return {
          bundle,
          sha256: createHash("sha256")
            .update(await readFile(bundle))
            .digest("hex"),
        }
      },
      "is a tag, not a commit",
    ],
  ]
  for (const [name, make, message] of refused) {
    test(`refuses ${name} and pushes nothing`, async () => {
      const f = await fixture()
      const { bundle, sha256 } = await make(f)
      const before = refs(f.origin)
      const result = await run(f, bundle, sha256)
      expect(result.code).not.toBe(0)
      expect(result.output).toContain(message)
      expect(result.output).toContain("Nothing was pushed")
      expect(refs(f.origin)).toEqual(before)
    })
  }

  test("merges when main moved without overlap; the tag stays on the release commit", async () => {
    const f = await fixture()
    await release(f.work, "1.0.1")
    const packed = await pack({ cwd: f.work, version: "1.0.1", out: path.join(f.root, "out") })
    const head = await move(f, { "docs/new.md": "New\n" })
    const result = await run(f, path.join(f.root, "out/release.bundle"), packed.sha256)
    expect(result.code).toBe(0)
    const after = refs(f.origin)
    expect(after.tag).toBe(packed.commit)
    expect(git(f.origin, "rev-list", "--parents", "-n", "1", "main").split(" ").slice(1)).toEqual([head, packed.commit])
    expect(git(f.origin, "show", "main:docs/new.md")).toBe("New")
    expect(git(f.origin, "show", "main:packages/opencode/package.json")).toContain('"version": "1.0.1"')
  })

  test("merges when main changed .github; the second check stays clean", async () => {
    const f = await fixture()
    await release(f.work, "1.0.1")
    const packed = await pack({ cwd: f.work, version: "1.0.1", out: path.join(f.root, "out") })
    const head = await move(f, { ".github/workflows/ci.yml": "on: pull_request\n" })
    const result = await run(f, path.join(f.root, "out/release.bundle"), packed.sha256)
    expect(result.code).toBe(0)
    expect(git(f.origin, "show", "main:.github/workflows/ci.yml")).toBe("on: pull_request")
    expect(git(f.origin, "diff", "--name-only", head, "main").split("\n").sort()).toEqual([
      ".changeset/one.md",
      "bun.lock",
      "package.json",
      "packages/extensions/zed/extension.toml",
      "packages/opencode/CHANGELOG.md",
      "packages/opencode/package.json",
    ])
  })

  test("refuses a conflict with main and pushes nothing", async () => {
    const f = await fixture()
    await release(f.work, "1.0.1")
    const packed = await pack({ cwd: f.work, version: "1.0.1", out: path.join(f.root, "out") })
    const head = await move(f, { "packages/opencode/package.json": json("@kilocode/cli", "1.0.0-hotfix") })
    const result = await run(f, path.join(f.root, "out/release.bundle"), packed.sha256)
    expect(result.code).not.toBe(0)
    expect(result.output).toContain("conflicts with main")
    expect(refs(f.origin)).toEqual({ main: head, tag: "" })
  })

  test("merges again when main moves during the push (lease race)", async () => {
    const f = await fixture()
    await release(f.work, "1.0.1")
    const packed = await pack({ cwd: f.work, version: "1.0.1", out: path.join(f.root, "out") })
    const keys = path.join(f.root, "keys")
    git(f.root, "clone", "--quiet", f.origin, keys)
    let moved = ""
    const result = await push({
      cwd: keys,
      bundle: path.join(f.root, "out/release.bundle"),
      sha256: packed.sha256,
      version: "1.0.1",
      base: f.base,
      before: async (attempt) => {
        if (attempt === 0) moved = await move(f, { "docs/race.md": "Race\n" })
      },
    })
    expect(result.skipped).toBe(false)
    expect(git(f.origin, "rev-list", "--parents", "-n", "1", "main").split(" ").slice(1)).toEqual([
      moved,
      packed.commit,
    ])
    expect(refs(f.origin).tag).toBe(packed.commit)
  })

  test("refuses after two more merges when main keeps moving", async () => {
    const f = await fixture()
    await release(f.work, "1.0.1")
    const packed = await pack({ cwd: f.work, version: "1.0.1", out: path.join(f.root, "out") })
    const keys = path.join(f.root, "keys")
    git(f.root, "clone", "--quiet", f.origin, keys)
    let count = 0
    let last = ""
    const error = await push({
      cwd: keys,
      bundle: path.join(f.root, "out/release.bundle"),
      sha256: packed.sha256,
      version: "1.0.1",
      base: f.base,
      before: async () => {
        count++
        last = await move(f, { [`docs/race-${count}.md`]: `${count}\n` })
      },
    }).then(
      () => undefined,
      (err: unknown) => err,
    )
    expect(String(error)).toContain("main kept moving")
    expect(count).toBe(3)
    expect(refs(f.origin)).toEqual({ main: last, tag: "" })
  })
})
