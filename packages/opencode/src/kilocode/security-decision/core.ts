import type { SecurityDecisionTypes } from "./types"
import { SecurityDecisionRules as R } from "./rules"

/**
 * The pure decision core. No IO, no clock, no randomness, no Effect, no Kilo imports.
 *
 * It returns a *recommendation*; `Permission.ask` stays the enforcement point. `deny` is reserved
 * for a fully recognized, exact signal on the untrusted soft path — every ambiguity degrades to
 * `ask`, and `pass` means the layer has no opinion at all.
 */
export namespace SecurityDecision {
  /** Operations that unambiguously write to their target. */
  const WRITES = new Set(["add", "create", "update", "write", "move", "delete"])
  /** Operations that unambiguously destroy or relocate their target. */
  const DESTRUCTIVE = new Set(["delete", "move"])

  /**
   * Executables that can neither mutate state nor reveal file contents, whatever their arguments.
   * Deliberately tiny: this is an allowlist of proven-inert commands, not a catalog of safe tools.
   * Anything not here is unclassified, which is an ask, not a refusal.
   */
  const INERT = new Set([
    "basename",
    "date",
    "df",
    "dirname",
    "echo",
    "false",
    "hostname",
    "ls",
    "printf",
    "pwd",
    "sleep",
    "tree",
    "true",
    "uname",
    "which",
    "whoami",
  ])

  /**
   * Toolchain binaries asked for nothing but their own version. The allowlist is over the executable
   * *and* the exact single argument: `--version` is not a property of a command line, it is only
   * inert when it is the whole of it. `node --version` prints a string; `node --version x` runs a
   * script named `x`.
   */
  const VERSION_TOOLS = new Set([
    "bun",
    "cargo",
    "clang",
    "cmake",
    "deno",
    "docker",
    "dotnet",
    "gcc",
    "go",
    "java",
    "javac",
    "kubectl",
    "make",
    "node",
    "npm",
    "php",
    "pnpm",
    "python",
    "python3",
    "ruby",
    "rustc",
    "swift",
    "terraform",
    "tsc",
    "yarn",
  ])

  const VERSION_FLAGS = new Set(["--version", "-V"])

  /**
   * Tools whose bare `version` word is a subcommand that only prints.
   *
   * A bare `version` is not a flag, and what it means belongs to the tool rather than to the word:
   * `npm version` rewrites `package.json` and creates a tag and a commit, `make version` runs a
   * target out of the Makefile, and for a tool that does not dispatch on its first word — `python`,
   * `node`, `java` — it is an operand naming a file to execute. So it is admitted per tool, like
   * every other verb allowlist here, instead of being treated as a property of the spelling.
   */
  const VERSION_SUBCOMMAND = new Set(["cargo", "docker", "go", "kubectl", "terraform"])

  function versionOnly(unit: SecurityDecisionTypes.ExecCommandFact) {
    const name = unit.executable
    if (!name || !VERSION_TOOLS.has(name)) return false
    const argv = unit.argv
    if (argv === undefined || argv.length !== 2) return false
    return VERSION_FLAGS.has(argv[1]!) || (argv[1] === "version" && VERSION_SUBCOMMAND.has(name))
  }

  /**
   * git is allowlisted by verb *and* arguments, never by verb alone.
   *
   * A read-only sounding verb is not evidence of anything: `show`, `diff`, `log` and `blame` all
   * print file contents, so `git show HEAD:.env` would read a secret that a direct `read` asks for.
   * Git also reprograms itself from its arguments — `--git-dir` and `--work-tree` move the operation
   * to another repository, `-C` moves the working directory, and `-c` sets configuration that can
   * name a program to run (pager, external diff, textconv filter). So only verbs that emit names and
   * metadata are listed, every global flag but two is refused, and any argument the verb does not
   * explicitly allow fails closed.
   */
  const GIT_GLOBALS = new Set(["--no-pager", "--no-optional-locks"])

