import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import type { Launch } from "../src/backend"
import type { Profile } from "../src/profile"
import { generate } from "../src/windows"

const helper = process.env.KILO_WINDOWS_SANDBOX_HELPER
const enabled = process.platform === "win32" && helper !== undefined && path.win32.isAbsolute(helper)

function write(target: string) {
  try {
    writeFileSync(target, "ok")
    return true
  } catch {
    return false
  }
}

test.skipIf(!enabled)("Windows helper enforces writes through the generated backend launch", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kilo-sandbox-windows-"))
  const project = path.join(root, "project")
  const temp = path.join(root, "temp")
  const external = path.join(root, "external")
  const git = path.join(project, ".git")
  mkdirSync(git, { recursive: true })
  mkdirSync(temp)
  mkdirSync(external)
  const marker = path.join(external, "target-started")

  const profile: Profile = {
    filesystem: {
      allowWrite: [
        { path: project, kind: "subtree" },
        { path: temp, kind: "subtree" },
      ],
      denyWrite: [{ path: git, kind: "subtree" }],
      denyNames: [".git"],
      temporaryDirectory: temp,
    },
    network: { mode: "deny", allowedHosts: [] },
    environment: { deny: [], set: {} },
  }
  const code = `
    const fs = require("node:fs");
    const cp = require("node:child_process");
    const paths = JSON.parse(process.argv[1]);
    function write(file) { try { fs.writeFileSync(file, "ok"); return true } catch { return false } }
    const child = cp.spawnSync(process.execPath, ["-e", "require('node:fs').writeFileSync(process.argv[1], 'bad')", paths.child]);
    process.stdout.write(JSON.stringify({
      project: write(paths.project),
      external: write(paths.external),
      git: write(paths.git),
      temp: write(paths.temp),
      child: child.status === 0,
    }));
  `
  const paths = {
    project: path.join(project, "project.txt"),
    external: path.join(external, "external.txt"),
    git: path.join(git, "config"),
    temp: path.join(temp, "temp.txt"),
    child: path.join(external, "child.txt"),
  }
  const launch: Launch = {
    command: process.execPath,
    args: ["-e", code, JSON.stringify(paths)],
    cwd: project,
      environment: {
        ...process.env,
        KILO_WINDOWS_SANDBOX_HELPER: undefined,
        KILO_WINDOWS_SANDBOX_PROTOTYPE: undefined,
      },
  }

  try {
    const output = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const next = yield* generate(profile, launch, helper)
          const child = Bun.spawnSync([next.command, ...next.args], {
            cwd: next.cwd,
            env: next.environment,
            stdout: "pipe",
            stderr: "pipe",
          })
          expect(child.exitCode).toBe(0)
          return child.stdout.toString()
        }),
      ),
    )
    expect(JSON.parse(output)).toEqual({ project: true, external: false, git: false, temp: true, child: false })

    await expect(
      Effect.runPromise(Effect.scoped(generate(profile, { ...launch, args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "bad")`] }, path.join(root, "missing.exe")))),
    ).rejects.toThrow("helper is not available")
    expect(existsSync(marker)).toBe(false)

    const invalid: Profile = {
      ...profile,
      filesystem: { ...profile.filesystem, allowWrite: [{ path: path.join(root, "missing"), kind: "subtree" }] },
    }
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const next = yield* generate(invalid, { ...launch, args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "bad")`] }, helper)
          const failed = Bun.spawnSync([next.command, ...next.args], { cwd: next.cwd, env: next.environment })
          expect(failed.exitCode).not.toBe(0)
        }),
      ),
    )
    expect(existsSync(marker)).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
