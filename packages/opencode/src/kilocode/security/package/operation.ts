import { CommandSemantics } from "../command"
import { ShellNormalizer } from "../shell"
import type { NormalizedCommand, NormalizedProcess } from "../types"

/**
 * Package operations recognised from an already-normalised shell command.
 *
 * This is not a second shell parser: it reads the executable / argv that {@link ShellNormalizer}
 * produced (wrappers unwrapped, `bash -c` payloads recursed) and describes *what the package manager
 * would do* — which packages, from where, whether install-time scripts would run, and how confident
 * the static reading is. The description is deliberately small; the risk evaluation lives in
 * `evaluator.ts` and the decision in the existing engine.
 *
 * npm / pnpm (plus yarn / bun / npx / bunx sharing the same vocabulary) are covered; other ecosystems
 * keep the deterministic engine's own handling (a soft ask for installs).
 */
export namespace PackageOperation {
  export type Ecosystem = "npm"
  export type Manager = "npm" | "pnpm" | "yarn" | "bun" | "npx" | "bunx"
  /**
   * - `install-explicit`: named packages are added (`npm install foo`, `pnpm add foo`);
   * - `install-manifest`: the manifest / lockfile drives the install (`npm install`, `npm ci`, `pnpm install`,
   *   `npm update`); every dependency's install-time scripts may run;
   * - `exec`: a package is fetched and executed immediately (`npx foo`, `npm exec foo`, `pnpm dlx foo`).
   */
  export type Kind = "install-explicit" | "install-manifest" | "exec"
  export type Source = "registry" | "alias" | "git" | "url" | "file" | "unknown"

  export interface Spec {
    /** The operand as written (dequoted). */
    raw: string
    /** `@scope/name` or `name`; undefined for non-registry sources or unparsable operands. */
    name?: string
    scope?: string
    /** Version, range, or dist-tag as requested; undefined means the default tag (`latest`). */
    version?: string
    source: Source
    /** For `alias@npm:real@range` the real registry package. */
    target?: string
  }

  export interface Operation {
    ecosystem: Ecosystem
    manager: Manager
    kind: Kind
    /** The manager subcommand as typed (`install`, `ci`, `add`, `dlx`, ...). */
    subcommand: string
    packages: Spec[]
    /** True when packages were named on the command line (vs. taken from the manifest). */
    explicit: boolean
    /** Registry override on the command line (`--registry`, `npm_config_registry=`), host only. */
    registry?: { host: string; origin: "flag" | "env" }
    /** Whether install-time lifecycle scripts would run (`--ignore-scripts` disables them). */
    lifecycle: "enabled" | "disabled"
    /** Global / system-wide install. */
    global: boolean
    /** `exact` when every operand was read statically; `ambiguous` lists why not. */
    confidence: "exact" | "ambiguous"
    ambiguity: string[]
    /** Static working directory (manifest location), when known. */
    cwd?: string
  }

  const MANAGERS = new Set<Manager>(["npm", "pnpm", "yarn", "bun", "npx", "bunx"])

  /** Options that consume the next token; a generic scan would otherwise read the value as a package. */
  const VALUED = new Set([
    "--registry",
    "--prefix",
    "-C",
    "--cwd",
    "--dir",
    "--filter",
    "-F",
    "-w",
    "--workspace",
    "--tag",
    "--scope",
    "--otp",
    "--cache",
    "--userconfig",
    "--globalconfig",
    "--loglevel",
    "--reporter",
    "--config",
    "--modules-dir",
    "--virtual-store-dir",
    "--store-dir",
    "--lockfile-dir",
    "--fetch-retries",
    "--fetch-timeout",
    "--script-shell",
    "--call",
    "-c",
    "--package",
    "-p",
    "--shell",
    "--backend",
    "--omit",
    "--include",
    "--install-strategy",
    "--legacy-peer-deps",
  ])
  /** Value-taking options that never take a value (listed above defensively but boolean in practice). */
  const BOOLEAN = new Set(["--legacy-peer-deps"])

