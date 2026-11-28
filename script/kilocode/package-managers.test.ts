import { afterEach, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import workflow from "../../.github/workflows/publish.yml"
import * as Artifact from "./sbom/artifact"
import * as Manifest from "./sbom/manifest"
import {
  aur,
  compare,
  digests,
  formula,
  formulaVersion,
  homebrew,
  latestRelease,
  pkgbuild,
  pkgbuildVersion,
  RecipeAheadError,
  srcinfo,
  sshCommand,
  update,
  type Digests,
} from "./package-managers"

// The files the release script published for v7.8.40: the AUR kilo-bin PKGBUILD and .SRCINFO, the
// Homebrew kilo.rb, and the archive digests of that release's CLI evidence manifest.
const fixtures = path.join(import.meta.dir, "fixtures", "package-managers")
const fixture = (name: string) => readFile(path.join(fixtures, name), "utf8")

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function temp() {
  const root = await mkdtemp(path.join(os.tmpdir(), "package-managers-"))
  roots.push(root)
  return root
}

/** Sets `vars` in the environment for the duration of `run`, then restores the previous values. */
async function withEnv(vars: Record<string, string>, run: () => Promise<void>) {
  const saved = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
  Object.assign(process.env, vars)
  try {
    await run()
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

const sha = (char: string) => char.repeat(64)
const sample: Digests = {
  "kilo-linux-arm64.tar.gz": sha("a"),
  "kilo-linux-x64.tar.gz": sha("b"),
  "kilo-darwin-x64.zip": sha("c"),
  "kilo-darwin-arm64.zip": sha("d"),
}

test("renders the AUR and Homebrew files the release script published for v7.8.40", async () => {
  const digest = digests(await fixture("cli-sbom-evidence.json"), "7.8.40")
  expect(pkgbuild("7.8.40", digest)).toBe(await fixture("PKGBUILD"))
  expect(srcinfo("7.8.40", digest)).toBe(await fixture("SRCINFO"))
  expect(formula("7.8.40", digest)).toBe(await fixture("kilo.rb"))
})

test("a pre-release version keeps its suffix in the download URLs only", () => {
  const info = srcinfo("7.9.0-rc.1", sample)
  expect(info).toContain("\tpkgver = 7.9.0\n")
  expect(info).toContain(
    "kilo-bin_7.9.0_x86_64.tar.gz::https://github.com/Kilo-Org/kilocode/releases/download/v7.9.0-rc.1/",
  )
  expect(pkgbuild("7.9.0-rc.1", sample)).toContain("\npkgver=7.9.0\n_subver=-rc.1\n")
  const rb = formula("7.9.0-rc.1", sample)
  expect(rb).toContain('  version "7.9.0"\n')
  expect(rb).toContain("/releases/download/v7.9.0-rc.1/kilo-darwin-arm64.zip")
})

test("only the manifest's own archive digests are used", () => {
  const entries = Object.entries(sample).map(([artifact, sha256]) => ({ artifact, sha256 }))
  const text = (version: string, list: unknown[]) => JSON.stringify({ version, entries: list })
  expect(digests(text("1.2.3", entries), "1.2.3")).toEqual(sample)
  expect(() => digests(text("1.2.4", entries), "1.2.3")).toThrow('for version "1.2.4", not "1.2.3"')
  expect(() => digests(text("1.2.3", entries.slice(1)), "1.2.3")).toThrow("lists kilo-linux-arm64.tar.gz 0 times")
  expect(() => digests(text("1.2.3", [...entries, entries[0]]), "1.2.3")).toThrow("2 times")
  const bad = entries.map((entry, i) => (i === 3 ? { ...entry, sha256: "A".repeat(64) } : entry))
  expect(() => digests(text("1.2.3", bad), "1.2.3")).toThrow("Missing archive digest for kilo-darwin-arm64.zip")
})

test("versions that are not release versions are refused", () => {
  for (const version of ["7.8", "v7.8.40", "7.8.40\npkgrel=2", "7.8.40-rc 1", "7.8.40-'x'"]) {
    expect(() => pkgbuild(version, sample)).toThrow("Invalid release version")
    expect(() => formula(version, sample)).toThrow("Invalid release version")
  }
})

test("the version a published recipe has is read back from it", async () => {
  expect(pkgbuildVersion(await fixture("PKGBUILD"))).toBe("7.8.40")
  expect(formulaVersion(await fixture("kilo.rb"))).toBe("7.8.40")
  expect(pkgbuildVersion(pkgbuild("7.9.0-rc.1", sample))).toBe("7.9.0-rc.1")
  // The download URLs carry the pre-release suffix; the formula's version line does not.
  expect(formulaVersion(formula("7.9.0-rc.1", sample))).toBe("7.9.0-rc.1")
  expect(formulaVersion('class Kilo < Formula\n  version "1.2.3"\nend\n')).toBe("1.2.3")
  expect(pkgbuildVersion(undefined)).toBeUndefined()
  expect(pkgbuildVersion("pkgname='kilo-bin'\n")).toBeUndefined()
  expect(formulaVersion(undefined)).toBeUndefined()
  expect(formulaVersion("class Kilo < Formula\nend\n")).toBeUndefined()
})

test("a read-back value that is not a release version is ignored", () => {
  for (const text of [
    "pkgver=not-a-version\n",
    "pkgver = 1.2.3\n",
    "pkgver=1.2.3 extra\n",
    "pkgver='1.2.3'\n",
    "pkgver=1.2.3\n_subver=-rc 1\n",
  ]) {
    expect(pkgbuildVersion(text)).toBeUndefined()
  }
  expect(formulaVersion('class Kilo < Formula\n  version "1.2"\nend\n')).toBeUndefined()
  expect(formulaVersion("describe /releases/download/v1.2/\n")).toBeUndefined()
})

test("versions order by number, and a release comes after its pre-releases", () => {
  expect(compare("7.8.40", "7.8.40")).toBe(0)
  expect(compare("7.8.40", "7.8.9")).toBeGreaterThan(0)
  expect(compare("7.10.0", "7.9.99")).toBeGreaterThan(0)
  expect(compare("7.8.39", "7.8.40")).toBeLessThan(0)
  expect(compare("7.9.0", "7.9.0-rc.1")).toBeGreaterThan(0)
  expect(compare("7.9.0-rc.2", "7.9.0-rc.1")).toBeGreaterThan(0)
  expect(compare("7.9.0-rc.10", "7.9.0-rc.9")).toBeGreaterThan(0)
})

test("the AUR ssh command uses only the given key and the pinned host keys", () => {
  expect(sshCommand("/tmp/k/key", "/tmp/h/known_hosts")).toBe(
    "ssh -F /dev/null -i '/tmp/k/key' -o IdentitiesOnly=yes -o IdentityAgent=none -o UserKnownHostsFile='/tmp/h/known_hosts' -o GlobalKnownHostsFile=/dev/null -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=4",
  )
  for (const key of ["key", "/tmp/a b", "/tmp/a'b", '/tmp/a"b', "/tmp/a\\b"]) {
    expect(() => sshCommand(key, "/tmp/known_hosts")).toThrow("Unsupported path for ssh")
  }
})

/** A bare repository with one commit on `branch`, and a git identity for the commits update() makes. */
async function remote(branch: string) {
  const root = await temp()
  const bare = path.join(root, "remote.git")
  const seed = path.join(root, "seed")
  const config = path.join(root, "gitconfig")
  await writeFile(
    config,
    "[user]\n\tname = test\n\temail = test@example.com\n[init]\n\tdefaultBranch = " + branch + "\n",
  )
  const env = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" }
  const git = (args: string[], cwd?: string) => execFileSync("git", args, { cwd, env, stdio: "ignore" })
  git(["init", "--bare", bare])
  git(["clone", bare, seed])
  await writeFile(path.join(seed, "README"), "seed\n")
  git(["add", "README"], seed)
  git(["commit", "-m", "seed"], seed)
  git(["push", "origin", "HEAD"], seed)
  const log = () => execFileSync("git", ["log", "--format=%s", branch], { cwd: bare, env, encoding: "utf8" }).trim()
  const show = (file: string) =>
    execFileSync("git", ["show", `${branch}:${file}`], { cwd: bare, env, encoding: "utf8" })
  return { bare, env: { GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" }, log, show }
}

test("update pushes the files once and leaves an up-to-date remote unchanged", async () => {
  const repo = await remote("master")
  const files = { PKGBUILD: pkgbuild("1.2.3", sample), ".SRCINFO": srcinfo("1.2.3", sample) }
  const input = { remote: repo.bare, branch: "master", files, message: "Update to v1.2.3", env: repo.env, wait: 0 }
  expect(await update(input)).toBe("pushed")
  expect(repo.log()).toBe("Update to v1.2.3\nseed")
  expect(repo.show("PKGBUILD")).toBe(files.PKGBUILD)
  expect(repo.show(".SRCINFO")).toBe(files[".SRCINFO"])
  expect(await update(input)).toBe("unchanged")
  expect(repo.log()).toBe("Update to v1.2.3\nseed")
})

test("update commits on the remote's default branch when no branch is given", async () => {
  const repo = await remote("main")
  const files = { "kilo.rb": formula("1.2.3", sample) }
  expect(await update({ remote: repo.bare, files, message: "Update to v1.2.3", env: repo.env, wait: 0 })).toBe("pushed")
  expect(repo.show("kilo.rb")).toBe(files["kilo.rb"])
})

test("update leaves a clone that publishes a newer version alone", async () => {
  const repo = await remote("main")
  const base = {
    remote: repo.bare,
    // Like the script's own reader, a clone without the file publishes nothing.
    published: async (dir: string) =>
      formulaVersion(await readFile(path.join(dir, "kilo.rb"), "utf8").catch(() => undefined)),
    env: repo.env,
    wait: 0,
  }
  const newer = formula("1.2.4", sample)
  // The recipe already carries the latest release, as after a re-run of an older release's job.
  await withEnv({ KILO_LATEST_RELEASE: "1.2.4" }, async () => {
    expect(await update({ ...base, version: "1.2.4", files: { "kilo.rb": newer }, message: "Update to v1.2.4" })).toBe(
      "pushed",
    )
    expect(
      await update({
        ...base,
        version: "1.2.3",
        files: { "kilo.rb": formula("1.2.3", sample) },
        message: "Update to v1.2.3",
      }),
    ).toBe("skipped")
  })
  expect(repo.log()).toBe("Update to v1.2.4\nseed")
  expect(repo.show("kilo.rb")).toBe(newer)
  const newest = formula("1.2.5", sample)
  expect(await update({ ...base, version: "1.2.5", files: { "kilo.rb": newest }, message: "Update to v1.2.5" })).toBe(
    "pushed",
  )
  expect(repo.show("kilo.rb")).toBe(newest)
})

test("a pre-release formula is updated by the next pre-release and not by the previous one", async () => {
  const repo = await remote("main")
  const base = {
    remote: repo.bare,
    published: async (dir: string) =>
      formulaVersion(await readFile(path.join(dir, "kilo.rb"), "utf8").catch(() => undefined)),
    env: repo.env,
    wait: 0,
  }
  await withEnv({ KILO_LATEST_RELEASE: "7.9.0-rc.2" }, async () => {
    expect(
      await update({
        ...base,
        version: "7.9.0-rc.1",
        files: { "kilo.rb": formula("7.9.0-rc.1", sample) },
        message: "Update to v7.9.0-rc.1",
      }),
    ).toBe("pushed")
    expect(
      await update({
        ...base,
        version: "7.9.0-rc.2",
        files: { "kilo.rb": formula("7.9.0-rc.2", sample) },
        message: "Update to v7.9.0-rc.2",
      }),
    ).toBe("pushed")
    expect(
      await update({
        ...base,
        version: "7.9.0-rc.1",
        files: { "kilo.rb": formula("7.9.0-rc.1", sample) },
        message: "Update to v7.9.0-rc.1",
      }),
    ).toBe("skipped")
  })
  expect(repo.log()).toBe("Update to v7.9.0-rc.2\nUpdate to v7.9.0-rc.1\nseed")
  expect(repo.show("kilo.rb")).toBe(formula("7.9.0-rc.2", sample))
})

test("update fails when the recipe is ahead of the latest release it is publishing", async () => {
  const repo = await remote("main")
  const base = {
    remote: repo.bare,
    published: async (dir: string) =>
      formulaVersion(await readFile(path.join(dir, "kilo.rb"), "utf8").catch(() => undefined)),
    env: repo.env,
    wait: 0,
  }
  await withEnv({ KILO_LATEST_RELEASE: "1.2.4" }, async () => {
    expect(
      await update({ ...base, version: "1.2.5", files: { "kilo.rb": formula("1.2.5", sample) }, message: "v1.2.5" }),
    ).toBe("pushed")
    const error = await update({
      ...base,
      version: "1.2.4",
      files: { "kilo.rb": formula("1.2.4", sample) },
      message: "v1.2.4",
    }).then(
      () => undefined,
      (err: unknown) => err,
    )
    expect(error).toBeInstanceOf(RecipeAheadError)
    expect(String(error)).toContain("publishes v1.2.5, newer than the v1.2.4 this run publishes")
    expect(String(error)).toContain("v1.2.4 is the latest release")
  })
  // One attempt only: a recipe that is ahead is not a transient failure.
  expect(repo.log()).toBe("v1.2.5\nseed")
  expect(repo.show("kilo.rb")).toBe(formula("1.2.5", sample))
})

test("the latest release comes from KILO_LATEST_RELEASE, and is unknown when that is unusable", async () => {
  await withEnv({ KILO_LATEST_RELEASE: "v1.2.3" }, async () => {
    expect(await latestRelease()).toBe("1.2.3")
  })
  await withEnv({ KILO_LATEST_RELEASE: "not a version" }, async () => {
    expect(await latestRelease()).toBeUndefined()
  })
})

test("update fails after its last attempt", async () => {
  const root = await temp()
  const missing = path.join(root, "missing.git")
  const input = { remote: missing, files: { a: "a" }, message: "m", attempts: 2, wait: 0 }
  const error = await update(input).then(
    () => undefined,
    (err: unknown) => err,
  )
  expect(error).toBeInstanceOf(Error)
})

test("update refuses to write through a symlink in the clone", async () => {
  const repo = await remote("master")
  const root = await temp()
  const outside = path.join(root, "outside.txt")
  await writeFile(outside, "original\n")
  const env = { ...process.env, ...repo.env }
  const work = path.join(root, "work")
  execFileSync("git", ["clone", repo.bare, work], { env, stdio: "ignore" })
  await symlink(outside, path.join(work, "PKGBUILD"))
  execFileSync("git", ["add", "PKGBUILD"], { cwd: work, env, stdio: "ignore" })
  execFileSync("git", ["commit", "-m", "link"], { cwd: work, env, stdio: "ignore" })
  execFileSync("git", ["push", "origin", "HEAD"], { cwd: work, env, stdio: "ignore" })
  const input = { remote: repo.bare, branch: "master", files: { PKGBUILD: "x" }, message: "m", env: repo.env }
  const error = await update({ ...input, attempts: 1 }).then(
    () => undefined,
    (err: unknown) => err,
  )
  expect(String(error)).toContain("is not a regular file")
  expect(await readFile(outside, "utf8")).toBe("original\n")
  expect(repo.log()).toBe("link\nseed")
})

test("the AUR update adds the final newline a stored key lost", async () => {
  const repo = await remote("master")
  const key = path.join(await temp(), "aur_key")
  await writeFile(key, "stand-in key without its final newline")
  await withEnv({ ...repo.env, KILO_LATEST_RELEASE: "1.2.3" }, async () => {
    expect(await aur("1.2.3", sample, key, repo.bare)).toBe("pushed")
    // A re-run of an older release leaves the newer recipe alone.
    expect(await aur("1.2.2", sample, key, repo.bare)).toBe("skipped")
  })
  expect(await readFile(key, "utf8")).toBe("stand-in key without its final newline\n")
  expect(repo.log()).toBe("Update to v1.2.3\nseed")
  expect(repo.show(".SRCINFO")).toBe(srcinfo("1.2.3", sample))
})

test("homebrew leaves a tap that publishes a newer formula alone", async () => {
  const repo = await remote("main")
  await withEnv({ ...repo.env, KILO_LATEST_RELEASE: "1.2.4" }, async () => {
    expect(await homebrew("1.2.4", sample, repo.bare)).toBe("pushed")
    expect(await homebrew("1.2.3", sample, repo.bare)).toBe("skipped")
  })
  expect(repo.log()).toBe("Update to v1.2.4\nseed")
  expect(repo.show("kilo.rb")).toBe(formula("1.2.4", sample))
})

test("the package-managers job gives the update steps a read-only token for the latest release", () => {
  const steps: { name?: string; env?: Record<string, string> }[] = workflow.jobs["package-managers"].steps
  for (const name of ["Update AUR", "Update Homebrew"]) {
    const step = steps.find((candidate) => candidate.name === name)
    expect(step?.env?.GITHUB_TOKEN).toBe("${{ github.token }}")
  }
})

test("the package-managers job checks the manifest against the digest build-cli recorded", async () => {
  const steps: { name?: string; run?: string }[] = workflow.jobs["package-managers"].steps
  const script = steps.find((step) => step.name === "Verify package recipe manifest")?.run
  expect(script).toBeTruthy()
  const root = await temp()
  const file = path.join(root, Manifest.name("cli"))
  const entry = { artifact: "kilo-linux-x64.tar.gz", sha256: sha("a") }
  const manifest = { version: "1.2.3", product: "cli", generated: "", expected: 1, entries: [entry] }
  await Manifest.write(file, manifest)
  const expected = await Artifact.digest(file)
  const run = (value: string) =>
    Bun.spawn(["bash", "-e", "-c", script!], {
      cwd: root,
      env: { PATH: process.env.PATH, EXPECTED: value, MANIFEST: file },
      stdout: "ignore",
      stderr: "ignore",
    }).exited
  expect(await run(expected)).toBe(0)
  expect(await run("")).not.toBe(0)
  entry.sha256 = sha("b")
  await Manifest.write(file, manifest)
  expect(await run(expected)).not.toBe(0)
})
