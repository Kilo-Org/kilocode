import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { backendSupport, prepare, type Launch } from "../src/backend"
import { run } from "../src/context"
import type { Profile } from "../src/profile"
import { generate } from "../src/seatbelt"

function makeProfile(): Profile {
  return {
    filesystem: {
      allowWrite: [{ path: "/workspace", kind: "subtree" }],
      denyWrite: [{ path: "/workspace/.git", kind: "subtree" }],
      denyNames: [".git"],
    },
    network: { mode: "deny", allowedHosts: ["example.com"] },
    environment: { deny: ["DROP", "RESET"], set: { KEEP: "profile", RESET: "removed" } },
  }
}

const launch: Launch = {
  command: "/bin/echo",
  args: ["hello"],
  cwd: "/workspace",
  environment: { KEEP: "launch", DROP: "secret" },
}

describe("sandbox launch preparation", () => {
  test("generates a globally overriding overlapping deny policy with parameterized paths", () => {
    const result = generate(makeProfile(), launch)
    const policy = result.args[1]
    expect(policy).toContain('(require-any (literal (param "ALLOW_WRITE_0")) (subpath (param "ALLOW_WRITE_0")))')
    expect(policy).toContain('(require-not (literal (param "DENY_WRITE_0")))')
    expect(policy).toContain('(require-not (subpath (param "DENY_WRITE_0")))')
    expect(policy).toContain('(require-not (regex #"(^|/)\\.git(/|$)"))')
    expect(policy).toContain("(allow file-read*)")
    expect(policy).toContain("(allow network-outbound)")
    expect(policy).toContain("(allow network-inbound)")
    expect(policy).not.toContain("/workspace/.git")
    expect(result.args).toContain("-DALLOW_WRITE_0=/workspace")
    expect(result.args).toContain("-DDENY_WRITE_0=/workspace/.git")
    expect(result.args.slice(-3)).toEqual(["--", "/bin/echo", "hello"])
  })

  test("places shell commands inside the sandbox backend", () => {
    const result = generate(makeProfile(), { ...launch, command: "echo hello", args: [], shell: "/bin/zsh" })
    expect(result.args.slice(-4)).toEqual(["--", "/bin/zsh", "-c", "echo hello"])

    const args = generate(makeProfile(), {
      ...launch,
      command: "printf",
      args: ["%s", "hello world"],
      shell: true,
    })
    expect(args.args.slice(-4)).toEqual(["--", "/bin/sh", "-c", "printf '%s' 'hello world'"])
  })

  test("passes the launch through unchanged when no profile is active", async () => {
    const result = await Effect.runPromise(Effect.scoped(prepare(launch)))
    expect(result.command).toBe(launch.command)
    expect(result.args).toBe(launch.args)
    expect(result.cwd).toBe(launch.cwd)
    expect(result.environment).toBe(launch.environment)
  })

  test("merges profile environment values and applies exact deny names", async () => {
    const result = await Effect.runPromise(Effect.scoped(run(makeProfile(), prepare(launch))))
    expect(result.environment?.KEEP).toBe("profile")
    expect(result.environment?.DROP).toBeUndefined()
    expect(result.environment?.RESET).toBeUndefined()
    expect(result.environment?.PATH).toBeUndefined()
  })

  test("reports backend support with a reason when unavailable", () => {
    expect(typeof backendSupport.available).toBe("boolean")
    if (!backendSupport.available) expect(backendSupport.reason?.length).toBeGreaterThan(0)
  })
})
