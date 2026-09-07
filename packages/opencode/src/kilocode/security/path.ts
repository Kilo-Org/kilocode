import os from "os"
import path from "path"
import { existsSync, lstatSync, realpathSync } from "fs"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ConfigProtection } from "@/kilocode/permission/config-paths"
import { KilocodePaths } from "@/kilocode/paths"
import { SandboxStore } from "@/kilocode/sandbox/store"
import { SandboxPreference } from "@/kilocode/sandbox/preference"
import type { NormalizedPath, PathLabel, PathRelation } from "./types"

/**
 * Context-aware path classification.
 *
 * A decision never depends on the textual path alone: the input is expanded, resolved against the
 * effective cwd, canonicalised through the nearest existing ancestor (so symlinks and `..` cannot
 * disguise a target) and then related to the workspace, home, temp, system and Kilo state roots.
 * Both the lexical and the canonical location are classified and the riskier one wins.
 */
export namespace PathRisk {
  export interface Env {
    home: string
    workspace: { directory: string; worktree: string }
    /** Temp roots; paths strictly inside are low risk, the roots themselves are not. */
    temp: string[]
    /** Kilo config / permission / sandbox state roots the agent must never modify. */
    kilo: string[]
    /** Subtrees under `kilo` roots that hold ordinary session data (plans, clones, logs). */
    kiloWritable: string[]
    /** System roots (POSIX); Windows uses the drive-relative table instead. */
    system: string[]
  }

  const rank: Record<PathRelation, number> = {
    workspace: 0,
    temp: 1,
    external: 2,
    unknown: 3,
    home: 4,
    "workspace-root": 5,
    "workspace-config": 6,
    system: 7,
    "home-sensitive": 8,
    "home-root": 9,
    "kilo-security": 10,
    root: 11,
  }

  const SYSTEM = [
    "/etc",
    "/usr",
    "/bin",
    "/sbin",
    "/lib",
    "/lib32",
    "/lib64",
    "/libx32",
    "/boot",
    "/dev",
    "/proc",
    "/sys",
    "/var",
    "/opt",
    "/root",
    "/srv",
    "/run",
    "/snap",
    "/nix",
    "/home",
    "/Users",
    "/System",
    "/Library",
    "/Applications",
    "/Volumes",
    "/Network",
    "/cores",
    "/private",
  ]

  const SYSTEM_WINDOWS = ["windows", "program files", "program files (x86)", "programdata", "system volume information"]

  const DEVICE_SAFE = new Set([
    "/dev/null",
    "/dev/zero",
    "/dev/random",
    "/dev/urandom",
    "/dev/stdin",
    "/dev/stdout",
    "/dev/stderr",
    "/dev/tty",
    "/dev/fd",
    "/dev/ptmx",
    "/dev/console",
  ])

  /** Home-relative directories that hold credential material; files inside are at least `credential`. */
  const CREDENTIAL_DIRS = [
    ".ssh",
    ".aws",
    ".gnupg",
    ".gnupg2",
    ".kube",
    ".docker",
    ".azure",
    ".password-store",
    ".config/gcloud",
    ".config/gh",
    ".config/hub",
    ".config/op",
    ".1password",
    ".terraform.d",
    "Library/Keychains",
    ".local/share/keyrings",
  ]

  /** Home-relative files and subtrees that contain secrets outright (`private-key`): never readable. */
  const SECRET_PATHS = [
    ".aws/credentials",
    ".netrc",
    "_netrc",
    ".npmrc",
    ".yarnrc",
    ".yarnrc.yml",
    ".pypirc",
    ".git-credentials",
    ".boto",
    ".s3cfg",
    ".wgetrc",
    ".curlrc",
    ".vault-token",
    ".config/git/credentials",
    ".docker/config.json",
    ".kube/config",
    ".config/gcloud/credentials.db",
    ".config/gcloud/access_tokens.db",
    ".config/gcloud/legacy_credentials",
    ".config/gcloud/application_default_credentials.json",
    ".azure/accessTokens.json",
    ".azure/msal_token_cache.json",
    ".azure/msal_http_cache.bin",
    ".config/gh/hosts.yml",
    ".config/op",
    ".1password",
    ".password-store",
    ".gnupg/private-keys-v1.d",
    ".gnupg/secring.gpg",
    ".terraform.d/credentials.tfrc.json",
    "Library/Keychains",
    ".local/share/keyrings",
  ]