  type GitVerb = Readonly<{
    flags: ReadonlySet<string>
    short: ReadonlySet<string>
    /** At least one of these must be present. For verbs whose *default* output is a patch. */
    require?: ReadonlySet<string>
    /** Whether `-<count>` shorthand is part of the verb's own syntax. */
    numeric?: boolean
  }>

  /** Flags that report names and counts instead of the patch itself. */
  const NAME_ONLY = new Set(["--name-only", "--name-status", "--numstat", "--shortstat", "--stat"])

  const GIT_VERBS: Record<string, GitVerb> = {
    /** Names, branch and working-tree state. No file contents. */
    status: {
      flags: new Set([
        "--",
        "--branch",
        "--ignore-submodules",
        "--long",
        "--no-renames",
        "--porcelain",
        "--short",
        "--untracked-files",
        "-b",
        "-s",
        "-u",
        "-uall",
        "-uno",
        "-unormal",
        "-z",
      ]),
      short: new Set(["b", "s", "z"]),
    },
    /** Revision and repository-layout resolution. Prints refs and paths. */
    "rev-parse": {
      flags: new Set([
        "--",
        "--abbrev-ref",
        "--git-common-dir",
        "--git-dir",
        "--is-bare-repository",
        "--is-inside-work-tree",
        "--quiet",
        "--short",
        "--show-cdup",
        "--show-prefix",
        "--show-toplevel",
        "--symbolic",
        "--symbolic-full-name",
        "--verify",
        "-q",
      ]),
      short: new Set(["q"]),
    },
    /**
     * Commit history. Messages, names and counts are metadata, not file contents — but the same verb
     * prints the patch under `-p`, `-u`, `-G` and `-S`, so those simply stay off the list and the
     * fail-closed default refuses them.
     */
    log: {
      flags: new Set([
        "--",
        "--abbrev-commit",
        "--all",
        "--author",
        "--color",
        "--committer",
        "--date",
        "--decorate",
        "--first-parent",
        "--follow",
        "--format",
        "--graph",
        "--grep",
        "--max-count",
        "--merges",
        "--name-only",
        "--name-status",
        "--no-color",
        "--no-decorate",
        "--no-merges",
        "--numstat",
        "--oneline",
        "--pretty",
        "--reverse",
        "--shortstat",
        "--since",
        "--stat",
        "--until",
        "-n",
      ]),
      short: new Set([]),
      numeric: true,
    },
    /** The patch *is* this verb's default output, so a name-only flag has to be asked for. */
    diff: {
      flags: new Set([...NAME_ONLY, "--", "--cached", "--color", "--no-color", "--staged"]),
      short: new Set([]),
      require: NAME_ONLY,
    },
    /** Branch names. The flags that create, rename or delete a branch are not listed. */
    branch: {
      flags: new Set([
        "--",
        "--all",
        "--color",
        "--contains",
        "--format",
        "--list",
        "--merged",
        "--no-color",
        "--no-merged",
        "--remotes",
        "--show-current",
        "--sort",
        "-a",
        "-q",
        "-r",
        "-v",
      ]),
      short: new Set(["a", "q", "r", "v"]),
    },
    /** Stash subject lines. `stash` alone, or with another sub-verb, changes the working tree. */
    "stash list": {
      flags: new Set(["--", "--format", "--oneline", "--pretty", "-n"]),
      short: new Set([]),
      numeric: true,
    },
    /** The nearest tag. Prints a name. */
    describe: {
      flags: new Set(["--", "--abbrev", "--all", "--always", "--contains", "--exclude", "--long", "--match", "--tags"]),
      short: new Set([]),
    },
    /** Commit counts and object names. `--header` prints more, so it is not here. */
    "rev-list": {
      flags: new Set([
        "--",
        "--all",
        "--branches",
        "--count",
        "--first-parent",
        "--max-count",
        "--merges",
        "--no-merges",
        "--remotes",
        "--reverse",
        "--tags",
        "-n",
      ]),
      short: new Set([]),
      numeric: true,
    },
    /** Tag names. Listing only: naming a tag creates one. */
    tag: {
      flags: new Set([
        "--",
        "--contains",
        "--format",
        "--list",
        "--merged",
        "--no-merged",
        "--points-at",
        "--sort",
        "-l",
      ]),
      short: new Set(["l"]),
      require: new Set(["--list", "-l"]),
    },
    /** Author counts. */
    shortlog: {
      flags: new Set(["--", "--email", "--numbered", "--summary", "-e", "-n", "-s"]),
      short: new Set(["e", "n", "s"]),
    },
    /** Repository size. */
    "count-objects": {
      flags: new Set(["--", "--human-readable", "--verbose", "-H", "-v"]),
      short: new Set(["H", "v"]),
    },
    /** Tracked path names. */
    "ls-files": {
      flags: new Set([
        "--",
        "--cached",
        "--deleted",
        "--exclude-standard",
        "--full-name",
        "--modified",
        "--others",
        "--stage",
        "-c",
        "-d",
        "-m",
        "-o",
        "-s",
        "-z",
      ]),
      short: new Set(["c", "d", "m", "o", "s", "z"]),
    },
  }

