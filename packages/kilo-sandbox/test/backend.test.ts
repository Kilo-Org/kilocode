import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect, PlatformError, Result } from "effect"
import { backendSupport, confine, prepare, type Launch } from "../src/backend"
import { generate as generateBubblewrap, parseMountinfo } from "../src/bubblewrap"
import { run } from "../src/context"
import { settle } from "../src/mutation"
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

  test("keeps the host network namespace in Linux allow mode", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "kilo-bubblewrap-policy-"))
    const git = path.join(root, ".git")
    mkdirSync(git)
    writeFileSync(path.join(git, "config"), "original")
    const profile: Profile = {
      ...makeProfile("allow"),
      filesystem: {
        allowWrite: [{ path: root, kind: "subtree" }],
        denyWrite: [],
        denyNames: [".git"],
      },
    }

    try {
      const result = generateBubblewrap(profile, { ...launch, cwd: root }, "/opt/kilo/bwrap")
      const writable = result.args.indexOf("--bind")
      const protectedPath = result.args.indexOf("--ro-bind", writable + 1)
      expect(result.command).toBe("/opt/kilo/bwrap")
      expect(writable).toBeGreaterThan(-1)
      expect(protectedPath).toBeGreaterThan(writable)
      expect(result.args.slice(protectedPath, protectedPath + 3)).toEqual(["--ro-bind", git, git])
      expect(result.args).not.toContain("--unshare-net")
      expect(result.args.slice(-3)).toEqual(["--", "/bin/echo", "hello"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("isolates the Linux network namespace in deny mode", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "kilo-bubblewrap-network-"))
    const input = makeProfile("deny")
    const profile: Profile = {
      ...input,
      filesystem: {
        allowWrite: [{ path: root, kind: "subtree" }],
        denyWrite: [],
        denyNames: [],
      },
    }

    try {
      const result = generateBubblewrap(profile, { ...launch, cwd: root }, "/opt/kilo/bwrap")
      expect(result.args).toContain("--unshare-net")
      expect(result.args.indexOf("--unshare-net")).toBeGreaterThan(result.args.indexOf("--unshare-pid"))
      expect(result.args.slice(-3)).toEqual(["--", "/bin/echo", "hello"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("parses escaped mount points from Linux mountinfo", () => {
    const content = [
      String.raw`36 25 0:32 / / rw,relatime - overlay overlay rw`,
      String.raw`37 36 0:33 / /tmp/kilo\040root rw - tmpfs tmpfs rw`,
      String.raw`38 37 0:34 / /tmp/kilo\040root/nested\011mount rw - tmpfs tmpfs rw`,
      String.raw`39 36 0:35 / /tmp/back\134slash rw - tmpfs tmpfs rw`,
      "",
    ].join("\n")

    expect(parseMountinfo(content)).toEqual(["/", "/tmp/kilo root", "/tmp/kilo root/nested\tmount", "/tmp/back\\slash"])
  })

  test("allows a mounted writable root but rejects nested mount points", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "kilo-bubblewrap-mount-"))
    const nested = path.join(root, "nested mount")
    const profile: Profile = {
      ...makeProfile("allow"),
      filesystem: {
        allowWrite: [{ path: root, kind: "subtree" }],
        denyWrite: [],
        denyNames: [],
      },
    }

    try {
      expect(() => generateBubblewrap(profile, launch, "/opt/kilo/bwrap", [root])).not.toThrow()
      expect(() => generateBubblewrap(profile, launch, "/opt/kilo/bwrap", [root, nested])).toThrow(
        `Writable root contains a nested mount point: ${nested}`,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("rejects a Bubblewrap executable inside a writable root", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "kilo-bubblewrap-helper-"))
    const helper = path.join(root, "bwrap")
    writeFileSync(helper, "helper")
    const profile: Profile = {
      ...makeProfile("allow"),
      filesystem: {
        allowWrite: [{ path: root, kind: "subtree" }],
        denyWrite: [],
        denyNames: [],
      },
    }

    try {
      expect(() => generateBubblewrap(profile, launch, helper)).toThrow("writable by the sandbox profile")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("passes the launch through unchanged when no profile is active", async () => {
    const result = await Effect.runPromise(Effect.scoped(prepare(launch)))
    expect(result.command).toBe(launch.command)
    expect(result.args).toBe(launch.args)
    expect(result.cwd).toBe(launch.cwd)
    expect(result.environment).toBe(launch.environment)
  })

  test("merges profile environment values and applies exact deny names", async () => {
    const result = await Effect.runPromise(Effect.scoped(run(makeProfile("allow"), prepare(launch))))
    expect(result.environment?.KEEP).toBe("profile")
    expect(result.environment?.DROP).toBeUndefined()
    expect(result.environment?.RESET).toBeUndefined()
    expect(result.environment?.HTTPS_PROXY).toBe("http://127.0.0.1:9000")
    expect(result.environment?.no_proxy).toBe("*")
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

  test("fails allowed-host profiles closed through explicit confinement", async () => {
    const input = makeProfile("allow")
    const result = await Effect.runPromise(
      Effect.scoped(confine({ ...input, network: { mode: "allow", allowedHosts: ["example.com"] } }, launch)).pipe(
        Effect.result,
      ),
    )
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure.reason._tag).toBe("BadResource")
      expect(result.failure.message).toContain("proxy network mode and allowedHosts are not supported")
    }
  })

  test("preserves worker stderr when the request pipe also fails", async () => {
    const pipe = Object.assign(new Error("write EPIPE"), { code: "EPIPE" })
    const cause = await settle(
      Promise.reject(pipe),
      Promise.resolve(Buffer.alloc(0)),
      Promise.resolve(Buffer.from("useful worker failure")),
      Promise.resolve(7),
      "/workspace/value.txt",
    ).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(cause).toBeInstanceOf(PlatformError.PlatformError)
    if (!(cause instanceof PlatformError.PlatformError)) return
    expect(cause.reason.description).toBe("useful worker failure")
    expect(cause.reason.cause).toBe(pipe)
  })

  test("reports backend support with a reason when unavailable", () => {
    for (const network of [undefined, makeProfile("deny").network]) {
      const support = backendSupport(network)
      expect(typeof support.available).toBe("boolean")
      if (!support.available) expect(support.reason?.length).toBeGreaterThan(0)
    }
  })
})
