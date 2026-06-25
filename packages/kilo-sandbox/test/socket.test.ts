import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { normalize } from "../src/path"
import type { Profile } from "../src/profile"
import { socketPolicy, socketProfile } from "../src/socket"

const linux = process.platform === "linux" ? test : test.skip

function profile(ipc?: "allow" | "deny"): Profile {
  return {
    filesystem: { allowWrite: [], denyWrite: [], denyNames: [] },
    network: { mode: "allow", allowedHosts: [] },
    environment: { deny: [], set: {} },
    ...(ipc ? { socket: { ipc } } : {}),
  }
}

describe("Unix socket policy", () => {
  let root = ""
  let runtime = ""
  let canonical = ""

  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "kilo-sandbox-socket-")))
    canonical = path.join(root, "runtime")
    runtime = path.join(root, "alias")
    await mkdir(canonical)
    await symlink(canonical, runtime, "dir")
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test("always denies known container authority and deduplicates absent paths", () => {
    const docker = path.join(runtime, "docker.sock")
    const podman = path.join(runtime, "podman", "podman.sock")
    const result = socketProfile(profile(), {
      HOME: root,
      XDG_RUNTIME_DIR: runtime,
      DOCKER_HOST: `unix://${docker}`,
      CONTAINER_HOST: `unix://${podman}`,
      PODMAN_HOST: podman,
      CONTAINERD_ADDRESS: `unix://${path.join(runtime, "containerd.sock")}`,
      CONTAINER_RUNTIME_ENDPOINT: `unix://${path.join(runtime, "cri.sock")}`,
    })
    const paths = result.paths.map((item) => item.path)

    expect(result.coverage).toEqual(["docker", "podman", "containerd", "cri"])
    expect(result.deny).toContain("DOCKER_HOST")
    expect(result.deny).toContain("CONTAINER_HOST")
    expect(result.deny).toContain("CONTAINER_RUNTIME_ENDPOINT")
    expect(paths).toContain(docker)
    expect(paths).toContain(podman)
    expect(paths.filter((item) => item === docker)).toHaveLength(1)
    expect(result.paths.every((item) => item.kind === "literal")).toBe(true)
    if (typeof process.getuid === "function") {
      expect(paths).toContain(`/run/user/${process.getuid()}/docker.sock`)
      expect(paths).toContain(`/run/user/${process.getuid()}/podman/podman.sock`)
    }
  })

  linux("canonicalizes socket aliases independently of host runtime paths", async () => {
    const input = profile("deny")
    const result = await Effect.runPromise(
      normalize({
        ...input,
        socket: {
          ipc: "deny",
          policy: {
            paths: [
              { path: path.join(runtime, "docker.sock"), kind: "literal" },
              { path: path.join(canonical, "docker.sock"), kind: "literal" },
            ],
            deny: ["DOCKER_HOST", "DOCKER_HOST"],
            coverage: ["docker", "docker"],
          },
        },
      }),
    )

    expect(result.socket?.policy).toEqual({
      paths: [{ path: path.join(canonical, "docker.sock"), kind: "literal" }],
      deny: ["DOCKER_HOST"],
      coverage: ["docker"],
    })
  })

  linux("omits inaccessible discovered paths outside writable roots", async () => {
    const blocked = path.join(root, "blocked")
    const socket = path.join(blocked, "docker.sock")
    await mkdir(blocked)
    await chmod(blocked, 0o000)

    try {
      const result = await Effect.runPromise(socketPolicy(profile(), { DOCKER_HOST: `unix://${socket}` }))
      expect(result.deny).toContain("DOCKER_HOST")
      expect(result.paths.map((rule) => rule.path)).not.toContain(socket)
    } finally {
      await chmod(blocked, 0o700)
    }
  })

  linux("fails closed for inaccessible aliases into writable roots", async () => {
    const blocked = path.join(canonical, "blocked-write")
    const socket = path.join(runtime, "blocked-write", "docker.sock")
    const input = {
      ...profile(),
      filesystem: { allowWrite: [{ path: canonical, kind: "subtree" as const }], denyWrite: [], denyNames: [] },
    }
    await mkdir(blocked)
    await chmod(blocked, 0o000)

    try {
      const exit = await Effect.runPromise(socketPolicy(input, { DOCKER_HOST: `unix://${socket}` }).pipe(Effect.exit))
      expect(exit._tag).toBe("Failure")
    } finally {
      await chmod(blocked, 0o700)
    }
  })

  test("adds SSH, GPG, D-Bus, and Wayland only for restrictive IPC", () => {
    const ssh = path.join(runtime, "ssh.sock")
    const gpg = path.join(runtime, "gpg:agent.sock")
    const bus = path.join(runtime, "bus socket")
    const env = {
      XDG_RUNTIME_DIR: runtime,
      SSH_AUTH_SOCK: ssh,
      GPG_AGENT_INFO: `${gpg}:123:1`,
      GNUPGHOME: path.join(runtime, "custom-gnupg"),
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${encodeURIComponent(bus)},guid=abc;tcp:host=localhost`,
      WAYLAND_DISPLAY: "wayland-0",
    }
    const allowed = socketProfile(profile("allow"), env)
    const denied = socketProfile(profile("deny"), env)
    const input = profile()
    const restricted = socketProfile({ ...input, network: { mode: "deny", allowedHosts: [] } }, env)
    const paths = denied.paths.map((item) => item.path)

    expect(allowed.coverage).toEqual(["docker", "podman", "containerd", "cri"])
    expect(allowed.deny).not.toContain("SSH_AUTH_SOCK")
    expect(restricted.coverage).toEqual(denied.coverage)
    expect(denied.coverage).toEqual(["docker", "podman", "containerd", "cri", "ssh", "gpg", "dbus", "wayland"])
    expect(denied.deny).toEqual(
      expect.arrayContaining(["SSH_AUTH_SOCK", "GPG_AGENT_INFO", "DBUS_SESSION_BUS_ADDRESS", "WAYLAND_DISPLAY"]),
    )
    expect(paths).toEqual(
      expect.arrayContaining([
        path.join(runtime, "ssh.sock"),
        path.join(runtime, "gpg:agent.sock"),
        path.join(runtime, "bus socket"),
        path.join(runtime, "bus"),
        path.join(runtime, "custom-gnupg", "S.gpg-agent"),
        path.join(runtime, "wayland-0"),
      ]),
    )
    if (typeof process.getuid === "function") expect(paths).toContain(`/run/user/${process.getuid()}/bus`)
  })

  test("parses pathname Unix URLs and ignores non-path endpoints honestly", () => {
    const encoded = encodeURIComponent(path.join(runtime, "encoded socket"))
    const result = socketProfile(profile("deny"), {
      DOCKER_HOST: `http+unix://${encoded}`,
      CONTAINER_HOST: "ssh://builder/run/user/1000/podman.sock",
      DBUS_SESSION_BUS_ADDRESS: "unix:abstract=/tmp/dbus-abstract",
      DBUS_SYSTEM_BUS_ADDRESS: "tcp:host=localhost",
      WAYLAND_DISPLAY: "wayland-1",
    })
    const paths = result.paths.map((item) => item.path)

    expect(paths).toContain(path.join(runtime, "encoded socket"))
    const standard = socketProfile(profile(), { DOCKER_HOST: `unix://${path.join(runtime, "standard.sock")}` })
    const remote = socketProfile(profile(), { DOCKER_HOST: "tcp://builder:2375", CONTAINER_HOST: "ssh://builder" })
    const malformed = socketProfile(profile(), { DOCKER_HOST: "unix://relative.sock" })
    expect(standard.paths.map((item) => item.path)).toContain(path.join(runtime, "standard.sock"))
    expect(remote.deny).not.toContain("DOCKER_HOST")
    expect(remote.deny).not.toContain("CONTAINER_HOST")
    expect(malformed.deny).not.toContain("DOCKER_HOST")
    expect(malformed.paths.map((item) => item.path)).not.toContain("/relative.sock")
    expect(paths).not.toContain("/run/user/1000/podman.sock")
    expect(paths).not.toContain("/tmp/dbus-abstract")
    expect(paths).not.toContain("wayland-1")
    expect(result.deny).not.toContain("CONTAINER_HOST")
    expect(result.coverage).toContain("dbus")
  })
})