  /** A token is acceptable when it is not a flag, or is a flag the verb explicitly allows. */
  function acceptable(token: string, verb: GitVerb) {
    if (!token.startsWith("-")) return true
    const head = token.includes("=") ? token.slice(0, token.indexOf("=")) : token
    if (verb.flags.has(head)) return true
    if (verb.numeric && /^-\d+$/.test(token)) return true
    // Clustered short flags such as `-sb`, drawn only from the verb's own letters.
    if (/^-[a-zA-Z]{2,}$/.test(token)) return [...token.slice(1)].every((letter) => verb.short.has(letter))
    return false
  }

  function inertGit(argv: readonly string[]) {
    return matches(argv, GIT_GLOBALS, GIT_VERBS)
  }

  /**
   * A verb-and-argument allowlist for a tool that dispatches on its first word. Global flags before
   * the verb are refused unless explicitly listed, because that is where these tools let a caller
   * redirect the whole operation somewhere else.
   */
  function matches(argv: readonly string[], globals: ReadonlySet<string>, verbs: Record<string, GitVerb>) {
    let index = 1
    // Global flags sit before the verb, and almost all of them can redirect or reprogram the run.
    while (index < argv.length && argv[index]!.startsWith("-")) {
      if (!globals.has(argv[index]!)) return false
      index++
    }
    const name = argv[index]
    if (name === undefined) return false
    // Some verbs are read-only in one sub-form only — `stash list` lists, `stash` itself changes the
    // working tree — so a two-word key is tried before the bare one.
    const pair = argv[index + 1] === undefined ? undefined : `${name} ${argv[index + 1]}`
    const compound = pair !== undefined ? verbs[pair] : undefined
    const verb = compound ?? verbs[name]
    if (!verb) return false
    const rest = argv.slice(index + (compound ? 2 : 1))
    const required = verb.require
    if (required && !rest.some((token) => required.has(token.split("=")[0]))) return false
    return rest.every((token) => acceptable(token, verb))
  }

  /** True only for a command proven inert here. An unnamed executable is never inert. */
  function inert(unit: SecurityDecisionTypes.ExecCommandFact) {
    const name = unit.executable
    if (!name) return false
    if (unit.ambient) return false
    // Every allowlist below is written about the program a bare name resolves to. A path names a
    // file the command line picked instead, and an assignment moves the resolution itself, so in
    // both cases the name is a spelling rather than an identity and proves nothing.
    if (unit.pathed || unit.assigns) return false
    if (INERT.has(name)) return true
    if (versionOnly(unit)) return true
    // Without the parsed command line there is nothing to prove anything against.
    const argv = unit.argv
    if (argv === undefined || argv.length === 0) return false
    if (name === "git") return inertGit(argv)
    if (name === "docker") return inertDocker(argv)
    return false
  }

