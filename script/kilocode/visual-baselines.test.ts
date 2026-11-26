import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { allowed, apply, DIRS, validate, type Expected } from "./visual-baselines"

const sha = "0123456789abcdef0123456789abcdef01234567"
const expected: Expected = {
  sha,
  ref: "feat/button",
  repo: "Kilo-Org/kilocode",
  prs: [{ number: 42, head: { sha, ref: "feat/button" } }],
}
const ui = DIRS["kilo-ui"]
const vscode = DIRS["kilo-vscode"]
const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function temp() {
  const dir = mkdtempSync(path.join(tmpdir(), "visual-baselines-"))
  dirs.push(dir)
  return dir
}

function write(file: string, data: string | Buffer) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, data)
}

function artifact(
  root: string,
  job: string,
  files: Record<string, string | Buffer>,
  meta: Record<string, unknown> = {},
) {
  const dir = path.join(root, job)
  write(
    path.join(dir, "meta.json"),
    JSON.stringify({
      pr: 42,
      head_sha: sha,
      head_repo: "Kilo-Org/kilocode",
      head_ref: "feat/button",
      deleted: [],
      ...meta,
    }),
  )
  for (const [file, data] of Object.entries(files)) write(path.join(dir, "files", file), data)
  return dir
}

describe("allowed", () => {
  test("accepts PNG files under the prefix only", () => {
    expect(allowed(`${ui}button/primary-chromium-linux.png`, ui)).toBe(true)
    expect(allowed(`${vscode}button/primary-chromium-linux.png`, ui)).toBe(false)
    expect(allowed(`${ui}button/primary.txt`, ui)).toBe(false)
    expect(allowed(`${ui}button/primary.PNG`, ui)).toBe(false)
    expect(allowed(`${ui}../kilo-vscode/x.png`, ui)).toBe(false)
    expect(allowed(`${ui}button/../../../../../../../.github/x.png`, ui)).toBe(false)
    expect(allowed(`${ui}button//x.png`, ui)).toBe(false)
    expect(allowed(`${ui}.hidden/x.png`, ui)).toBe(false)
    expect(allowed(`${ui}button\\x.png`, ui)).toBe(false)
    expect(allowed(`${ui}button/x\n.png`, ui)).toBe(false)
    expect(allowed(`.github/workflows/x.png`, ui)).toBe(false)
  })
})

