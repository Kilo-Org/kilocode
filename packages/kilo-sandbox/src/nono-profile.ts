import os from "node:os"
import path from "node:path"
import { parseDestination } from "./destination"
import { aliases, type Credential } from "./nono-credentials"
import { matches } from "./path"
import type { PathRule, Profile } from "./profile"

interface CustomCredential {
  readonly upstream: string
  readonly credential_key: string
  readonly env_var: string
  readonly inject_header?: string
  readonly credential_format?: string
  readonly phantom_format?: string
}

interface NonoNetwork {
  readonly block?: boolean
  readonly allow_domain?: ReadonlyArray<string>
  readonly credentials?: ReadonlyArray<string>
  readonly custom_credentials?: Readonly<Record<string, CustomCredential>>
}

type Access = "none" | "read" | "readwrite"

interface NonoFilesystem {
  readonly allow: ReadonlyArray<string>
  readonly allow_file: ReadonlyArray<string>
  readonly read: ReadonlyArray<string>
  readonly read_file: ReadonlyArray<string>
  readonly deny: ReadonlyArray<string>
}

export interface NonoProfile {
  readonly extends: "default"
  readonly meta: { readonly name: string; readonly description: string }
  readonly groups?: { readonly exclude: ReadonlyArray<string> }
  readonly workdir: { readonly access: Access }
  readonly filesystem: NonoFilesystem
  readonly environment?: {
    readonly deny_vars: ReadonlyArray<string>
    readonly set_vars: Readonly<Record<string, string>>
  }
  readonly network: NonoNetwork
}

export interface Inputs {
  readonly credentials?: ReadonlyArray<Credential>
  readonly reads?: ReadonlyArray<PathRule>
  readonly denies?: ReadonlyArray<string>
  readonly exclude?: ReadonlyArray<string>
  readonly restore?: Readonly<Record<string, string>>
  readonly secret?: ReadonlyArray<string>
  readonly paths?: { readonly data?: string; readonly config?: string }
  readonly cwd?: string
}

const loader = ["NODE_OPTIONS", "PYTHONPATH", "PYTHONHOME", "GOFLAGS", "LD_LIBRARY_PATH"]

/** nono's own XDG roots must not reach the child; the profile restores the user's values when they existed. */
const xdg = ["XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME"]

/** Variables nono strips or redirects that the child gets back from the original environment. */
export function restoreEnvironment(env: Readonly<Record<string, string | undefined>>) {
  return Object.fromEntries(
    [...loader, ...xdg].flatMap((key) => {
      const value = env[key]
      return value === undefined ? [] : [[key, value] as [string, string]]
    }),
  )
}

/**
 * nono grants write access to every temporary directory by default. Kilo grants only its own temp directory, so
 * the broader write groups are excluded and the Kilo temp directory is added back as a grant.
 */
const broaderWriteGroups = ["system_write_macos", "system_write_linux"]

/** Commands expect these even with writes otherwise restricted; Kilo's Seatbelt policy grants them too. */
const deviceFiles = ["/dev/null", "/dev/zero", "/dev/random", "/dev/urandom", "/dev/tty"]

const credentialPaths = [
  "$HOME/.ssh",
  "$HOME/.gnupg",
  "$HOME/.aws",
  "$HOME/.kube",
  "$HOME/.docker",
  "$HOME/.npmrc",
  "$HOME/.netrc",
  "$HOME/.git-credentials",
  "$HOME/.config/gcloud",
  "$HOME/.config/gh",
  "$HOME/.zshrc",
  "$HOME/.zshenv",
  "$HOME/.zprofile",
  "$HOME/.bashrc",
  "$HOME/.bash_profile",
  "$HOME/.profile",
]

function directories() {
  // Mirrors Global.Path: the data root uses the real home and XDG_DATA_HOME; only config honours its override.
  const home = os.homedir()
  const app = process.env.OPENCODE_APP_DIR_NAME || "opencode"
  return {
    data: path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), app),
    config:
      process.env.OPENCODE_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), app),
  }
}

function covered(rule: PathRule, denies: ReadonlyArray<PathRule>) {
  return denies.some((deny) => {
    if (rule.path === deny.path) return true
    if (deny.kind === "literal") return false
    return rule.path.startsWith(deny.path + path.sep)
  })
}

function allow(list: ReadonlyArray<PathRule>) {
  return list.filter((rule) => rule.kind === "subtree").map((rule) => rule.path)
}

function files(list: ReadonlyArray<PathRule>) {
  return list.filter((rule) => rule.kind === "literal").map((rule) => rule.path)
}