  /**
   * Executables the layer has an opinion about. A command whose name is here and that still did not
   * pass `inert` was *refused*, not left unknown — so confinement must not re-admit it by another
   * route. Anything outside this set is genuinely unclassified, which is what containment can settle.
   */
  function opinionated(unit: SecurityDecisionTypes.ExecCommandFact) {
    const name = unit.executable
    return name !== undefined && (INERT.has(name) || name === "git")
  }

  /**
   * The commands one action will run. A sequence the scan decomposed is judged element by element;
   * anything else is the single command the facts describe.
   */
  function units(exec: SecurityDecisionTypes.ExecFact): readonly SecurityDecisionTypes.ExecCommandFact[] {
    return exec.commands && exec.commands.length > 0 ? exec.commands : [exec]
  }

  /**
   * Package managers, by the verbs that reach outside the repository for a package: adding one,
   * resolving a manifest into a tree, or fetching one only to run it. The name that follows is
   * whatever the model wrote, and nothing observable here can tell a real package from a
   * hallucinated one, so the whole family is a human boundary rather than a classification problem.
   */
  const PACKAGE_VERBS: Record<string, ReadonlySet<string>> = {
    npm: new Set(["install", "i", "add", "ci", "install-test", "it", "exec", "x", "update", "up"]),
    pnpm: new Set(["install", "i", "add", "dlx", "update", "up"]),
    yarn: new Set(["install", "add", "dlx", "up", "upgrade"]),
    bun: new Set(["install", "i", "add", "x", "update"]),
    deno: new Set(["install", "add", "cache"]),
    pip: new Set(["install", "download"]),
    pip3: new Set(["install", "download"]),
    uv: new Set(["add", "sync", "install", "pip", "tool"]),
    poetry: new Set(["add", "install", "update"]),
    pdm: new Set(["add", "install", "update"]),
    conda: new Set(["install", "create"]),
    cargo: new Set(["add", "install", "fetch"]),
    // System package managers reach outside the machine for code exactly like the language ones do.
    brew: new Set(["install", "reinstall", "upgrade", "tap"]),
    apt: new Set(["install", "upgrade", "full-upgrade", "build-dep"]),
    "apt-get": new Set(["install", "upgrade", "dist-upgrade", "build-dep"]),
    yum: new Set(["install", "upgrade", "update", "localinstall", "reinstall"]),
    dnf: new Set(["install", "upgrade", "update", "localinstall", "reinstall"]),
    zypper: new Set(["install", "in", "up", "update"]),
    apk: new Set(["add", "upgrade"]),
    pacman: new Set(["-S", "-U", "-Sy", "-Su", "-Syu"]),
    port: new Set(["install", "upgrade"]),
    snap: new Set(["install", "refresh"]),
    choco: new Set(["install", "upgrade"]),
    scoop: new Set(["install", "update"]),
    "nix-env": new Set(["-i", "-iA", "--install"]),
    pipenv: new Set(["install", "update", "sync"]),
    mamba: new Set(["install", "create"]),
    micromamba: new Set(["install", "create"]),
    go: new Set(["get", "install"]),
    gem: new Set(["install", "fetch"]),
    bundle: new Set(["add", "install", "update"]),
    composer: new Set(["require", "install", "update"]),
  }

  /**
   * Commands that steer the machine rather than the project: process control, service and login
   * item registration, disk, power and network settings, and privilege elevation.
   */
  const HOST = new Set([
    "at",
    "csrutil",
    "defaults",
    "diskutil",
    "doas",
    "dscl",
    "dseditgroup",
    "fdesetup",
    "firewall-cmd",
    "groupadd",
    "halt",
    "ifconfig",
    "iptables",
    "kextload",
    "kextunload",
    "kill",
    "killall",
    "launchctl",
    "mount",
    "networksetup",
    "nvram",
    "passwd",
    "pkill",
    "pmset",
    "poweroff",
    "reboot",
    "renice",
    "route",
    "scutil",
    "service",
    "shutdown",
    "softwareupdate",
    "spctl",
    "su",
    "sudo",
    "sysctl",
    "systemctl",
    "systemsetup",
    "tmutil",
    "ufw",
    "umount",
    "useradd",
    "usermod",
    "visudo",
    "crontab",
    // Launchers, pasteboard and detached sessions: host state and processes that outlive this call.
    "caffeinate",
    "chflags",
    "open",
    "pbcopy",
    "pbpaste",
    "screen",
    "tmux",
    "xdg-open",
  ])

