import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import type { Profile } from "../src/profile"
import { socketPolicy } from "../src/socket"

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

  test("always denies known container authority and canonicalizes aliases and absent paths", async () => {
    const docker = path.join(runtime, "docker.sock")
    const podman = path.join(runtime, "podman", "podman.sock")
    const result = await Effect.runPromise(
      socketPolicy(profile(), {
        HOME: root,
        XDG_RUNTIME_DIR: runtime,
        DOCKER_HOST: `unix://${docker}`,
        CONTAINER_HOST: `unix://${podman}`,
        PODMAN_HOST: podman,
        CONTAINERD_ADDRESS: `unix://${path.join(runtime, "containerd.sock")}`,
        CONTAINER_RUNTIME_ENDPOINT: `unix://${path.join(runtime, "cri.sock")}`,
      }),
    )
    const paths = result.paths.map((item) => item.path)

    expect(result.coverage).toEqual(["docker", "podman", "containerd", "cri"])
    expect(result.deny).toContain("DOCKER_HOST")
    expect(result.deny).toContain("CONTAINER_HOST")
    expect(result.deny).toContain("CONTAINER_RUNTIME_ENDPOINT")
    expect(paths).toContain(path.join(canonical, "docker.sock"))
    expect(paths).toContain(path.join(canonical, "podman", "podman.sock"))
    expect(paths.filter((item) => item === path.join(canonical, "docker.sock"))).toHaveLength(1)
    expect(result.paths.every((item) => item.kind === "literal")).toBe(true)
    if (typeof process.getuid === "function") {
      expect(paths).toContain(`/run/user/${process.getuid()}/docker.sock`)
      expect(paths).toContain(`/run/user/${process.getuid()}/podman/podman.sock`)
    }
  })

  test("adds SSH, GPG, D-Bus, and Wayland only for restrictive IPC", async () => {
    const ssh = path.join(runtime, "ssh.sock")
    const gpg = path.join(runtime, "gpg.sock")
    const bus = path.join(runtime, "bus socket")
    const env = {
      XDG_RUNTIME_DIR: runtime,
      SSH_AUTH_SOCK: ssh,
      GPG_AGENT_INFO: `${gpg}:123:1`,
      GNUPGHOME: path.join(runtime, "custom-gnupg"),
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${encodeURIComponent(bus)},guid=abc;tcp:host=localhost`,
      WAYLAND_DISPLAY: "wayland-0",
    }
    const allowed = await Effect.runPromise(socketPolicy(profile("allow"), env))
    const denied = await Effect.runPromise(socketPolicy(profile("deny"), env))
    const input = profile()
    const restricted = await Effect.runPromise(socketPolicy({ ...input, network: { mode: "deny", allowedHosts: [] } }, env))
    const paths = denied.paths.map((item) => item.path)

    expect(allowed.coverage).toEqual(["docker", "podman", "containerd", "cri"])
    expect(allowed.deny).not.toContain("SSH_AUTH_SOCK")
    expect(restricted.coverage).toEqual(denied.coverage)
    expect(denied.coverage).toEqual(["docker", "podman", "containerd", "cri", "ssh", "gpg", "dbus", "wayland"])
    expect(denied.deny).toEqual(expect.arrayContaining(["SSH_AUTH_SOCK", "GPG_AGENT_INFO", "DBUS_SESSION_BUS_ADDRESS", "WAYLAND_DISPLAY"]))
    expect(paths).toEqual(
      expect.arrayContaining([
        path.join(canonical, "ssh.sock"),
        path.join(canonical, "gpg.sock"),
        path.join(canonical, "bus socket"),
        path.join(canonical, "bus"),
        path.join(canonical, "custom-gnupg", "S.gpg-agent"),
        path.join(canonical, "wayland-0"),
      ]),
    )
    if (typeof process.getuid === "function") expect(paths).toContain(`/run/user/${process.getuid()}/bus`)
  })

  test("parses pathname Unix URLs and ignores non-path endpoints honestly", async () => {
    const encoded = encodeURIComponent(path.join(runtime, "encoded socket"))
    const result = await Effect.runPromise(
      socketPolicy(profile("deny"), {
        DOCKER_HOST: `http+unix://${encoded}`,
        CONTAINER_HOST: "ssh://builder/run/user/1000/podman.sock",
        DBUS_SESSION_BUS_ADDRESS: "unix:abstract=/tmp/dbus-abstract",
        DBUS_SYSTEM_BUS_ADDRESS: "tcp:host=localhost",
        WAYLAND_DISPLAY: "wayland-1",
      }),
    )
    const paths = result.paths.map((item) => item.path)

    expect(paths).toContain(path.join(canonical, "encoded socket"))
    const standard = await Effect.runPromise(
      socketPolicy(profile(), { DOCKER_HOST: `unix://${path.join(runtime, "standard.sock")}` }),
    )
    const remote = await Effect.runPromise(
      socketPolicy(profile(), { DOCKER_HOST: "tcp://builder:2375", CONTAINER_HOST: "ssh://builder" }),
    )
    const malformed = await Effect.runPromise(socketPolicy(profile(), { DOCKER_HOST: "unix://relative.sock" }))
    expect(standard.paths.map((item) => item.path)).toContain(path.join(canonical, "standard.sock"))
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