function access(profile: Profile, reads: ReadonlyArray<PathRule>, cwd: string | undefined): Access {
  if (!cwd) return "none"
  if (profile.filesystem.denyWrite.some((rule) => matches(rule, cwd))) return "none"
  const writes = profile.filesystem.allowWrite.filter((rule) => !covered(rule, profile.filesystem.denyWrite))
  if (writes.some((rule) => matches(rule, cwd))) return "readwrite"
  if (reads.some((rule) => matches(rule, cwd))) return "read"
  return "none"
}

let portsWarned = false

/**
 * nono's allowlist matches hosts, not ports, and Kilo's proxy authorizes the exact host:port, so every entry is
 * widened to all ports on its host. That includes the usual :443 entry, so warn for any configured host, once.
 */
function warnPorts(hosts: ReadonlyArray<string>) {
  if (portsWarned || hosts.length === 0) return
  portsWarned = true
  process.stderr.write(
    `kilo-sandbox: nono matches hosts, not ports, so ${hosts.join(", ")} permit every port on those hosts\n`,
  )
}

function network(profile: Profile, routes: ReadonlyArray<Credential>): NonoNetwork {
  if (profile.network.mode === "allow") return { block: false }
  if (profile.network.mode === "deny") return { block: true }
  if (profile.network.allowedHosts.length === 0) return { block: true }
  warnPorts(profile.network.allowedHosts)
  const domains = [...new Set(profile.network.allowedHosts.map((host) => parseDestination(host).host))].sort()
  if (routes.length === 0) return { allow_domain: domains }
  return {
    allow_domain: domains,
    credentials: routes.map((route) => route.name),
    custom_credentials: Object.fromEntries(
      routes.map((route) => [
        route.name,
        {
          upstream: route.upstream,
          credential_key: route.source,
          env_var: route.envVar,
          ...(route.header === undefined ? {} : { inject_header: route.header }),
          ...(route.format === undefined ? {} : { credential_format: route.format }),
          ...(route.phantom === undefined ? {} : { phantom_format: route.phantom }),
        } satisfies CustomCredential,
      ]),
    ),
  }
}

export function generate(profile: Profile, inputs: Inputs = {}): NonoProfile {
  const given = inputs.paths ?? directories()
  // A relative XDG root would otherwise put a relative path in the deny list, where it resolves against the
  // command's working directory instead of the path Kilo actually wrote.
  const paths = {
    ...(given.data === undefined ? {} : { data: path.resolve(given.data) }),
    ...(given.config === undefined ? {} : { config: path.resolve(given.config) }),
  }
  const allowWrite = profile.filesystem.allowWrite.filter((rule) => !covered(rule, profile.filesystem.denyWrite))
  // denyNames is deliberately not translated: a nono deny also blocks reads, and commands must still read
  // .git for git status and git log. The gate decision record tracks the upstream primitive that closes it.
  const reads = inputs.reads ?? allowWrite
  const temporary = profile.filesystem.temporaryDirectory
  const stores =
    paths.data === undefined
      ? []
      : [
          ...["kilo2.db", "kilo2.db-wal", "kilo2.db-shm"].map((name) => path.join(paths.data!, name)),
          ...["auth.json", "opencode.db", "opencode.db-wal", "opencode.db-shm"].map((name) =>
            path.join(paths.data!, name),
          ),
        ]
  const denied = [
    ...credentialPaths,
    ...profile.filesystem.denyWrite.map((rule) => rule.path),
    ...(paths.config === undefined ? [] : [paths.config]),
    ...(paths.data === undefined
      ? []
      : [path.join(paths.data, "kilo2*.db*"), path.join(paths.data, "opencode*.db*"), ...stores]),
    ...(inputs.denies ?? []),
  ]
  const provided = inputs.credentials ?? []
  const active = new Set(provided.map((route) => route.envVar))
  const deniedEnvironment = [
    ...new Set([
      ...profile.environment.deny,
      ...xdg,
      ...provided.flatMap((route) => aliases(route.envVar).filter((alias) => !active.has(alias))),
      ...(inputs.secret ?? []),
    ]),
  ]
  const set = { ...(inputs.restore ?? {}), ...profile.environment.set }
  return {
    extends: "default",
    meta: { name: "kilo", description: "Kilo sandbox profile" },
    groups: { exclude: [...broaderWriteGroups, ...(inputs.exclude ?? [])] },
    workdir: { access: access(profile, reads, inputs.cwd) },
    filesystem: {
      allow: [...new Set(allow(allowWrite))],
      allow_file: [...new Set([...files(allowWrite), ...deviceFiles])],
      read: [...new Set([...allow(reads), ...(temporary === undefined ? [] : [temporary])])],
      read_file: [...new Set(files(reads))],
      deny: [...new Set(denied)],
    },
    environment: { deny_vars: deniedEnvironment, set_vars: set },
    network: network(profile, inputs.credentials ?? []),
  }
}