  /**
   * Commands that hand execution to a privileged daemon or another machine. The sandbox confines
   * this process; it does not confine what the daemon or the remote host then does on its behalf.
   */
  const DELEGATES = new Set([
    "colima",
    "dbus-send",
    "docker",
    "docker-compose",
    "nc",
    "ncat",
    "netcat",
    "osascript",
    "socat",
    "telnet",
    "gdbus",
    "helm",
    "incus",
    "kubectl",
    "limactl",
    "lxc",
    "machinectl",
    "nerdctl",
    "nsenter",
    "podman",
    "rsync",
    "scp",
    "sftp",
    "ssh",
    "systemd-run",
    "vagrant",
    "virsh",
  ])

  /** Verbs that reach another machine: the same delegation `DELEGATES` names, spelled in git. */
  /**
   * Docker forms that report names and status without printing what a container was given. `logs`
   * and `inspect` are absent on purpose: the first prints application output and the second prints
   * the container's environment, which is where a secret actually surfaces. Global flags are all
   * refused — `-H` and `--context` point the client at another daemon.
   */
  const DOCKER_GLOBALS = new Set<string>([])

  const DOCKER_VERBS: Record<string, GitVerb> = {
    ps: {
      flags: new Set(["--", "--all", "--filter", "--last", "--latest", "--quiet", "-a", "-f", "-l", "-n", "-q"]),
      short: new Set(["a", "l", "q"]),
      numeric: true,
    },
    images: {
      flags: new Set(["--", "--all", "--filter", "--quiet", "-a", "-f", "-q"]),
      short: new Set(["a", "q"]),
    },
    version: { flags: new Set(["--"]), short: new Set([]) },
    "compose ps": {
      flags: new Set(["--", "--all", "--filter", "--quiet", "--services", "-a", "-q"]),
      short: new Set(["a", "q"]),
    },
  }

  function inertDocker(argv: readonly string[]) {
    return matches(argv, DOCKER_GLOBALS, DOCKER_VERBS)
  }

  const GIT_REMOTE = new Set(["clone", "fetch", "pull", "push", "remote", "submodule"])

  /** Verbs that change the repository, its refs, its working tree or its configuration. */
  const GIT_MUTATION = new Set([
    "add",
    "am",
    "apply",
    "branch",
    "checkout",
    "cherry-pick",
    "clean",
    "commit",
    "config",
    "filter-branch",
    "gc",
    "init",
    "merge",
    "mv",
    "prune",
    "rebase",
    "reset",
    "restore",
    "revert",
    "rm",
    "stash",
    "switch",
    "tag",
    "update-index",
    "update-ref",
    "worktree",
  ])

  /** The verb of a git invocation, or undefined when a global flag already disqualified the run. */
  function gitVerb(argv: readonly string[]) {
    let index = 1
    while (index < argv.length && argv[index]!.startsWith("-")) {
      if (!GIT_GLOBALS.has(argv[index]!)) return undefined
      index++
    }
    return argv[index]
  }

  /**
   * What a git invocation does, for the invocations the allowlist already refused. An inert one is
   * classified as nothing: `git branch -a` lists names, `git branch -d` deletes one, and only the
   * argument allowlist tells them apart.
   */
  function gitAction(unit: SecurityDecisionTypes.ExecCommandFact) {
    if (unit.executable !== "git" || inert(unit)) return undefined
    const argv = unit.argv
    if (!argv || argv.length === 0) return undefined
    const verb = gitVerb(argv)
    if (verb === undefined) return undefined
    if (GIT_REMOTE.has(verb)) return "remote" as const
    if (GIT_MUTATION.has(verb)) return "mutation" as const
    return undefined
  }