  const NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i
  const DYNAMIC = /[$`*?{}]|\$\(/

  function dequote(value: string) {
    return CommandSemantics.dequote(value)
  }

  /** Read a `--flag value` / `--flag=value` pair from argv; undefined when absent or dynamic. */
  function option(argv: string[], names: string[]): string | undefined {
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]!
      if (arg === "--") return undefined
      for (const name of names) {
        if (arg === name) return argv[i + 1] === undefined ? undefined : dequote(argv[i + 1]!)
        if (arg.startsWith(name + "=")) return dequote(arg.slice(name.length + 1))
      }
    }
    return undefined
  }

  function has(argv: string[], names: string[]) {
    return argv.some((arg) => arg !== "--" && names.includes(arg))
  }

  function host(url: string): string | undefined {
    try {
      const parsed = new URL(url.includes("://") ? url : `https://${url}`)
      return parsed.host.toLowerCase()
    } catch {
      return undefined
    }
  }

  /** Parse one package operand the way npm's spec parser reads it, without touching the filesystem. */
  export function parseSpec(raw: string): Spec {
    const text = dequote(raw)
    if (DYNAMIC.test(text)) return { raw: text, source: "unknown" }
    if (/^(git\+|git:|github:|gitlab:|bitbucket:|gist:|ssh:)/i.test(text)) return { raw: text, source: "git" }
    if (/^https?:\/\//i.test(text)) return { raw: text, source: "url" }
    if (/^(file:|\.{1,2}[\\/]|[\\/]|~)/.test(text) || /\.(tgz|tar\.gz|tar)$/i.test(text))
      return { raw: text, source: "file" }
    // `user/repo` (optionally `#ref`) is GitHub shorthand; a scoped name starts with `@`.
    if (/^[\w.-]+\/[\w.-]+(#.*)?$/.test(text) && !text.startsWith("@")) return { raw: text, source: "git" }

    // `name@version`, `@scope/name@version`; the first `@` of a scoped name is part of the name.
    const at = text.startsWith("@") ? text.indexOf("@", 1) : text.indexOf("@")
    const name = at === -1 ? text : text.slice(0, at)
    const version = at === -1 ? undefined : text.slice(at + 1)
    if (!NAME.test(name)) return { raw: text, source: "unknown" }
    const scope = name.startsWith("@") ? name.slice(0, name.indexOf("/")) : undefined
    if (version !== undefined && /^npm:/i.test(version)) {
      const target = parseSpec(version.slice(4))
      return { raw: text, name, scope, version: target.version, source: "alias", target: target.name }
    }
    if (version !== undefined && /^(git\+|git:|github:|gitlab:|bitbucket:|https?:|file:)/i.test(version))
      return { raw: text, name, scope, source: /^file:/i.test(version) ? "file" : "git" }
    return { raw: text, name, scope, version: version === "" ? undefined : version, source: "registry" }
  }

  /** Operands after the subcommand, honouring value-taking options and `--`. */
  function operandsOf(argv: string[]) {
    const out: string[] = []
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]!
      if (arg === "--") {
        out.push(...argv.slice(i + 1))
        break
      }
      if (arg.startsWith("-") && arg.length > 1) {
        if (!arg.includes("=") && VALUED.has(arg) && !BOOLEAN.has(arg)) i++
        continue
      }
      out.push(arg)
    }
    return out
  }

  function registryOf(argv: string[], assignments: Record<string, string> | undefined) {
    const flag = option(argv, ["--registry"])
    if (flag !== undefined) {
      const found = host(flag)
      return found ? { host: found, origin: "flag" as const } : { host: "?", origin: "flag" as const }
    }
    for (const key of ["npm_config_registry", "NPM_CONFIG_REGISTRY", "YARN_REGISTRY", "YARN_NPM_REGISTRY_SERVER"]) {
      const value = assignments?.[key]
      if (value === undefined) continue
      const found = host(value)
      return { host: found ?? "?", origin: "env" as const }
    }
    return undefined
  }

  function lifecycleOf(argv: string[], assignments: Record<string, string> | undefined): Operation["lifecycle"] {
    if (has(argv, ["--ignore-scripts"]) || option(argv, ["--ignore-scripts"]) === "true") return "disabled"
    const env = assignments?.["npm_config_ignore_scripts"] ?? assignments?.["NPM_CONFIG_IGNORE_SCRIPTS"]
    if (env === "true" || env === "1") return "disabled"
    return "enabled"
  }

  /** Describe the package operation of one normalised process, if it is one. */
  export function from(process: NormalizedProcess): Operation | undefined {
    const manager = process.executable as Manager | undefined
    if (manager === undefined || !MANAGERS.has(manager) || !process.pkg) return undefined
    const pkg = process.pkg
    if (pkg.operation !== "install" && pkg.operation !== "fetch-exec") return undefined
    const argv = process.argv
    const ambiguity: string[] = []
    if (process.dynamic) ambiguity.push("dynamic operand")
    const assignments = process.assignments
    const registry = registryOf(argv, assignments)
    const lifecycle = lifecycleOf(argv, assignments)
    const base = {
      ecosystem: "npm" as const,
      manager,
      registry,
      lifecycle,
      global: pkg.system,
      cwd: process.cwd,
    }

    if (pkg.operation === "fetch-exec") {
      // `npx [opts] <pkg> [args]`, `npm exec [opts] [--] <pkg>`, `pnpm dlx <pkg>`, `bunx <pkg>`;
      // `-p/--package <pkg>` names the package explicitly and the first operand is then a bin name.
      const direct = manager === "npx" || manager === "bunx"
      const rest = direct ? argv : argv.slice(1)
      const subcommand = direct ? manager : (argv[0] ?? "")
      // `pnpm exec` / `yarn exec` / `bun run` run locally installed binaries; nothing is fetched.
      if (!direct && manager !== "npm" && subcommand === "exec") return undefined
      const explicit = option(rest, ["--package", "-p"])
      const operands = operandsOf(rest)
      const first = explicit ?? operands[0]
      if (first === undefined) {
        ambiguity.push("no package operand")
        return {
          ...base,
          kind: "exec",
          subcommand,
          packages: [],
          explicit: true,
          confidence: "ambiguous",
          ambiguity,
        }
      }
      const spec = parseSpec(first)
      if (spec.source === "unknown") ambiguity.push("unparsable package operand")
      return {
        ...base,
        kind: "exec",
        subcommand,
        packages: [spec],
        explicit: true,
        confidence: ambiguity.length === 0 ? "exact" : "ambiguous",
        ambiguity,
      }
    }

    const subcommand = argv.find((arg) => !arg.startsWith("-")) ?? ""
    const index = argv.indexOf(subcommand)
    const rest = index === -1 ? argv : argv.slice(index + 1)
    const specs = operandsOf(rest).map(parseSpec)
    for (const spec of specs) if (spec.source === "unknown") ambiguity.push("unparsable package operand")
    if (specs.length === 0) {
      return {
        ...base,
        kind: "install-manifest",
        subcommand,
        packages: [],
        explicit: false,
        confidence: ambiguity.length === 0 ? "exact" : "ambiguous",
        ambiguity,
      }
    }
    return {
      ...base,
      kind: "install-explicit",
      subcommand,
      packages: specs,
      explicit: true,
      confidence: ambiguity.length === 0 ? "exact" : "ambiguous",
      ambiguity,
    }
  }

  /** Every package operation in a command line, nested `bash -c` payloads included. */
  export function collect(command: NormalizedCommand): Operation[] {
    const out: Operation[] = []
    for (const process of ShellNormalizer.flatten(command)) {
      const found = from(process)
      if (found) out.push(found)
    }
    return out
  }
}
