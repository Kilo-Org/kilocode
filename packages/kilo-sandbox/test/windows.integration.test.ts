import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import type { Launch } from "../src/backend"
import type { Profile } from "../src/profile"
import { generate, resolveExecutable } from "../src/windows"

const helper = process.env.KILO_WINDOWS_SANDBOX_HELPER
const enabled = process.platform === "win32" && helper !== undefined && path.win32.isAbsolute(helper)

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
    child: path.join(external, "child.txt"),
  }
  const child = path.join(project, "child.cmd")
  const script = path.join(project, "probe.cmd")
  const blocked = path.join(project, "blocked.cmd")
  const marker = path.join(external, "target-started")
  writeFileSync(child, `@echo off\r\necho bad>"${paths.child}"\r\nexit /b 0\r\n`)
  writeFileSync(blocked, `@echo off\r\necho bad>"${marker}"\r\nexit /b 0\r\n`)
  writeFileSync(
    script,
    [
      "@echo off",
      `echo ok>"${paths.project}"`,
      `echo bad>"${paths.external}"`,
      `echo bad>"${paths.git}"`,
      `echo ok>"${paths.temp}"`,
      `"%ComSpec%" /d /s /c ""${child}""`,
      "exit /b 0",
      "",
    ].join("\r\n"),
  )

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
  const command = resolveExecutable(process.env.COMSPEC ?? "cmd.exe", project, process.env)
  if (!command) throw new Error("Could not resolve cmd.exe for the Windows sandbox test")
  const launch: Launch = {
    command,
    args: ["/d", "/s", "/c", script],
    cwd: project,
    environment: {
      ...process.env,
      KILO_WINDOWS_SANDBOX_HELPER: undefined,
      KILO_WINDOWS_SANDBOX_PROTOTYPE: undefined,
      TEMP: temp,
      TMP: temp,
      TMPDIR: temp,
    },
  }
  const blockedLaunch = { ...launch, args: ["/d", "/s", "/c", blocked] }

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
    expect(existsSync(paths.child)).toBe(false)

    await expect(
      Effect.runPromise(Effect.scoped(generate(profile, blockedLaunch, path.join(root, "missing.exe")))),
    ).rejects.toThrow("helper is not available")
    expect(existsSync(marker)).toBe(false)

    const invalid: Profile = {
      ...profile,
      filesystem: { ...profile.filesystem, allowWrite: [{ path: path.join(root, "missing"), kind: "subtree" }] },
    }
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const next = yield* generate(invalid, blockedLaunch, helper)
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
