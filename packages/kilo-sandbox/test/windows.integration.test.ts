import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import type { Launch } from "../src/backend"
import type { Profile } from "../src/profile"
import { generate } from "../src/windows"

const helper = process.env.KILO_WINDOWS_SANDBOX_HELPER
const probe = process.env.KILO_WINDOWS_SANDBOX_PROBE
const enabled =
  process.platform === "win32" &&
  helper !== undefined &&
  path.win32.isAbsolute(helper) &&
  probe !== undefined &&
  path.win32.isAbsolute(probe)

test.skipIf(!enabled)("Windows helper enforces writes through the generated backend launch", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kilo-sandbox-windows-"))
  const project = path.join(root, "project")
  const temp = path.join(root, "temp")
  const external = path.join(root, "external")
  const git = path.join(project, ".git")
  mkdirSync(git, { recursive: true })
  mkdirSync(temp)
  mkdirSync(external)

  const paths = {
    project: path.join(project, "project.txt"),
    external: path.join(external, "external.txt"),
    git: path.join(git, "config"),
    temp: path.join(temp, "temp.txt"),
  }
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
  const launch: Launch = {
    command: probe!,
    args: [],
    cwd: project,
    environment: {
      ...process.env,
      KILO_WINDOWS_SANDBOX_HELPER: undefined,
      KILO_WINDOWS_SANDBOX_PROTOTYPE: undefined,
      KILO_WINDOWS_SANDBOX_PROBE: undefined,
      KILO_PROBE_PROJECT: paths.project,
      KILO_PROBE_EXTERNAL: paths.external,
      KILO_PROBE_GIT: paths.git,
      KILO_PROBE_TEMP: paths.temp,
      TEMP: temp,
      TMP: temp,
      TMPDIR: temp,
    },
  }
  const marker = path.join(external, "target-started")
  const blocked = {
    ...launch,
    environment: { ...launch.environment, KILO_PROBE_PROJECT: marker },
  }

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const next = yield* generate(profile, launch, helper)
          const proc = Bun.spawnSync([next.command, ...next.args], {
            cwd: next.cwd,
            env: next.environment,
            stdout: "pipe",
            stderr: "pipe",
          })
          if (proc.exitCode !== 0) {
            throw new Error(`Windows sandbox helper exited ${proc.exitCode}: ${proc.stderr.toString()}`)
          }
        }),
      ),
    )
    expect(existsSync(paths.project)).toBe(true)
    expect(existsSync(paths.external)).toBe(false)
    expect(existsSync(paths.git)).toBe(false)
    expect(existsSync(paths.temp)).toBe(true)

    await expect(
      Effect.runPromise(Effect.scoped(generate(profile, blocked, path.join(root, "missing.exe")))),
    ).rejects.toThrow("helper is not available")
    expect(existsSync(marker)).toBe(false)

    const invalid: Profile = {
      ...profile,
      filesystem: { ...profile.filesystem, allowWrite: [{ path: path.join(root, "missing"), kind: "subtree" }] },
    }
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const next = yield* generate(invalid, blocked, helper)
          const proc = Bun.spawnSync([next.command, ...next.args], {
            cwd: next.cwd,
            env: next.environment,
            stdout: "pipe",
            stderr: "pipe",
          })
          expect(proc.exitCode).not.toBe(0)
        }),
      ),
    )
    expect(existsSync(marker)).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
