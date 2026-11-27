import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import workflow from "../../.github/workflows/publish.yml"
import * as Stage from "./publish-stage"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function stage() {
  const root = await mkdtemp(path.join(os.tmpdir(), "publish-stage-"))
  roots.push(root)
  const tarball = path.join(root, "kilocode-cli-linux-x64-1.2.3.tgz")
  const launcher = path.join(root, "kilocode-cli-1.2.3.tgz")
  const evidence = path.join(root, "cli-distribution-sbom-evidence.json")
  await writeFile(tarball, "platform tarball")
  await writeFile(launcher, "launcher tarball")
  await writeFile(evidence, "{}\n")
  const dirs = { stage: path.join(root, "stage"), tarballs: path.join(root, "tarballs") }
  const sha256 = await Stage.write(dirs, {
    version: "1.2.3",
    tarballs: [
      { name: "@kilocode/cli-linux-x64", version: "1.2.3", path: tarball },
      { name: "@kilocode/cli", version: "1.2.3", path: launcher },
    ],
    files: [evidence],
    entries: [{ artifact: "kilocode-cli-1.2.3.tgz", sha256: "a".repeat(64), distribution: "npm" }],
  })
  return { ...dirs, sha256 }
}

const fail = (promise: Promise<unknown>) =>
  promise.then(
    () => "",
    (err: unknown) => String(err),
  )

test("read returns what each reader needs, in publishing order, with absolute paths", async () => {
  const { stage: dir, tarballs, sha256 } = await stage()
  const npm = await Stage.read({ stage: dir, tarballs, digest: sha256, version: "1.2.3", need: "tarballs" })
  expect(npm.tarballs.map((item) => item.name)).toEqual(["@kilocode/cli-linux-x64", "@kilocode/cli"])
  expect(npm.tarballs.every((item) => path.isAbsolute(item.file) && path.dirname(item.file) === tarballs)).toBe(true)
  expect(npm.files).toEqual([])
  expect(npm.entries).toHaveLength(1)
  const undraft = await Stage.read({ stage: dir, digest: sha256, version: "1.2.3", need: "evidence" })
  expect(undraft.files).toEqual([path.join(dir, "cli-distribution-sbom-evidence.json")])
  expect(undraft.tarballs).toEqual([])
})

test("the evidence reader needs no tarballs, and the npm reader needs no evidence", async () => {
  const { stage: dir, tarballs, sha256 } = await stage()
  await rm(tarballs, { recursive: true })
  expect(await fail(Stage.read({ stage: dir, digest: sha256, version: "1.2.3", need: "evidence" }))).toBe("")
  expect(await fail(Stage.read({ stage: dir, digest: sha256, version: "1.2.3", need: "tarballs" }))).toContain(
    "publish-tarballs directory is required",
  )
  const other = await stage()
  await rm(path.join(other.stage, "cli-distribution-sbom-evidence.json"))
  const read = { stage: other.stage, tarballs: other.tarballs, digest: other.sha256, version: "1.2.3" }
  expect(await fail(Stage.read({ ...read, need: "tarballs" }))).toBe("")
  expect(await fail(Stage.read({ ...read, need: "evidence" }))).toContain("cli-distribution-sbom-evidence.json")
})

test("read refuses a replaced stage file, a replaced tarball, another version and a path in a name", async () => {
  {
    const { stage: dir, tarballs, sha256 } = await stage()
    const read = (digest: string, version: string) =>
      Stage.read({ stage: dir, tarballs, digest, version, need: "tarballs" })
    expect(await fail(read("b".repeat(64), "1.2.3"))).toContain("publish-build recorded")
    expect(await fail(read(sha256, "1.2.4"))).toContain('is for version "1.2.3", not 1.2.4')
    expect(await fail(read("", "1.2.3"))).toContain("recorded no stage digest")
    await writeFile(path.join(tarballs, "kilocode-cli-1.2.3.tgz"), "another launcher")
    expect(await fail(read(sha256, "1.2.3"))).toContain("kilocode-cli-1.2.3.tgz has sha256")
  }
  {
    const { stage: dir, tarballs } = await stage()
    const file = path.join(dir, Stage.FILENAME)
    const text = (await readFile(file, "utf8")).replace('"file": "kilocode-cli-1.2.3.tgz"', '"file": "../escape.tgz"')
    await writeFile(file, text)
    const digest = new Bun.CryptoHasher("sha256").update(text).digest("hex")
    expect(await fail(Stage.read({ stage: dir, tarballs, digest, version: "1.2.3", need: "tarballs" }))).toContain(
      "Invalid stage file",
    )
  }
})

test("the release jobs run in today's user-visible order, each with only the permissions it needs", () => {
  const jobs: Record<
    string,
    { needs?: string[] | string; permissions?: Record<string, string>; environment?: string }
  > = workflow.jobs
  const needs = (name: string) => [jobs[name]?.needs ?? []].flat()
  expect(needs("release-draft")).toContain("version")
  expect(needs("build-cli")).toContain("release-draft")
  expect(needs("release-push")).toContain("release-assets")
  expect(needs("publish-build")).toContain("release-push")
  expect(needs("release-undraft")).toContain("release-assets")
  expect(needs("release-undraft")).toContain("publish-build")
  expect(jobs.version?.permissions).toEqual({ contents: "read" })
  expect(jobs["release-draft"]?.permissions).toEqual({ contents: "write" })
  expect(jobs["release-assets"]?.permissions).toEqual({ contents: "write" })
  expect(jobs["publish-build"]?.permissions).toEqual({ contents: "read", packages: "write" })
  expect(jobs["release-undraft"]?.permissions).toEqual({ contents: "write" })
  expect(jobs.publish?.permissions).toEqual({ contents: "read", "id-token": "write" })
  expect(jobs.publish?.environment).toBe("release")
})

test("every job has a timeout and no checkout keeps its credentials", () => {
  const jobs: Record<
    string,
    { "timeout-minutes"?: number; uses?: string; steps?: { uses?: string; with?: Record<string, unknown> }[] }
  > = workflow.jobs
  for (const [name, job] of Object.entries(jobs)) {
    if (job.uses) continue
    expect([name, typeof job["timeout-minutes"]]).toEqual([name, "number"])
    for (const step of job.steps ?? []) {
      if (!step.uses?.startsWith("actions/checkout@")) continue
      expect([name, step.with?.["persist-credentials"]]).toEqual([name, false])
    }
  }
})
