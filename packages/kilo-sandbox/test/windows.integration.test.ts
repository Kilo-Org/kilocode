import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { prepare, type Launch } from "../src/backend"
import { run } from "../src/context"
import type { Profile } from "../src/profile"

const enabled = process.platform === "win32" && process.env.KILO_WINDOWS_SANDBOX_HELPER !== undefined
const suite = enabled ? describe : describe.skip

suite("Windows process sandbox integration", () => {
  const root = enabled ? fs.mkdtempSync(path.join(os.tmpdir(), "kilo-sandbox-")) : ""
  const project = path.join(root, "project")
  const outside = path.join(root, "outside")
  const temp = path.join(root, "temp")
  const git = path.join(project, ".git")
  const profile: Profile = {
    filesystem: {
      allowWrite: [
        { path: project, kind: "subtree" },
        { path: temp, kind: "subtree" },
      ],
      denyWrite: [{ path: git, kind: "subtree" }],
      denyNames: [".git"],
    },
    network: { mode: "allow", allowedHosts: [] },
    environment: { deny: [], set: { TEMP: temp, TMP: temp } },
  }

  beforeAll(() => {
    fs.mkdirSync(project)
    fs.mkdirSync(outside)
    fs.mkdirSync(temp)
    fs.mkdirSync(git)
  })

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  async function write(target: string) {
    const launch: Launch = {
      command: "cmd.exe",
      args: ["/d", "/c", "echo sandboxed>%KILO_TEST_PATH%"],
      cwd: project,
      environment: {
        ...process.env,
        KILO_TEST_PATH: target,
      },
      shell: false,
    }
    const next = await Effect.runPromise(Effect.scoped(run(profile, prepare(launch))))
    const child = Bun.spawn([next.command, ...next.args], {
      cwd: next.cwd,
      env: next.environment,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    return { code, output: `${stdout}\n${stderr}` }
  }

  test("allows project and temp writes", async () => {
    const allowed = path.join(project, "allowed.txt")
    const temporary = path.join(temp, "allowed.txt")

    const projectResult = await write(allowed)
    const tempResult = await write(temporary)

    expect(projectResult.code, projectResult.output).toBe(0)
    expect(tempResult.code, tempResult.output).toBe(0)
    expect(fs.readFileSync(allowed, "utf8").trim()).toBe("sandboxed")
    expect(fs.readFileSync(temporary, "utf8").trim()).toBe("sandboxed")
  })

  test("denies writes outside the allowed roots", async () => {
    const target = path.join(outside, "denied.txt")
    const result = await write(target)

    expect(result.code).not.toBe(0)
    expect(fs.existsSync(target), result.output).toBe(false)
  })

  test("denies writes to .git under an allowed root", async () => {
    const target = path.join(git, "denied.txt")
    const result = await write(target)

    expect(result.code).not.toBe(0)
    expect(fs.existsSync(target), result.output).toBe(false)
  })
})