  /** Files inside credential directories that only hold metadata (readable with approval, never writable). */
  const CREDENTIAL_METADATA = [
    ".ssh/config",
    ".ssh/known_hosts",
    ".ssh/known_hosts.old",
    ".ssh/environment",
    ".ssh/rc",
    ".aws/config",
    ".gnupg/gpg.conf",
    ".gnupg/gpg-agent.conf",
    ".gnupg/pubring.kbx",
    ".gnupg/trustdb.gpg",
    ".config/gh/config.yml",
  ]

  const SHELL_PERSISTENCE = [
    ".bashrc",
    ".bash_profile",
    ".bash_login",
    ".bash_logout",
    ".profile",
    ".zshrc",
    ".zprofile",
    ".zshenv",
    ".zlogin",
    ".zlogout",
    ".cshrc",
    ".tcshrc",
    ".kshrc",
    ".config/fish/config.fish",
    ".config/fish/conf.d",
    ".config/powershell",
    ".config/systemd/user",
    ".config/autostart",
    "Library/LaunchAgents",
    ".xinitrc",
    ".xprofile",
    ".xsession",
    "Documents/PowerShell",
    "Documents/WindowsPowerShell",
    ".config/fish/functions",
    ".vimrc",
    ".vim/vimrc",
    ".config/nvim",
    ".gvimrc",
    ".exrc",
    ".emacs",
    ".emacs.d/init.el",
    ".config/emacs/init.el",
    ".gdbinit",
    ".lldbinit",
    ".inputrc",
    ".tmux.conf",
    ".screenrc",
    ".config/tmux",
    ".ideavimrc",
    ".config/systemd",
    ".config/environment.d",
    ".pam_environment",
    ".ssh/rc",
    ".bashrc.d",
    ".zshrc.d",
    ".oh-my-zsh/custom",
  ]

  const GIT_IDENTITY = [".gitconfig", ".config/git/config", ".config/git/attributes", ".gitignore_global"]

  const SYSTEM_PERSISTENCE = [
    "/etc/cron.d",
    "/etc/cron.daily",
    "/etc/cron.hourly",
    "/etc/cron.weekly",
    "/etc/cron.monthly",
    "/etc/crontab",
    "/etc/profile",
    "/etc/profile.d",
    "/etc/bash.bashrc",
    "/etc/bashrc",
    "/etc/zshrc",
    "/etc/zshenv",
    "/etc/zprofile",
    "/etc/rc.local",
    "/etc/init.d",
    "/etc/systemd",
    "/etc/ld.so.preload",
    "/Library/LaunchDaemons",
    "/Library/LaunchAgents",
    "/Library/StartupItems",
    "/var/spool/cron",
    "/private/etc/profile",
    "/private/etc/zshrc",
    "/private/etc/bashrc",
  ]

