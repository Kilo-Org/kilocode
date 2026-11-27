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
  const dir = path.join(root, "out")
  const sha256 = await Stage.write(dir, {
    version: "1.2.3",
    tarballs: [
      { name: "@kilocode/cli-linux-x64", version: "1.2.3", path: tarball },
      { name: "@kilocode/cli", version: "1.2.3", path: launcher },
    ],
    files: [evidence],
    entries: [{ artifact: "kilocode-cli-1.2.3.tgz", sha256: "a".repeat(64), distribution: "npm" }],
  })
  return { dir, sha256 }
}

test("read returns the stage publish-build wrote, in publishing order, with absolute paths", async () => {
  const { dir, sha256 } = await stage()
  const read = await Stage.read(dir, sha256, "1.2.3")
  expect(read.tarballs.map((item) => item.name)).toEqual(["@kilocode/cli-linux-x64", "@kilocode/cli"])
  expect(read.tarballs.every((item) => path.isAbsolute(item.file) && path.dirname(item.file) === dir)).toBe(true)
  expect(read.files).toEqual([path.join(dir, "cli-distribution-sbom-evidence.json")])
  expect(read.entries).toHaveLength(1)
})

test("read refuses a replaced stage file, a replaced tarball, another version and a path in a name", async () => {
  const fail = (promise: Promise<unknown>) =>
    promise.then(
      () => "",
      (err: unknown) => String(err),
    )
  {
    const { dir, sha256 } = await stage()
    expect(await fail(Stage.read(dir, "b".repeat(64), "1.2.3"))).toContain("publish-build recorded")
    expect(await fail(Stage.read(dir, sha256, "1.2.4"))).toContain('is for version "1.2.3", not 1.2.4')
    expect(await fail(Stage.read(dir, "", "1.2.3"))).toContain("recorded no stage digest")
    await writeFile(path.join(dir, "kilocode-cli-1.2.3.tgz"), "another launcher")
    expect(await fail(Stage.read(dir, sha256, "1.2.3"))).toContain("kilocode-cli-1.2.3.tgz has sha256")
  }
  {
    const { dir } = await stage()
    const file = path.join(dir, Stage.FILENAME)
    const text = (await readFile(file, "utf8")).replace('"file": "kilocode-cli-1.2.3.tgz"', '"file": "../escape.tgz"')
    await writeFile(file, text)
    const digest = new Bun.CryptoHasher("sha256").update(text).digest("hex")
    expect(await fail(Stage.read(dir, digest, "1.2.3"))).toContain("Invalid stage file")
  }
})

test("the release jobs run in today's user-visible order, each with only the permissions it needs", () => {
  const jobs: Record<
    string,
    { needs?: string[] | string; permissions?: Record<string, string>; environment?: string }
  > = workflow.jobs
  const needs = (name: string) => [jobs[name]?.needs ?? []].flat()
  expect(needs("publish-build")).toContain("release-push")
  expect(needs("release-undraft")).toContain("release-assets")
  expect(needs("release-undraft")).toContain("publish-build")
  expect(jobs["release-assets"]?.permissions).toEqual({ contents: "write" })
  expect(jobs["publish-build"]?.permissions).toEqual({ contents: "read", packages: "write" })
  expect(jobs["release-undraft"]?.permissions).toEqual({ contents: "write" })
  expect(jobs.publish?.permissions).toEqual({ contents: "read", "id-token": "write" })
  expect(jobs.publish?.environment).toBe("release")
})
