import path from "node:path"
import { Effect, PlatformError } from "effect"
import { canonicalize } from "./path"
import type { PathRule, Profile, SocketCoverage, SocketPolicy } from "./profile"

type Environment = Readonly<Record<string, string | undefined>>
type Scope = "authority" | "ipc"

interface Endpoint {
  readonly coverage: SocketCoverage
  readonly scope: Scope
  readonly deny: (environment: Environment) => ReadonlyArray<string>
  readonly paths: (environment: Environment) => ReadonlyArray<string | undefined>
}

const authority: ReadonlyArray<Endpoint> = [
  {
    coverage: "docker",
    scope: "authority",
    deny: (env) => advertised(env, "DOCKER_HOST", unix),
    paths: (env) => [
      "/var/run/docker.sock",
      "/run/docker.sock",
      ...runtimes(env, "docker.sock"),
      home(env, ".docker/run/docker.sock"),
      home(env, ".docker/desktop/docker.sock"),
      unix(env.DOCKER_HOST),
    ],
  },
  {
    coverage: "podman",
    scope: "authority",
    deny: (env) => [...advertised(env, "CONTAINER_HOST", endpoint), ...advertised(env, "PODMAN_HOST", endpoint)],
    paths: (env) => [
      "/var/run/podman/podman.sock",
      "/run/podman/podman.sock",
      ...runtimes(env, "podman/podman.sock"),
      home(env, ".local/share/containers/podman/machine/podman.sock"),
      endpoint(env.CONTAINER_HOST),
      endpoint(env.PODMAN_HOST),
    ],
  },
  {
    coverage: "containerd",
    scope: "authority",
    deny: (env) => advertised(env, "CONTAINERD_ADDRESS", endpoint),
    paths: (env) => [
      "/var/run/containerd/containerd.sock",
      "/run/containerd/containerd.sock",
      "/run/k3s/containerd/containerd.sock",
      ...runtimes(env, "containerd/containerd.sock"),
      ...runtimes(env, "containerd-rootless/api.sock"),
      endpoint(env.CONTAINERD_ADDRESS),
    ],
  },
  {
    coverage: "cri",
    scope: "authority",
    deny: (env) => [
      ...advertised(env, "CRI_ENDPOINT", endpoint),
      ...advertised(env, "CONTAINER_RUNTIME_ENDPOINT", endpoint),
      ...advertised(env, "IMAGE_SERVICE_ENDPOINT", endpoint),
    ],
    paths: (env) => [
      "/var/run/crio/crio.sock",
      "/run/crio/crio.sock",
      "/var/run/cri-dockerd.sock",
      "/run/cri-dockerd.sock",
      "/var/run/dockershim.sock",
      "/run/dockershim.sock",
      endpoint(env.CRI_ENDPOINT),
      endpoint(env.CONTAINER_RUNTIME_ENDPOINT),
      endpoint(env.IMAGE_SERVICE_ENDPOINT),
    ],
  },
]

const ipc: ReadonlyArray<Endpoint> = [
  {
    coverage: "ssh",
    scope: "ipc",
    deny: () => ["SSH_AUTH_SOCK", "SSH_AGENT_PID"],
    paths: (env) => [endpoint(env.SSH_AUTH_SOCK)],
  },
  {
    coverage: "gpg",
    scope: "ipc",
    deny: () => ["GPG_AGENT_INFO"],
    paths: (env) => [
      gpg(env.GPG_AGENT_INFO),
      ...runtimes(env, "gnupg/S.gpg-agent"),
      ...runtimes(env, "gnupg/S.gpg-agent.ssh"),
      gpgHome(env, "S.gpg-agent"),
      gpgHome(env, "S.gpg-agent.ssh"),
    ],
  },
  {
    coverage: "dbus",
    scope: "ipc",
    deny: () => ["DBUS_SESSION_BUS_ADDRESS", "DBUS_SYSTEM_BUS_ADDRESS"],
    paths: (env) => [
      "/run/dbus/system_bus_socket",
      "/var/run/dbus/system_bus_socket",
      ...runtimes(env, "bus"),
      ...dbus(env.DBUS_SESSION_BUS_ADDRESS),
      ...dbus(env.DBUS_SYSTEM_BUS_ADDRESS),
    ],
  },
  {
    coverage: "wayland",
    scope: "ipc",
    deny: () => ["WAYLAND_DISPLAY", "WAYLAND_SOCKET"],
    paths: (env) => wayland(env),
  },
]

const endpoints = [...authority, ...ipc]

function runtimes(env: Environment, suffix: string) {
  const roots = new Set<string>()
  if (env.XDG_RUNTIME_DIR && path.isAbsolute(env.XDG_RUNTIME_DIR)) roots.add(env.XDG_RUNTIME_DIR)
  if (typeof process.getuid === "function") roots.add(`/run/user/${process.getuid()}`)
  return [...roots].map((root) => path.join(root, suffix))
}

function home(env: Environment, suffix: string) {
  if (!env.HOME || !path.isAbsolute(env.HOME)) return undefined
  return path.join(env.HOME, suffix)
}

function gpgHome(env: Environment, suffix: string) {
  if (env.GNUPGHOME && path.isAbsolute(env.GNUPGHOME)) return path.join(env.GNUPGHOME, suffix)
  return home(env, path.join(".gnupg", suffix))
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
  const value = decode(match[1])
  return value && path.isAbsolute(value) ? value : undefined
}

function endpoint(input: string | undefined) {
  if (!input) return undefined
  if (path.isAbsolute(input)) return input
  return unix(input)
}

function advertised(env: Environment, name: string, parse: (input: string | undefined) => string | undefined) {
  return parse(env[name]) ? [name] : []
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
  if (!env.WAYLAND_DISPLAY) return []
  if (path.isAbsolute(env.WAYLAND_DISPLAY)) return [env.WAYLAND_DISPLAY]
  return runtimes(env, env.WAYLAND_DISPLAY)
}

function active(profile: Profile, endpoint: Endpoint) {
  return endpoint.scope === "authority" || profile.network.mode !== "allow" || profile.socket?.ipc === "deny"
}

export function mergeSockets(...policies: ReadonlyArray<SocketPolicy | undefined>): SocketPolicy {
  const selected = policies.filter((policy): policy is SocketPolicy => policy !== undefined)
  const paths = selected.flatMap((policy) => policy.paths)
  return {
    paths: [...new Map(paths.map((rule) => [rule.path, rule])).values()],
    deny: [...new Set(selected.flatMap((policy) => policy.deny))],
    coverage: [...new Set(selected.flatMap((policy) => policy.coverage))],
  }
}

export function socketProfile(profile: Profile, env: Environment = process.env): SocketPolicy {
  const selected = endpoints.filter((item) => active(profile, item))
  const paths = selected.flatMap((item) => item.paths(env)).filter((item): item is string => item !== undefined)
  return {
    paths: [...new Set(paths)].map((path): PathRule => ({ path, kind: "literal" })),
    deny: [...new Set(selected.flatMap((item) => item.deny(env)))],
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
