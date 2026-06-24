import { describe, expect, test } from "bun:test"
import { Effect, Result } from "effect"
import { backendSupport, prepare, type Launch } from "../src/backend"
import { run } from "../src/context"
import type { Profile } from "../src/profile"
import { generate } from "../src/seatbelt"

function makeProfile(mode: Profile["network"]["mode"] = "deny"): Profile {
  return {
    filesystem: {
      allowWrite: [{ path: "/workspace", kind: "subtree" }],
      denyWrite: [{ path: "/workspace/.git", kind: "subtree" }],
      denyNames: [".git"],
    },
    network: { mode, allowedHosts: mode === "proxy" ? ["example.com"] : [] },
    environment: { deny: ["DROP", "RESET"], set: { KEEP: "profile", RESET: "removed" } },
  }
}

const launch: Launch = {
  command: "/bin/echo",
  args: ["hello"],
  cwd: "/workspace",
  environment: {
    KEEP: "launch",
    DROP: "secret",
    HTTPS_PROXY: "http://127.0.0.1:9000",
    no_proxy: "*",
  },
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
    expect(policy).toContain("sandbox network mode: deny")
    expect(policy).toContain("(deny network-outbound")
    expect(policy).not.toContain("(allow network-outbound)")
    expect(policy).toContain("(allow network-inbound)")
    expect(policy).not.toContain("/workspace/.git")
    expect(result.args).toContain("-DALLOW_WRITE_0=/workspace")
    expect(result.args).toContain("-DDENY_WRITE_0=/workspace/.git")
    expect(result.args.slice(-3)).toEqual(["--", "/bin/echo", "hello"])
  })

  test("preserves unrestricted networking in allow mode", () => {
    const result = generate(makeProfile("allow"), launch)
    const policy = result.args[1]
    expect(policy).toContain("sandbox network mode: allow")
    expect(policy).toContain("(allow network-outbound)")
    expect(policy).toContain("(allow network-inbound)")
    expect(policy).not.toContain("(deny network-outbound")
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
    expect(result.environment?.HTTPS_PROXY).toBeUndefined()
    expect(result.environment?.no_proxy).toBeUndefined()
    expect(result.environment?.PATH).toBeUndefined()
  })

  test("fails proxy mode closed before launching a process", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(run(makeProfile("proxy"), prepare(launch))).pipe(Effect.result),
    )
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure.reason._tag).toBe("BadResource")
      expect(result.failure.message).toContain("proxy network mode and allowedHosts are not supported")
    }
  })

  test("fails non-empty allowedHosts closed before launching a process", async () => {
    const input = makeProfile("allow")
    const result = await Effect.runPromise(
      Effect.scoped(run({ ...input, network: { mode: "allow", allowedHosts: ["example.com"] } }, prepare(launch))).pipe(
        Effect.result,
      ),
    )
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure.reason._tag).toBe("BadResource")
      expect(result.failure.message).toContain("proxy network mode and allowedHosts are not supported")
    }
  })

  test("reports backend support with a reason when unavailable", () => {
    expect(typeof backendSupport.available).toBe("boolean")
    if (!backendSupport.available) expect(backendSupport.reason?.length).toBeGreaterThan(0)
  })
})