  function steers(unit: SecurityDecisionTypes.ExecCommandFact) {
    // A form the allowlist already proved read-only is not steering anything.
    if (inert(unit)) return false
    const name = unit.executable
    if (name !== undefined && (HOST.has(name) || DELEGATES.has(name))) return true
    return gitAction(unit) === "remote"
  }

  function mutatesRepo(unit: SecurityDecisionTypes.ExecCommandFact) {
    return gitAction(unit) === "mutation"
  }

  /** Executables that are themselves a fetch-and-run: the verb is the package name. */
  const PACKAGE_RUNNERS = new Set(["npx", "pnpx", "bunx", "uvx", "pipx"])

  /** Managers that install from the lockfile when invoked with no verb at all. */
  const PACKAGE_BARE = new Set(["yarn"])

  /**
   * True when the command reaches for an external package.
   *
   * The verb is matched anywhere in the arguments rather than at a fixed position: a manager can be
   * redirected first (`npm --prefix ./app install`), and over-reporting here only turns a reviewable
   * ask into a human one, while under-reporting would hand the install to the reviewer.
   */
  function installs(unit: SecurityDecisionTypes.ExecCommandFact) {
    const name = unit.executable
    if (!name) return false
    if (PACKAGE_RUNNERS.has(name)) return true
    const argv = unit.argv
    if (!argv || argv.length === 0) return false
    if (PACKAGE_BARE.has(name) && argv.length === 1) return true
    // `python -m pip install x` runs the manager as a module, so the manager is the argument.
    const module = argv.indexOf("-m")
    const via = module >= 0 ? argv[module + 1] : undefined
    const verbs = PACKAGE_VERBS[name] ?? (via ? PACKAGE_VERBS[via] : undefined)
    if (!verbs) return via !== undefined && PACKAGE_RUNNERS.has(via)
    return argv.slice(1).some((token) => verbs.has(token))
  }

  function target(input: SecurityDecisionTypes.Input, fact: SecurityDecisionTypes.PathFact): R.Entry {
    // A shell command can read one target and write another, so a fact's own operation wins.
    const op = fact.operation ?? input.action.operation
    const exec = input.action.exec

    // Exact, fully parsed destruction of a root/device target — the narrow soft-path deny.
    if (fact.class === "root") {
      if (op === "delete" && exec?.complete && !exec.composed) return R.DESTRUCTIVE_ROOT
      // Anything else aimed at the root or a device is a boundary crossing, not a soft ambiguity a
      // reviewer could resolve: writing a raw device is never ordinary development work.
      return R.SENSITIVE_BOUNDARY
    }

    if (fact.class === "git_hook") {
      if (WRITES.has(op)) return R.GIT_HOOK_WRITE
      if (op === "read") return R.NO_OPINION
      return R.AMBIGUOUS_OPERATION
    }

    // Reading the control plane is ordinary; installing into it is not.
    if (fact.class === "control_plane") {
      if (!fact.inWorkspace) return R.SENSITIVE_BOUNDARY
      if (WRITES.has(op)) return R.CONTROL_PLANE_WRITE
      if (op === "read") return R.NO_OPINION
      return R.AMBIGUOUS_OPERATION
    }

    if (fact.class === "unknown") return R.UNKNOWN_TARGET
    if (fact.class === "sensitive" || !fact.inWorkspace) return R.SENSITIVE_BOUNDARY
    if (fact.class === "ci") return op === "read" ? R.NO_OPINION : R.CI_AUTHORITY
    // A manifest declares what the project pulls in and what runs around an install. Both are the
    // same human boundary as the install itself; the region only decides which rule names it, and an
    // undetermined region stays on the stricter side rather than falling through to an ordinary edit.
    if (fact.class === "package_manifest") {
      if (op === "read") return R.NO_OPINION
      if (WRITES.has(op)) return fact.region === "scripts" ? R.PACKAGE_EXECUTION : R.DEPENDENCY_MANIFEST_WRITE
      return R.AMBIGUOUS_OPERATION
    }
    if (DESTRUCTIVE.has(op)) return R.DESTRUCTIVE_FS
    return R.NO_OPINION
  }