describe("validate and apply", () => {
  test("copies new images and removes deleted ones", async () => {
    const root = temp()
    const repo = temp()
    write(path.join(repo, ui, "old/gone-chromium-linux.png"), image)
    write(path.join(repo, vscode, "chat/view-chromium-linux.png"), "old")
    artifact(
      root,
      "kilo-ui",
      { [`${ui}button/primary-chromium-linux.png`]: image },
      { deleted: [`${ui}old/gone-chromium-linux.png`] },
    )
    artifact(root, "kilo-vscode", { [`${vscode}chat/view-chromium-linux.png`]: image })

    const plan = await validate(root, expected)
    expect(plan.write.map((item) => item.to)).toEqual([
      `${ui}button/primary-chromium-linux.png`,
      `${vscode}chat/view-chromium-linux.png`,
    ])
    expect(plan.remove).toEqual([`${ui}old/gone-chromium-linux.png`])

    apply(plan, repo)
    expect(readFileSync(path.join(repo, ui, "button/primary-chromium-linux.png"))).toEqual(image)
    expect(readFileSync(path.join(repo, vscode, "chat/view-chromium-linux.png"))).toEqual(image)
    expect(existsSync(path.join(repo, ui, "old/gone-chromium-linux.png"))).toBe(false)
  })

  test("returns an empty plan when no artifact was downloaded", async () => {
    expect(await validate(path.join(temp(), "missing"), expected)).toEqual({ write: [], remove: [] })
  })

  test("refuses a path outside the job's baseline directory", async () => {
    const root = temp()
    artifact(root, "kilo-ui", { [`${vscode}chat/view-chromium-linux.png`]: image })
    await expect(validate(root, expected)).rejects.toThrow("path not allowed")

    const other = temp()
    artifact(other, "kilo-ui", { ".github/workflows/x.png": image })
    await expect(validate(other, expected)).rejects.toThrow("path not allowed")
  })

  test("refuses a non-PNG name and a PNG name without PNG content", async () => {
    const root = temp()
    artifact(root, "kilo-ui", { [`${ui}button/notes.txt`]: "text" })
    await expect(validate(root, expected)).rejects.toThrow("path not allowed")

    const other = temp()
    artifact(other, "kilo-ui", { [`${ui}button/fake.png`]: "#!/bin/sh\n" })
    await expect(validate(other, expected)).rejects.toThrow("not a PNG image")
  })

  test("refuses .. in a deleted path", async () => {
    const root = temp()
    artifact(root, "kilo-ui", {}, { deleted: [`${ui}../../../../../../../.github/workflows/test.yml`] })
    await expect(validate(root, expected)).rejects.toThrow("path not allowed")

    const other = temp()
    artifact(other, "kilo-ui", {}, { deleted: [`${ui}button/../../kilo-vscode/x.png`] })
    await expect(validate(other, expected)).rejects.toThrow("path not allowed")
  })

  test("refuses symlinks in the artifact", async () => {
    const outside = temp()
    write(path.join(outside, "x.png"), image)
    write(path.join(outside, "meta.json"), "{}")

    const file = temp()
    const dir = artifact(file, "kilo-ui", {})
    mkdirSync(path.join(dir, "files", ui), { recursive: true })
    symlinkSync(path.join(outside, "x.png"), path.join(dir, "files", ui, "link.png"))
    await expect(validate(file, expected)).rejects.toThrow("not a regular file")

    const folder = temp()
    const second = artifact(folder, "kilo-ui", {})
    mkdirSync(path.join(second, "files", ui), { recursive: true })
    symlinkSync(outside, path.join(second, "files", ui, "button"))
    await expect(validate(folder, expected)).rejects.toThrow("not a regular file")

    const meta = temp()
    const third = artifact(meta, "kilo-ui", {})
    rmSync(path.join(third, "meta.json"))
    symlinkSync(path.join(outside, "meta.json"), path.join(third, "meta.json"))
    await expect(validate(meta, expected)).rejects.toThrow("missing meta.json")

    const job = temp()
    symlinkSync(outside, path.join(job, "kilo-ui"))
    await expect(validate(job, expected)).rejects.toThrow("not a directory")
  })

  test("refuses unknown artifacts and entries", async () => {
    const root = temp()
    artifact(root, "kilo-other", {})
    await expect(validate(root, expected)).rejects.toThrow("unexpected artifact")

    const proto = temp()
    artifact(proto, "constructor", {})
    await expect(validate(proto, expected)).rejects.toThrow("unexpected artifact")

    const other = temp()
    write(path.join(artifact(other, "kilo-ui", {}), "run.sh"), "echo")
    await expect(validate(other, expected)).rejects.toThrow("unexpected entry")
  })

  test("refuses metadata that does not match the run", async () => {
    for (const meta of [
      { head_sha: "f".repeat(40) },
      { head_ref: "main" },
      { head_repo: "someone/kilocode" },
      { pr: 7 },
      { deleted: "x" },
    ]) {
      const root = temp()
      artifact(root, "kilo-ui", { [`${ui}button/primary-chromium-linux.png`]: image }, meta)
      await expect(validate(root, expected)).rejects.toThrow()
    }
    const root = temp()
    artifact(root, "kilo-ui", {})
    const moved = { ...expected, prs: [{ number: 42, head: { sha: "f".repeat(40), ref: "feat/button" } }] }
    await expect(validate(root, moved)).rejects.toThrow("pull request does not match")
  })

  test("refuses to write through a symlink in the checkout", async () => {
    const root = temp()
    const repo = temp()
    const outside = temp()
    mkdirSync(path.join(repo, path.dirname(ui)), { recursive: true })
    symlinkSync(outside, path.join(repo, ui.slice(0, -1)))
    artifact(root, "kilo-ui", { [`${ui}button/primary-chromium-linux.png`]: image })

    const plan = await validate(root, expected)
    expect(() => apply(plan, repo)).toThrow("symlink in checkout")
    expect(existsSync(path.join(outside, "button"))).toBe(false)
  })
})
