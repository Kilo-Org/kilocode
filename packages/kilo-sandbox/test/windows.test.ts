import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { Effect } from "effect"
import type { Launch } from "../src/backend"
import type { Profile } from "../src/profile"
import { generate, protocol, request, resolveExecutable } from "../src/windows"

const profile: Profile = {
  filesystem: {
    allowWrite: [{ path: "C:\\workspace", kind: "subtree" }],
    denyWrite: [{ path: "C:\\workspace\\.git", kind: "subtree" }],
    denyNames: [".git"],
    temporaryDirectory: "C:\\workspace\\tmp",
  },
  network: { mode: "deny", allowedHosts: [] },
  environment: { deny: [], set: {} },
}

const launch: Launch = {
  command: "tool",
  args: ["hello", "world"],
  cwd: "C:\\workspace",
  environment: { Path: "C:\\safe;C:\\other", PATHEXT: ".EXE;.CMD", SAFE: "yes" },
}

describe("Windows sandbox backend", () => {
  test("resolves commands only through the supplied PATH and PATHEXT", () => {
    const seen: Array<string> = []
    const result = resolveExecutable("tool", "C:\\workspace", launch.environment ?? {}, (target) => {
      seen.push(target)
      return target.toLowerCase() === "c:\\other\\tool.cmd"
    })
    expect(result).toBe("C:\\other\\tool.CMD")
    expect(seen).toEqual([
      "C:\\safe\\tool.EXE",
      "C:\\safe\\tool.CMD",
      "C:\\other\\tool.EXE",
      "C:\\other\\tool.CMD",
    ])
  })

  test("does not fall back to PATH for a relative command containing separators", () => {
    const seen: Array<string> = []
    const result = resolveExecutable("bin\\tool.exe", "C:\\workspace", launch.environment ?? {}, (target) => {
      seen.push(target)
      return false
    })
    expect(result).toBeUndefined()
    expect(seen).toEqual(["C:\\workspace\\bin\\tool.exe"])
  })

  test("generates the bounded versioned helper request without environment", () => {
    const result = request(profile, launch, "C:\\safe\\tool.exe")
    expect(result).toEqual({
      version: protocol,
      command: "C:\\safe\\tool.exe",
      args: ["hello", "world"],
      cwd: "C:\\workspace",
      allowWrite: profile.filesystem.allowWrite,
      denyWrite: profile.filesystem.denyWrite,
      denyNames: [".git"],
      temporaryDirectory: "C:\\workspace\\tmp",
    })
    expect(result).not.toHaveProperty("environment")
  })

  test("writes a scoped request and preserves the helper environment", async () => {
    let target = ""
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const next = yield* generate(
            profile,
            launch,
            "C:\\kilo\\kilo-sandbox-win.exe",
            (item) => item.toLowerCase() === "c:\\safe\\tool.exe",
            () => true,
          )
          target = next.args[1]
          expect(path.isAbsolute(target)).toBe(true)
          expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(
            request(profile, launch, "C:\\safe\\tool.EXE"),
          )
          return next
        }),
      ),
    )
    expect(result.command).toBe("C:\\kilo\\kilo-sandbox-win.exe")
    expect(result.args).toEqual(["--request", target])
    expect(result.environment).toEqual(launch.environment ?? {})
    expect(result.environment).not.toBe(launch.environment)
    expect(existsSync(target)).toBe(false)
  })

  test("rejects literal allow rules before writing a request", async () => {
    await expect(
      Effect.runPromise(
        Effect.scoped(
          generate(
            { ...profile, filesystem: { ...profile.filesystem, allowWrite: [{ path: "C:\\workspace", kind: "literal" }] } },
            launch,
            "C:\\helper.exe",
            () => true,
            () => true,
          ),
        ),
      ),
    ).rejects.toThrow("only supports subtree")
  })

  test("fails closed for unresolved commands", async () => {
    await expect(
      Effect.runPromise(
        Effect.scoped(generate(profile, { ...launch, command: "missing" }, "C:\\helper.exe", () => false, () => true)),
      ),
    ).rejects.toThrow("Could not securely resolve")
  })

  test("resolves requested shell inside the backend", async () => {
    const body = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* generate(
            profile,
            { ...launch, command: "echo hello", args: [], shell: true, environment: { COMSPEC: "C:\\Windows\\cmd.exe" } },
            "C:\\helper.exe",
            (target) => target.toLowerCase() === "c:\\windows\\cmd.exe",
            () => true,
          )
          return JSON.parse(readFileSync(result.args[1], "utf8"))
        }),
      ),
    )
    expect(body.command).toBe("C:\\Windows\\cmd.exe")
    expect(body.args).toEqual(["/d", "/s", "/c", "echo hello"])
  })
})
