import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Launch } from "../src/backend"
import type { Profile } from "../src/profile"
import { windows } from "../src/windows"

const key = "KILO_WINDOWS_SANDBOX_HELPER"
const original = process.env[key]

const profile: Profile = {
  filesystem: {
    allowWrite: [{ path: "C:\\workspace", kind: "subtree" }],
    denyWrite: [{ path: "C:\\workspace\\.git", kind: "subtree" }],
    denyNames: [".git"],
  },
  network: { mode: "allow", allowedHosts: [] },
  environment: { deny: [], set: {} },
}

const launch: Launch = {
  command: "powershell.exe",
  args: ["-NoProfile", "-Command", "Write-Output ok"],
  cwd: "C:\\workspace",
  environment: { KEEP: "value" },
  shell: false,
}

afterEach(() => {
  if (original === undefined) delete process.env[key]
  else process.env[key] = original
})

describe("Windows sandbox backend", () => {
  test("wraps a launch with the normalized filesystem profile", async () => {
    const helper = `${process.cwd()}/kilo-sandbox-win.exe`
    await Bun.write(helper, "test")
    process.env[key] = helper

    try {
      const result = await Effect.runPromise(Effect.scoped(windows.prepare(profile, launch)))
      expect(result.command).toBe(helper)
      expect(result.args).toEqual(["--", launch.command, ...launch.args])
      expect(result.cwd).toBe(launch.cwd)
      expect(result.environment?.KEEP).toBe("value")
      expect(result.environment?.KILO_SANDBOX_PARENT_PID).toBe(String(process.pid))

      const encoded = result.environment?.KILO_SANDBOX_PROFILE
      expect(encoded).toBeDefined()
      const decoded = JSON.parse(Buffer.from(encoded!, "base64").toString())
      expect(decoded).toEqual({ version: 1, filesystem: profile.filesystem })
    } finally {
      await Bun.file(helper).delete()
    }
  })

  test("fails closed when the helper is missing", async () => {
    process.env[key] = `${process.cwd()}/missing-kilo-sandbox-win.exe`
    const result = Effect.runPromiseExit(Effect.scoped(windows.prepare(profile, launch)))
    expect((await result)._tag).toBe("Failure")
  })
})