  const PRIVATE_KEY_NAMES =
    /^(id_(rsa|dsa|ecdsa|ecdsa_sk|ed25519|ed25519_sk)|.+\.(pem|key|p12|pfx|jks|keystore|ppk|asc|gpg|kdbx))$/i
  const PUBLIC_KEY_NAMES = /\.pub$/i
  const SECRET_NAMES = /^\.env(\..+)?$/
  const SECRET_EXAMPLES = /^\.env\.(example|sample|template|dist|defaults?)$/i
  const DYNAMIC = /[$`]/

  function normalize(value: string) {
    return process.platform === "win32" ? FSUtil.normalizePath(value) : value
  }

  function same(a: string, b: string) {
    return path.resolve(normalize(a)) === path.resolve(normalize(b))
  }

  function within(child: string, parent: string) {
    return !same(child, parent) && FSUtil.contains(normalize(parent), normalize(child))
  }

  function inside(child: string, parent: string) {
    return same(child, parent) || within(child, parent)
  }

  function expand(input: string, home: string) {
    if (input === "~") return home
    if (input.startsWith("~/") || input.startsWith("~\\")) return path.join(home, input.slice(2))
    if (input === "$HOME" || input === "${HOME}") return home
    const match = input.match(/^\$(?:HOME|\{HOME\})([\\/].*)$/)
    if (match) return path.join(home, match[1])
    return input
  }

  /** Realpath of the nearest existing ancestor joined with the remaining segments. */
  export function physical(target: string): { canonical: string; exists: boolean } {
    const parts: string[] = []
    let current = path.resolve(target)
    const exists = existsSync(current)
    try {
      while (!existsSync(current)) {
        const parent = path.dirname(current)
        if (parent === current) return { canonical: path.resolve(target), exists }
        parts.unshift(path.basename(current))
        current = parent
      }
      return { canonical: path.join(realpathSync.native(current), ...parts), exists }
    } catch {
      return { canonical: path.resolve(target), exists }
    }
  }

  function isRoot(value: string) {
    const parsed = path.parse(value)
    return parsed.root === value || value === "/"
  }

  function under(rel: string, list: string[]) {
    return list.some((item) => rel === item || rel.startsWith(item + "/"))
  }

  const CONFIG_DIRS = new Set([".kilo", ".kilocode", ".claude", ".opencode"])
  const CONFIG_FILES = new Set(["kilo.json", "kilo.jsonc", "opencode.json", "opencode.jsonc", "agents.md", "claude.md"])
  const CONFIG_EXEMPT = new Set(["plans"])

  /**
   * Project configuration Kilo (or the tooling it reads) loads from any directory between the session
   * directory and the worktree root. Matched case-insensitively because macOS and Windows filesystems
   * are, so `.KILO/agents/x.md` lands in `.kilo/`.
   *
   * Exported so a caller that must decide whether a bare, separator-less token names project
   * configuration (`kilo.json`) asks this classifier instead of keeping a second copy of the list.
   */
  export function projectConfig(rel: string) {
    const parts = rel.split("/").filter((part) => part.length > 0)
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!.toLowerCase()
      if (!CONFIG_DIRS.has(part)) continue
      const next = parts[i + 1]?.toLowerCase()
      if (next !== undefined && CONFIG_EXEMPT.has(next)) return false
      return true
    }
    const base = parts.at(-1)?.toLowerCase() ?? ""
    return CONFIG_FILES.has(base)
  }

  function homeLabels(rel: string): PathLabel[] {
    const out: PathLabel[] = []
    const base = path.posix.basename(rel)
    if (under(rel, SECRET_PATHS)) out.push("credential", "private-key")
    else if (under(rel, CREDENTIAL_DIRS)) {
      const metadata = under(rel, CREDENTIAL_METADATA) || (rel.startsWith(".ssh/") && PUBLIC_KEY_NAMES.test(base))
      const dir = CREDENTIAL_DIRS.includes(rel)
      if (metadata) out.push("credential")
      else if (dir) out.push("credential", "private-key")
      else if (rel.startsWith(".ssh/") || rel.startsWith(".gnupg")) out.push("credential", "private-key")
      else out.push("credential")
    }
    if (under(rel, SHELL_PERSISTENCE)) out.push("shell-persistence")
    if (GIT_IDENTITY.includes(rel)) out.push("git-identity")
    return out
  }

  function nameLabels(base: string): PathLabel[] {
    const out: PathLabel[] = []
    if (PRIVATE_KEY_NAMES.test(base) && !PUBLIC_KEY_NAMES.test(base)) out.push("private-key")
    if (SECRET_NAMES.test(base) && !SECRET_EXAMPLES.test(base)) out.push("secret")
    return out
  }

  function systemLabels(value: string): PathLabel[] {
    const out: PathLabel[] = []
    const harmlessDevice = DEVICE_SAFE.has(value) || value.startsWith("/dev/fd/") || /^\/dev\/(tty|pts)/.test(value)
    if (value.startsWith("/dev/") && !harmlessDevice) out.push("device")
    if (harmlessDevice) out.push("device-safe")
    if (SYSTEM_PERSISTENCE.some((item) => value === item || value.startsWith(item + "/"))) out.push("shell-persistence")
    return out
  }

  function isSystem(value: string, env: Env) {
    if (process.platform === "win32") {
      const rel = path.relative(path.parse(value).root, value).toLowerCase()
      const head = rel.split(/[\\/]/)[0] ?? ""
      return SYSTEM_WINDOWS.includes(head)
    }
    return env.system.some((dir) => value === dir || value.startsWith(dir + "/"))
  }

  function isTemp(value: string, env: Env) {
    return env.temp.some((root) => within(value, root))
  }

  function isTempRoot(value: string, env: Env) {
    return env.temp.some((root) => same(value, root))
  }

  function kiloLabels(value: string, env: Env): PathLabel[] {
    if (env.kiloWritable.some((root) => inside(value, root))) return []
    if (env.kilo.some((root) => inside(value, root))) return ["kilo-state", "kilo-config"]
    if (ConfigProtection.isAbsolute(value)) return ["kilo-config"]
    return []
  }

  function relate(value: string, env: Env): { relation: PathRelation; labels: PathLabel[] } {
    const labels = new Set<PathLabel>(nameLabels(path.basename(value)))
    if (isRoot(value)) return { relation: "root", labels: [...labels] }

    for (const label of kiloLabels(value, env)) labels.add(label)
    if (labels.has("kilo-config") || labels.has("kilo-state")) return { relation: "kilo-security", labels: [...labels] }

    // Credential stores and startup files keep their protection even when the workspace contains them
    // (a user may open their home directory as a project).
    if (within(value, env.home)) {
      const found = homeLabels(path.relative(env.home, value).replaceAll("\\", "/"))
      if (found.length > 0) return { relation: "home-sensitive", labels: [...new Set([...labels, ...found])] }
    }

    const ws = env.workspace
    const insideWorkspace = inside(value, ws.directory) || (ws.worktree !== "/" && inside(value, ws.worktree))
    if (insideWorkspace) {
      if (same(value, ws.directory) || same(value, ws.worktree))
        return { relation: "workspace-root", labels: [...labels] }
      const rel = path.relative(inside(value, ws.directory) ? ws.directory : ws.worktree, value).replaceAll("\\", "/")
      if (rel === ".git" || rel.startsWith(".git/")) labels.add("git-dir")
      if (ConfigProtection.isRelative(rel) || projectConfig(rel)) {
        labels.add("kilo-config")
        return { relation: "workspace-config", labels: [...labels] }
      }
      return { relation: "workspace", labels: [...labels] }
    }

    // Deleting an ancestor of the workspace destroys the workspace and everything next to it.
    if (within(ws.directory, value) || (ws.worktree !== "/" && within(ws.worktree, value)))
      labels.add("workspace-ancestor")

    if (same(value, env.home)) return { relation: "home-root", labels: [...labels] }
    if (within(value, env.home)) {
      const rel = path.relative(env.home, value).replaceAll("\\", "/")
      const found = homeLabels(rel)
      for (const label of found) labels.add(label)
      if (found.length > 0) return { relation: "home-sensitive", labels: [...labels] }
      // Windows keeps %TEMP% under the profile; only temp roots that live inside home count here.
      if (env.temp.some((root) => within(root, env.home) && within(value, root)))
        return { relation: "temp", labels: [...labels] }
      return { relation: "home", labels: [...labels] }
    }

    if (isTemp(value, env)) return { relation: "temp", labels: [...labels] }
    if (isTempRoot(value, env)) return { relation: "external", labels: [...labels] }

    for (const label of systemLabels(value)) labels.add(label)
    if (isSystem(value, env)) return { relation: "system", labels: [...labels] }
    return { relation: "external", labels: [...labels] }
  }

  export function unknown(input: string): NormalizedPath {
    return { input, absolute: input, canonical: input, relation: "unknown", labels: [], symlink: false, exists: false }
  }

  /**
   * Classify a path operand. `cwd` is the static working directory in effect; when it is unknown
   * (a dynamic `cd` happened earlier) relative operands stay `unknown` and the caller must not treat
   * them as safe.
   */
  /** True when the last segment of `target` is itself a symlink (so `rm target` removes only the link). */
  function link(target: string) {
    try {
      return lstatSync(target).isSymbolicLink()
    } catch {
      return false
    }
  }

  export function classify(
    input: string,
    cwd: string | undefined,
    env: Env,
    opts?: { follow?: boolean },
  ): NormalizedPath {
    const expanded = expand(input.trim(), env.home)
    if (!expanded || DYNAMIC.test(expanded)) return unknown(input)
    const absolute = path.isAbsolute(expanded)
      ? path.normalize(expanded)
      : cwd
        ? path.resolve(cwd, expanded)
        : undefined
    if (!absolute) return unknown(input)
    // Removing a symlink entry never touches its target; classify the link where it lives.
    const physicalPath =
      opts?.follow === false && !expanded.endsWith("/") && link(absolute)
        ? { canonical: path.join(physical(path.dirname(absolute)).canonical, path.basename(absolute)), exists: true }
        : physical(absolute)
    const lexical = relate(absolute, env)
    const canonical = relate(physicalPath.canonical, env)
    const stricter = rank[canonical.relation] >= rank[lexical.relation] ? canonical : lexical
    return {
      input,
      absolute,
      canonical: physicalPath.canonical,
      relation: stricter.relation,
      labels: [...new Set([...lexical.labels, ...canonical.labels])],
      symlink: physicalPath.canonical !== absolute,
      exists: physicalPath.exists,
    }
  }

  /** Build the classification environment for a session. */
  export function env(input: {
    workspace: { directory: string; worktree: string }
    home?: string
    temp?: string[]
    system?: string[]
  }): Env {
    const home = input.home ?? Global.Path.home
    const temp =
      input.temp ??
      [
        os.tmpdir(),
        "/tmp",
        "/private/tmp",
        "/var/tmp",
        "/private/var/tmp",
        "/var/folders",
        "/private/var/folders",
        Global.Path.tmp,
        process.env.TEMP,
        process.env.TMP,
      ].filter((value): value is string => typeof value === "string" && value.length > 0)
    const kilo = [
      Global.Path.config,
      Global.Path.state,
      Global.Path.data,
      SandboxStore.root,
      SandboxPreference.root,
      ...KilocodePaths.globalDirs(),
      process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, "kilo") : "",
      path.join(home, ".config", "kilo"),
      path.join(home, ".kilo"),
      path.join(home, ".kilocode"),
    ].filter((value) => value.length > 0)
    const kiloWritable = [
      path.join(Global.Path.data, "plans"),
      Global.Path.repos,
      Global.Path.log,
      Global.Path.tmp,
      path.join(Global.Path.data, "tmp"),
    ]
    return { home, workspace: input.workspace, temp, kilo, kiloWritable, system: input.system ?? SYSTEM }
  }

  export function sensitive(target: NormalizedPath) {
    return (
      target.labels.includes("private-key") ||
      target.labels.includes("credential") ||
      target.labels.includes("secret") ||
      target.relation === "home-sensitive" ||
      target.relation === "kilo-security"
    )
  }

  /** Key material and credential files: reads are denied outright, never merely asked. */
  export function secret(target: NormalizedPath) {
    return target.labels.includes("private-key")
  }

  export function order(relation: PathRelation) {
    return rank[relation]
  }
}