  /**
   * True when the containment facts prove this call cannot reach past the workspace: a sandbox that
   * was actually verified this process, a network that is closed or bounded to exact destinations,
   * and no escalation out of either. It is deliberately not available against a human-only guard or
   * any authority above `untrusted` — confinement is evidence about reach, not about permission.
   */
  function contained(input: SecurityDecisionTypes.Input, exec: SecurityDecisionTypes.ExecFact) {
    if (input.baseline.humanOnly || input.baseline.authority !== "untrusted") return false
    if (units(exec).some(opinionated)) return false
    const facts = input.containment
    if (facts.sandbox !== "operational" || facts.escalated || facts.widened) return false
    if (facts.network === "allow") return false
    return facts.network !== "proxy" || facts.destinations.length > 0
  }

  /**
   * Programs whose whole purpose is running another command. The program they execute lives in
   * their arguments, so the scan's view of the command line and the action performed are different
   * things, and confinement says nothing about the difference.
   */
  const SHELLS = new Set(["ash", "bash", "busybox", "csh", "dash", "fish", "ksh", "sh", "tcsh", "zsh"])

  /** Wrappers that take a command as their arguments and hand execution to it. */
  const WRAPPERS = new Set([
    "chroot",
    "command",
    "doas",
    "eval",
    "exec",
    "nice",
    "nohup",
    "script",
    "setsid",
    "stdbuf",
    "su",
    "sudo",
    "time",
    "timeout",
    "watch",
    "xargs",
  ])

  /** Interpreters whose program is always the first argument, with no flag to mark it. */
  const SCRIPT_FIRST = new Set(["awk", "gawk", "mawk", "osascript"])

  /** Flags that hand a program to the executable as text. */
  const CODE_FLAGS = new Set(["--eval", "--exec", "-E", "-c", "-e"])

