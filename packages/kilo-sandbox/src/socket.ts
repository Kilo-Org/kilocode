import path from "node:path"
import { Effect, PlatformError } from "effect"
import { canonicalize } from "./path"
import type { PathRule, Profile, SocketCoverage, SocketPolicy } from "./profile"

type Environment = Readonly<Record<string, string | undefined>>
type Scope = "authority" | "ipc"

interface Endpoint {
  readonly coverage: SocketCoverage
  readonly scope: Scope
  readonly environment: ReadonlyArray<string>
  readonly paths: (environment: Environment) => ReadonlyArray<string | undefined>
}

const authority: ReadonlyArray<Endpoint> = [
  {
    coverage: "docker",
    scope: "authority",
    environment: ["DOCKER_HOST"],
    paths: (env) => [
      "/var/run/docker.sock",
      "/run/docker.sock",
      runtime(env, "docker.sock"),
      home(env, ".docker/run/docker.sock"),
      home(env, ".docker/desktop/docker.sock"),
      unix(env.DOCKER_HOST),
    ],
  },
  {
    coverage: "podman",
    scope: "authority",
    environment: ["CONTAINER_HOST", "PODMAN_HOST"],
    paths: (env) => [
      "/var/run/podman/podman.sock",
      "/run/podman/podman.sock",
      runtime(env, "podman/podman.sock"),
      home(env, ".local/share/containers/podman/machine/podman.sock"),
      unix(env.CONTAINER_HOST),
      unix(env.PODMAN_HOST),
    ],
  },
  {
    coverage: "containerd",
    scope: "authority",
    environment: ["CONTAINERD_ADDRESS"],
    paths: (env) => [
      "/var/run/containerd/containerd.sock",
      "/run/containerd/containerd.sock",
      "/run/k3s/containerd/containerd.sock",
      runtime(env, "containerd/containerd.sock"),
      runtime(env, "containerd-rootless/api.sock"),
      endpoint(env.CONTAINERD_ADDRESS),
    ],
  },
  {
    coverage: "cri",
    scope: "authority",
    environment: ["CRI_ENDPOINT", "CONTAINER_RUNTIME_ENDPOINT", "IMAGE_SERVICE_ENDPOINT"],
    paths: (env) => [
      "/var/run/crio/crio.sock",
      "/run/crio/crio.sock",
      "/var/run/cri-dockerd.sock",
      "/run/cri-dockerd.sock",
      "/var/run/dockershim.sock",
      "/run/dockershim.sock",
      unix(env.CRI_ENDPOINT),
      unix(env.CONTAINER_RUNTIME_ENDPOINT),
      unix(env.IMAGE_SERVICE_ENDPOINT),
    ],
  },
]

const ipc: ReadonlyArray<Endpoint> = [
  {
    coverage: "ssh",
    scope: "ipc",
    environment: ["SSH_AUTH_SOCK", "SSH_AGENT_PID"],
    paths: (env) => [endpoint(env.SSH_AUTH_SOCK)],
  },
  {
    coverage: "gpg",
    scope: "ipc",
    environment: ["GPG_AGENT_INFO"],
    paths: (env) => [
      gpg(env.GPG_AGENT_INFO),
      runtime(env, "gnupg/S.gpg-agent"),
      runtime(env, "gnupg/S.gpg-agent.ssh"),
      home(env, ".gnupg/S.gpg-agent"),
      home(env, ".gnupg/S.gpg-agent.ssh"),
    ],
  },
  {
    coverage: "dbus",
    scope: "ipc",
    environment: ["DBUS_SESSION_BUS_ADDRESS", "DBUS_SYSTEM_BUS_ADDRESS"],
    paths: (env) => [
      "/run/dbus/system_bus_socket",
      "/var/run/dbus/system_bus_socket",
      ...dbus(env.DBUS_SESSION_BUS_ADDRESS),
      ...dbus(env.DBUS_SYSTEM_BUS_ADDRESS),
    ],
  },
  {
    coverage: "wayland",
    scope: "ipc",
    environment: ["WAYLAND_DISPLAY"],
    paths: (env) => [wayland(env)],
  },
]

const endpoints = [...authority, ...ipc]

function runtime(env: Environment, suffix: string) {
  if (!env.XDG_RUNTIME_DIR) return undefined
  return path.join(env.XDG_RUNTIME_DIR, suffix)
}

function home(env: Environment, suffix: string) {
  if (!env.HOME) return undefined
  return path.join(env.HOME, suffix)
}

function decode(input: string) {
  try {
    return decodeURIComponent(input)
  } catch {
    return undefined
  }
}

function unix(input: string | undefined) {
  if (!input) return undefined
  const match = /^(?:unix|[a-z][a-z0-9+.-]*\+unix):\/\/(.*)$/i.exec(input)
  if (!match) return undefined
  const value = match[1]
  const pathname = value.startsWith("/") ? value : `/${value}`
  return decode(pathname)
}

function endpoint(input: string | undefined) {
  if (!input) return undefined
  if (path.isAbsolute(input)) return input
  return unix(input)
}

function dbus(input: string | undefined) {
  if (!input) return []
  return input.split(";").flatMap((address) => {
    if (!address.startsWith("unix:")) return []
    const field = address
      .slice(5)
      .split(",")
      .find((item) => item.startsWith("path="))
    if (!field) return []
    const value = decode(field.slice(5))
    return value && path.isAbsolute(value) ? [value] : []
  })
}

function gpg(input: string | undefined) {
  if (!input) return undefined
  return endpoint(input.split(":", 1)[0])
}

function wayland(env: Environment) {
  if (!env.WAYLAND_DISPLAY) return undefined
  if (path.isAbsolute(env.WAYLAND_DISPLAY)) return env.WAYLAND_DISPLAY
  return runtime(env, env.WAYLAND_DISPLAY)
}

function active(profile: Profile, endpoint: Endpoint) {
  return endpoint.scope === "authority" || profile.network.mode !== "allow" || profile.socket?.ipc === "deny"
}

export function socketProfile(profile: Profile, env: Environment = process.env): SocketPolicy {
  const selected = endpoints.filter((item) => active(profile, item))
  const paths = selected.flatMap((item) => item.paths(env)).filter((item): item is string => item !== undefined)
  return {
    paths: [...new Set(paths)].map((path): PathRule => ({ path, kind: "literal" })),
    deny: [...new Set(selected.flatMap((item) => item.environment))],
    coverage: [...new Set(selected.map((item) => item.coverage))],
  }
}

export function socketPolicy(
  profile: Profile,
  env: Environment = process.env,
): Effect.Effect<SocketPolicy, PlatformError.PlatformError> {
  const policy = socketProfile(profile, env)
  return Effect.map(Effect.forEach(policy.paths, (rule) => canonicalize(rule.path)), (paths) => ({
    ...policy,
    paths: [...new Set(paths)].map((path): PathRule => ({ path, kind: "literal" })),
  }))
}