  /**
   * Characters that let an argument carry a nested command rather than name a value. The carrier
   * lists above cannot be complete — the next interpreter is always one release away — so this
   * structural check stands *alongside* them rather than after them.
   */
  const NESTED = /[\s;|&`$(){}<>\\'"]/

  /** True when the unit runs a program the scan cannot see. */
  function carries(unit: SecurityDecisionTypes.ExecCommandFact) {
    const name = unit.executable
    if (!name || unit.pathed) return true
    // These utilities can mutate through options or embedded programs the scan does not model.
    if (["sed", "truncate", "tee", "dd", "sort", "install", "rsync", "tar", "unzip"].includes(name)) return true
    if (SHELLS.has(name) || WRAPPERS.has(name) || SCRIPT_FIRST.has(name)) return true
    const argv = unit.argv ?? []
    if (argv.some((token) => CODE_FLAGS.has(token))) return true
    return argv.slice(1).some((token) => NESTED.test(token))
  }

  /**
   * Whether a contained ask may be offered to a reviewer.
   *
   * Confinement is evidence about reach: the sandbox bounds writes and network, while the command's
   * own output still leaves it for the model context. That makes containment necessary but not
   * sufficient — the invocation must also be structurally simple, so the question put to a reviewer
   * is "does this bounded, legible command fit the task" rather than "what does this program do".
   */
  function eligible(exec: SecurityDecisionTypes.ExecFact) {
    return !units(exec).some(carries)
  }

  /** `deny > ask > allow`; `pass` carries no strictness. */
  function strictness(decision: SecurityDecisionTypes.Decision) {
    return decision === "deny" ? 3 : decision === "ask" ? 2 : decision === "allow" ? 1 : 0
  }

  /**
   * Where a rule sits in the aggregation order.
   *
   * Strictness alone is not a total order over the catalog: most rules are `ask`, and among asks a
   * *non-reviewable* one is stricter than a reviewable one, because only the first is guaranteed to
   * reach a human. Folding facts with `strictness` alone therefore let the first ask encountered
   * win, so `rm build/out.js ~/.ssh/id_rsa` was reviewable while the same two targets in the other
   * order were not. Reviewability is part of the rank, and equal ranks fall back to the rule id, so
   * the outcome is a function of the *set* of facts rather than of their order.
   */
  function precedence(rule: R.Entry) {
    return strictness(rule.decision) * 2 + (rule.reviewable ? 0 : 1)
  }

  function stronger(candidate: R.Entry, current: R.Entry) {
    const left = precedence(candidate)
    const right = precedence(current)
    if (left !== right) return left > right
    // Preserve a concrete explanation over an equally strict uncertainty about another operand.
    if (candidate.id === R.AMBIGUOUS_OPERATION.id || current.id === R.AMBIGUOUS_OPERATION.id)
      return current.id === R.AMBIGUOUS_OPERATION.id && candidate.id !== current.id
    return candidate.id < current.id
  }

  export function decide(input: SecurityDecisionTypes.Input): SecurityDecisionTypes.Result {
    const rule = evaluate(input)
    // The soft-path deny is only available against untrusted authority, and never against an
    // existing human-only guard: those stay at ask so a human still resolves them.
    if (rule.decision === "deny" && (input.baseline.humanOnly || input.baseline.authority !== "untrusted")) {
      return { ...R.result(rule), decision: "ask", reviewable: false }
    }
    const result = R.result(rule)
    // An existing human-only guard is never narrowed by a reviewer: a human has to answer it.
    if (input.baseline.humanOnly && result.decision === "ask") return { ...result, reviewable: false }
    // The contained population is not reviewable as a class; each invocation earns it separately.
    if (rule.id === R.CONTAINED_EXEC.id)
      return { ...result, reviewable: input.action.exec !== undefined && eligible(input.action.exec) }
    return result
  }

  function evaluate(input: SecurityDecisionTypes.Input): R.Entry {
    // Opaque delegated actions stay opaque in V1: no semantic classification, and their empty
    // metadata must not be reported as a generic metadata gap.
    if (input.action.kind === "mcp") return R.DELEGATED_OPAQUE

    if (!input.metadata.complete || input.metadata.truncated) return R.METADATA_INCOMPLETE

    const exec = input.action.exec
    if (exec) {
      if (!exec.complete) return R.EXEC_INCOMPLETE
      // Pure sequencing is plumbing: the scan recovered every command, so each is judged on its own.
      // Anything that rewrites what runs stays opaque.
      if (exec.composed && !exec.decomposable) return R.EXEC_COMPOSED
    }

    // A fetch of an external package is decided before any path rule: the command has no file
    // effect the scan can see, and its target is a name rather than a path.
    const ambient = exec && units(exec).some((unit) => unit.ambient)
    let winner: R.Entry = R.NO_OPINION
    const consider = (rule: R.Entry) => {
      if (stronger(rule, winner)) winner = rule
    }
    if (exec) {
      if (units(exec).some(installs)) consider(R.DEPENDENCY_INSTALL)
      if (units(exec).some(steers)) consider(R.HOST_CONTROL)
      if (units(exec).some(mutatesRepo)) consider(R.REPO_MUTATION)
    }
    for (const fact of input.action.paths) consider(target(input, fact))
    if (ambient && precedence(R.AMBIENT_ENVIRONMENT) > precedence(winner)) consider(R.AMBIENT_ENVIRONMENT)
    // Execution is an independent contributor. Compute its reviewability before aggregation so a
    // filesystem ask cannot hide an unclassified executable or an opaque contained invocation.
    if (exec && units(exec).some((unit) => unit.classified !== true && !inert(unit))) {
      const rule = contained(input, exec) ? { ...R.CONTAINED_EXEC, reviewable: eligible(exec) } : R.UNCLASSIFIED_EXEC
      if (precedence(rule) > precedence(winner)) consider(rule)
    }
    return winner
  }
}
