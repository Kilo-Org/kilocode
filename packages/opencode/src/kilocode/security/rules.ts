import { CommandSemantics } from "./command"
import { evidence } from "./decision"
import { PathRisk } from "./path"
import { ShellNormalizer } from "./shell"
import type {
  FileEffect,
  NormalizedAction,
  NormalizedCommand,
  NormalizedPath,
  NormalizedProcess,
  SecurityContext,
  SecurityEvidence,
} from "./types"

/**
 * Deterministic policy. Hard rules are immutable and cannot be relaxed by any configuration or by
 * the model; default rules describe the low-friction baseline and produce soft asks that the
 * existing permission model may still resolve through explicit user rules.
 *
 * Rules never look at an executable name alone: they combine the command family, its arguments,
 * the classified target paths and the session context.
 */
export namespace SecurityRules {
  type Out = SecurityEvidence[]

  // Loopback in every spelling an attacker may try: dotted, short, decimal, hex, IPv6, wildcard DNS.
  const LOOPBACK =
    /(^|\/\/|@|:)(127(\.\d{1,3}){1,3}|localhost(\.[a-z0-9.-]*)?|0\.0\.0\.0|0x7f[0-9a-f]{6}|0177\.[0-7.]+|2130706433|\[(::1?|0*(:0*){2,7}1?)\]|[a-z0-9.-]*\.(nip|sslip|traefik)\.(io|me)|[a-z0-9.-]*localtest\.me|[a-z0-9.-]*\.local)(:\d+)?(\/|$)/i
  const KILO_ROUTES = /\/(permission|sandbox|allow-everything|config|session\/[^/]+\/(permission|sandbox))/i
  const UNIX_SOCKET = /^--(abstract-)?unix-socket(=|$)/
  const RAW_SOCKET = new Set(["nc", "ncat", "netcat", "socat", "telnet", "openssl"])
  const NETWORK_PASSTHROUGH = new Set(["webfetch", "websearch", "repo_clone", "browser_open", "semantic_search"])
  const READONLY_PERMISSIONS = new Set([
    "glob",
    "grep",
    "list",
    "codesearch",
    "lsp",
    "skill",
    "todowrite",
    "todoread",
    "question",
    "recall",
    "kilo_local_recall",
    "kilo_memory_recall",
    "board_read",
    "repo_overview",
    "agent_manager_models",
  ])

  /** True when a network command's arguments name a loopback / local destination (any spelling). */
  export function local(argv: string[]): boolean {
    return argv
      .map(CommandSemantics.dequote)
      .some(
        (arg) =>
          LOOPBACK.test(arg) || UNIX_SOCKET.test(arg) || /^(localhost|127(\.\d{1,3}){1,3}|0\.0\.0\.0|::1)$/i.test(arg),
      )
  }

  function hard(
    rule: string,
    action: SecurityEvidence["action"],
    reasonCode: SecurityEvidence["reasonCode"],
    message: string,
    attributes?: SecurityEvidence["attributes"],
  ) {
    return evidence({ rule, source: "hard", action, reasonCode, message, attributes })
  }

  function soft(
    rule: string,
    reasonCode: SecurityEvidence["reasonCode"],
    message: string,
    attributes?: SecurityEvidence["attributes"],
  ) {
    return evidence({ rule, source: "default", action: "ask", reasonCode, message, attributes })
  }

  function allow(rule: string, reasonCode: SecurityEvidence["reasonCode"], message: string) {
    return evidence({ rule, source: "default", action: "allow", reasonCode, message })
  }

  /** Effect-aware path policy shared by shell operands, redirects and file tools. */
  export function pathRules(
    target: NormalizedPath,
    effect: FileEffect,
    opts: { recursive: boolean; executable?: string; within?: boolean; metadata?: boolean },
  ): Out {
    const out: Out = []
    const attrs = { relation: target.relation, effect, ...(opts.executable ? { executable: opts.executable } : {}) }
    // `find . -delete` removes entries under the workspace, not the workspace itself.
    if (opts.within && target.relation === "workspace-root")
      return pathRules({ ...target, relation: "workspace" }, effect, { ...opts, within: false })
    // Listing or stat-ing a path reveals names and sizes, not contents.
    if (opts.metadata && effect === "read" && target.relation !== "unknown") {
      out.push(allow("default.path.metadata", "SAFE_READ", "Metadata-only access."))
      return out
    }
    const mutating = effect === "write" || effect === "delete" || effect === "chmod"
    const secret = PathRisk.secret(target)

    // An unrecognised command touching a path: it might read or write it, so protected locations need
    // a human and key material is refused outright.
    if (effect === "unknown") {
      const shielded = ["root", "system", "home-root", "home-sensitive", "kilo-security", "workspace-config"].includes(
        target.relation,
      )
      if (secret)
        out.push(
          hard("hard.unknown.secret", "deny", "SENSITIVE_READ", "An unrecognised command targets key material.", attrs),
        )
      else if (shielded)
        out.push(
          hard(
            "hard.unknown.protected",
            "ask",
            "UNCLASSIFIED_ACTION",
            "An unrecognised command targets a protected location.",
            attrs,
          ),
        )
      else if (target.relation === "home" || target.relation === "external")
        out.push(
          soft(
            "default.unknown.external",
            "EXTERNAL_PATH",
            "An unrecognised command targets a path outside the workspace.",
            attrs,
          ),
        )
      else if (target.relation === "unknown")
        out.push(
          hard(
            "hard.unknown.dynamic",
            "ask",
            "DYNAMIC_TARGET",
            "An unrecognised command targets a path that cannot be determined.",
            attrs,
          ),
        )
      else out.push(allow("default.unknown.workspace", "SAFE_WORKSPACE_ACTION", "Workspace action."))
      return out
    }

    // Recursive content access over a whole tree (find -exec cat, grep -r) outside the workspace
    // sweeps up every secret underneath it.
    if (
      effect === "read" &&
      (opts.within || opts.recursive) &&
      !opts.metadata &&
      ["home-root", "root", "system", "home", "external"].includes(target.relation)
    ) {
      out.push(
        hard(
          "hard.read.broad",
          "ask",
          "SENSITIVE_READ",
          "The command reads every file under a directory outside the workspace.",
          attrs,
        ),
      )
      return out
    }

    if (target.labels.includes("device") && mutating) {
      out.push(
        hard(
          "hard.device.write",
          "deny",
          "DESTRUCTIVE_DEVICE",
          "The operation writes to a block or character device.",
          attrs,
        ),
      )
      return out
    }
    if (
      target.labels.includes("workspace-ancestor") &&
      (effect === "delete" || (effect === "chmod" && opts.recursive))
    ) {
      out.push(
        hard(
          "hard.fs.workspace-ancestor",
          "deny",
          "DESTRUCTIVE_FILESYSTEM",
          "The operation removes a directory that contains the workspace.",
          attrs,
        ),
      )
      return out
    }

    switch (target.relation) {
      case "unknown":
        if (mutating || effect === "exec")
          out.push(
            hard(
              "hard.path.dynamic",
              "ask",
              "DYNAMIC_TARGET",
              "The target path cannot be determined statically.",
              attrs,
            ),
          )
        else
          out.push(
            soft(
              "default.path.dynamic-read",
              "DYNAMIC_TARGET",
              "The file being read cannot be determined statically.",
              attrs,
            ),
          )
        return out
      case "root":
        if (mutating)
          out.push(
            hard("hard.fs.root", "deny", "DESTRUCTIVE_FILESYSTEM", "The operation targets the filesystem root.", attrs),
          )
        return out
      case "system":
        if (effect === "delete" || (effect === "chmod" && opts.recursive))
          out.push(
            hard(
              "hard.fs.system-destroy",
              "deny",
              "DESTRUCTIVE_FILESYSTEM",
              "The operation removes or recursively changes system files.",
              attrs,
            ),
          )
        // Writing *to* a discard device is not a system change: `2>/dev/null` is one of the most
        // common things a shell command does, and the data goes nowhere. Deleting or replacing the
        // device node itself is still a system change and still falls to the branch above.
        else if (mutating && !target.labels.includes("device-safe"))
          out.push(
            hard("hard.fs.system-write", "ask", "SYSTEM_MODIFICATION", "The operation modifies system files.", attrs),
          )
        if (target.labels.includes("shell-persistence") && mutating)
          out.push(
            hard(
              "hard.persistence.system",
              "deny",
              "SHELL_PERSISTENCE",
              "The operation changes system startup or scheduled-task configuration.",
              attrs,
            ),
          )
        return out
      case "home-root":
        if (mutating)
          out.push(
            hard(
              "hard.fs.home-root",
              "deny",
              "DESTRUCTIVE_FILESYSTEM",
              "The operation targets the home directory itself.",
              attrs,
            ),
          )
        return out
      case "kilo-security":
        if (mutating)
          out.push(
            hard(
              "hard.policy.kilo-state",
              "deny",
              "POLICY_TAMPERING",
              "The operation modifies Kilo configuration, permission or sandbox state.",
              attrs,
            ),
          )
        else if (effect === "read" && target.labels.includes("kilo-state"))
          out.push(
            hard(
              "hard.policy.kilo-state-read",
              "deny",
              "SENSITIVE_READ",
              "Kilo runtime state holds credentials and session data.",
              attrs,
            ),
          )
        else if (effect === "read")
          out.push(
            hard(
              "hard.policy.kilo-config-read",
              "ask",
              "PROTECTED_PATH",
              "Kilo configuration may contain secrets.",
              attrs,
            ),
          )
        return out
      case "home-sensitive":
        if (mutating) {
          const persistence = target.labels.includes("shell-persistence")
          out.push(
            persistence
              ? hard(
                  "hard.persistence.home",
                  "deny",
                  "SHELL_PERSISTENCE",
                  "The operation changes shell startup files or user autostart entries.",
                  attrs,
                )
              : hard(
                  "hard.sensitive.write",
                  "deny",
                  "SENSITIVE_WRITE",
                  "The operation modifies a credential store or security-sensitive configuration.",
                  attrs,
                ),
          )
          return out
        }
        if (effect === "read" || effect === "exec") {
          if (secret)
            out.push(
              hard(
                "hard.sensitive.read",
                "deny",
                "SENSITIVE_READ",
                "The path holds private keys or credentials.",
                attrs,
              ),
            )
          else if (target.labels.includes("credential"))
            out.push(
              hard(
                "hard.sensitive.read-metadata",
                "ask",
                "SENSITIVE_READ",
                "The path belongs to a credential store.",
                attrs,
              ),
            )
          else out.push(allow("default.sensitive.read-config", "SAFE_READ", "Reading shell or git configuration."))
        }
        return out
      case "workspace-config":
        if (mutating)
          out.push(
            hard(
              "hard.workspace.config",
              "ask",
              "PROTECTED_PATH",
              "The operation modifies Kilo project configuration, agents, skills or instructions.",
              attrs,
            ),
          )
        else out.push(allow("default.workspace.config-read", "SAFE_READ", "Reading project configuration."))
        return out
      case "workspace-root":
        if (effect === "delete" || (effect === "chmod" && opts.recursive))
          out.push(
            hard(
              "hard.workspace.root",
              "ask",
              "DESTRUCTIVE_FILESYSTEM",
              "The operation affects the whole workspace.",
              attrs,
            ),
          )
        else out.push(allow("default.workspace", "SAFE_WORKSPACE_ACTION", "Workspace action."))
        return out
      case "workspace":
        if (target.labels.includes("git-dir") && mutating) {
          out.push(
            hard(
              "hard.workspace.git-dir",
              "ask",
              "DESTRUCTIVE_GIT",
              "The operation modifies the .git directory directly.",
              attrs,
            ),
          )
          return out
        }
        if (secret && effect === "read") {
          out.push(
            hard("hard.workspace.secret-read", "ask", "SENSITIVE_READ", "The file looks like key material.", attrs),
          )
          return out
        }
        if (target.labels.includes("secret") && effect === "read") {
          out.push(
            hard("hard.workspace.env-read", "ask", "SENSITIVE_READ", "Environment files may contain secrets.", attrs),
          )
          return out
        }
        out.push(
          allow("default.workspace", effect === "read" ? "SAFE_READ" : "SAFE_WORKSPACE_ACTION", "Workspace action."),
        )
        return out
      case "temp":
        out.push(
          allow(
            "default.temp",
            effect === "read" ? "SAFE_READ" : "SAFE_WORKSPACE_ACTION",
            "Temporary directory action.",
          ),
        )
        return out
      case "home":
      case "external": {
        if (effect === "delete" && opts.recursive)
          out.push(
            hard(
              "hard.fs.external-recursive-delete",
              "ask",
              "DESTRUCTIVE_FILESYSTEM",
              "The operation recursively deletes outside the workspace.",
              attrs,
            ),
          )
        else if (mutating)
          out.push(
            soft("default.path.external-write", "EXTERNAL_PATH", "The operation writes outside the workspace.", attrs),
          )
        else if (effect === "exec")
          out.push(
            soft("default.path.external-exec", "EXTERNAL_PATH", "The script lives outside the workspace.", attrs),
          )
        else if (secret)
          out.push(
            hard("hard.external.secret-read", "ask", "SENSITIVE_READ", "The file looks like key material.", attrs),
          )
        else out.push(allow("default.path.external-read", "SAFE_READ", "Reading outside the workspace."))
        return out
      }
    }
  }

  function processRules(process: NormalizedProcess, command: NormalizedCommand): Out {
    const out: Out = []
    const exe = process.executable ?? process.wrapper ?? "?"
    const attrs = { executable: exe }

    if (process.privileged)
      out.push(
        hard("hard.privilege", "deny", "PRIVILEGE_ESCALATION", "The command escalates privileges.", {
          wrapper: process.wrapper ?? exe,
        }),
      )

    if (process.family === "device")
      out.push(
        hard("hard.device", "deny", "DESTRUCTIVE_DEVICE", "The command formats or overwrites storage devices.", attrs),
      )
    if (process.family === "system-control") {
      out.push(
        process.force
          ? hard(
              "hard.system.control",
              "deny",
              "SYSTEM_MODIFICATION",
              "The command changes system state that cannot be undone from the session.",
              attrs,
            )
          : hard(
              "hard.system.control-ask",
              "ask",
              "SYSTEM_MODIFICATION",
              "The command changes system services or settings.",
              attrs,
            ),
      )
    }
    if (process.family === "persistence")
      out.push(
        hard(
          "hard.persistence.command",
          "deny",
          "SHELL_PERSISTENCE",
          "The command installs scheduled or startup tasks.",
          attrs,
        ),
      )
    if (process.family === "container") {
      if (process.force)
        out.push(
          hard(
            "hard.container",
            "ask",
            "SYSTEM_MODIFICATION",
            "The container operation is destructive or escapes isolation.",
            attrs,
          ),
        )
      else if (!process.metadata)
        out.push(soft("default.container", "UNCLASSIFIED_ACTION", "Container operation.", attrs))
    }

    const fetcherFeed = process.producers.some((item) => CommandSemantics.isFetcher(item))
    const fetcherAnywhere = ShellNormalizer.flatten(command).some(
      (item) => item.executable !== undefined && CommandSemantics.isFetcher(item.executable),
    )
    const indirect = process.indirection !== undefined
    if (indirect && process.encoded)
      out.push(
        hard(
          "hard.exec.encoded",
          "deny",
          "ENCODED_EXECUTION",
          "The command executes a decoded or encoded payload.",
          attrs,
        ),
      )
    if (indirect && (fetcherFeed || (process.dynamic && fetcherAnywhere && process.indirection !== "interpreter"))) {
      out.push(
        hard(
          "hard.exec.remote",
          "deny",
          "REMOTE_EXECUTION",
          "The command executes content fetched from the network.",
          attrs,
        ),
      )
    }
    if (process.indirection === "eval")
      out.push(
        hard(
          "hard.exec.eval",
          "ask",
          "SHELL_INDIRECTION",
          "The command evaluates dynamically built shell code.",
          attrs,
        ),
      )
    if (
      (process.indirection === "shell" || process.indirection === "cmd") &&
      process.nested === undefined &&
      process.dynamic
    ) {
      out.push(
        hard(
          "hard.exec.opaque-shell",
          "ask",
          "SHELL_INDIRECTION",
          "The shell payload cannot be inspected statically.",
          attrs,
        ),
      )
    }
    if (
      (process.indirection === "shell" || process.indirection === "cmd") &&
      process.piped &&
      process.nested === undefined
    ) {
      out.push(
        hard(
          "hard.exec.piped-shell",
          "ask",
          "SHELL_INDIRECTION",
          "The shell reads its commands from a pipeline.",
          attrs,
        ),
      )
    }
    if (process.indirection === "interpreter" && process.operands.every((item) => item.effect !== "exec")) {
      out.push(
        soft(
          "default.exec.interpreter",
          "INTERPRETER_INDIRECTION",
          "Inline interpreter code cannot be verified.",
          attrs,
        ),
      )
    }
    if (process.indirection === "interpreter" && process.piped && process.operands.length === 0) {
      out.push(
        hard(
          "hard.exec.piped-interpreter",
          "ask",
          "SHELL_INDIRECTION",
          "The interpreter reads its program from a pipeline.",
          attrs,
        ),
      )
    }
    if (process.escape)
      out.push(
        hard(
          "hard.exec.escape",
          "ask",
          "SHELL_INDIRECTION",
          "An option of this command executes an arbitrary program.",
          { ...attrs, option: process.escape },
        ),
      )

    if (process.executable === undefined && !process.privileged && process.wrapper === undefined) {
      out.push(
        hard("hard.exec.dynamic-name", "ask", "SHELL_INDIRECTION", "The executable is computed at runtime.", attrs),
      )
    }

    if (
      process.stdinTargets &&
      (process.effect === "delete" || process.effect === "write" || process.effect === "chmod")
    ) {
      out.push(
        hard(
          "hard.path.stdin-targets",
          "ask",
          "DYNAMIC_TARGET",
          "The targets of a destructive command come from a pipeline.",
          attrs,
        ),
      )
    }

    for (const operand of process.operands) {
      out.push(
        ...pathRules(operand.path, operand.effect, {
          recursive: process.recursive,
          executable: exe,
          within: operand.within,
          metadata: process.metadata,
        }),
      )
    }

    // A command with no explicit operands still acts on its working directory (npm install, make,
    // tar x, git init ...). Outside the workspace that is an external side effect.
    if (!process.metadata && process.cwdRelation !== undefined) {
      const relation = process.cwdRelation
      if (
        relation === "home-sensitive" ||
        relation === "kilo-security" ||
        relation === "system" ||
        relation === "root" ||
        relation === "home-root"
      ) {
        out.push(
          hard("hard.cwd.sensitive", "ask", "EXTERNAL_PATH", "The command runs inside a sensitive directory.", {
            ...attrs,
            relation,
          }),
        )
      } else if (relation === "home" || relation === "external") {
        out.push(
          soft("default.cwd.external", "EXTERNAL_PATH", "The command runs outside the workspace.", {
            ...attrs,
            relation,
          }),
        )
      }
    }

    if (process.git) {
      const git = process.git
      const known = CommandSemantics.gitKnown(git.subcommand)
      if (git.destructive)
        out.push(
          hard(
            "hard.git.destructive",
            "ask",
            "DESTRUCTIVE_GIT",
            "The git operation discards history, working changes or remote refs.",
            { ...attrs, subcommand: git.subcommand },
          ),
        )
      else if (git.subcommand === "push")
        out.push(
          soft("default.git.push", "NETWORK_EGRESS", "Pushing to a remote.", { ...attrs, subcommand: git.subcommand }),
        )
      else if (!known)
        out.push(
          soft("default.git.unknown", "UNCLASSIFIED_ACTION", "Unrecognised git subcommand or alias.", {
            ...attrs,
            subcommand: git.subcommand,
          }),
        )
      else
        out.push(
          allow(
            "default.git",
            git.mutating ? "SAFE_WORKSPACE_ACTION" : "SAFE_READ",
            "Git operation inside the workspace.",
          ),
        )
    }

    if (process.pkg) {
      const pkg = process.pkg
      if (pkg.system)
        out.push(
          hard("hard.pkg.system", "ask", "SYSTEM_MODIFICATION", "System package management changes the host.", {
            ...attrs,
            manager: pkg.manager,
          }),
        )
      else if (pkg.operation === "publish")
        out.push(
          hard("hard.pkg.publish", "ask", "PACKAGE_PUBLISH", "Publishing or registry credential operations.", {
            ...attrs,
            manager: pkg.manager,
          }),
        )
      else if (pkg.operation === "install" && pkg.packages.length > 0)
        out.push(
          soft("default.pkg.install", "PACKAGE_INSTALL", "Installing new packages.", {
            ...attrs,
            manager: pkg.manager,
            count: pkg.packages.length,
          }),
        )
      else if (pkg.operation === "fetch-exec")
        out.push(
          soft("default.pkg.fetch-exec", "PACKAGE_INSTALL", "Fetching and executing a package.", {
            ...attrs,
            manager: pkg.manager,
          }),
        )
      else out.push(allow("default.pkg", "SAFE_WORKSPACE_ACTION", "Project package script."))
    }

    if (process.network && !process.pkg && !process.git && process.family !== "container") {
      const args = process.argv.map(CommandSemantics.dequote)
      const local = SecurityRules.local(process.argv)
      const route = args.some((arg) => KILO_ROUTES.test(arg))
      const raw = RAW_SOCKET.has(process.executable ?? "")
      if (route && local)
        out.push(
          hard(
            "hard.network.kilo-server",
            "deny",
            "POLICY_TAMPERING",
            "The command targets the local Kilo server permission or sandbox API.",
            attrs,
          ),
        )
      else if (route)
        out.push(
          hard(
            "hard.network.kilo-route",
            "ask",
            "POLICY_TAMPERING",
            "The command targets a permission or sandbox API route.",
            attrs,
          ),
        )
      else if (raw && local)
        out.push(
          hard(
            "hard.network.local-socket",
            "ask",
            "POLICY_TAMPERING",
            "The command opens a raw connection to a local service; the request cannot be inspected.",
            attrs,
          ),
        )
      else if (!process.metadata)
        out.push(soft("default.network", "NETWORK_EGRESS", "The command reaches the network.", attrs))
    }

    return out
  }

  function shellRules(command: NormalizedCommand): Out {
    const out: Out = []
    for (const nested of ShellNormalizer.all(command)) {
      if (!nested.fullyParsed || nested.unparsed.length > 0) {
        out.push(
          hard("hard.shell.unparsed", "ask", "UNKNOWN_SHELL_SYNTAX", "Part of the command could not be parsed.", {
            depth: nested.depth,
          }),
        )
      }
      if (nested.hasExpression) {
        out.push(
          hard(
            "hard.shell.expression",
            "ask",
            "UNKNOWN_SHELL_SYNTAX",
            "The PowerShell script calls .NET or reflection directly.",
            { depth: nested.depth },
          ),
        )
      }
      if (
        nested.commands.length === 0 &&
        nested.fullyParsed &&
        nested.source.trim().length > 0 &&
        nested.redirects.length === 0
      ) {
        // Bash text without a command node is inert (assignments, tests); a PowerShell expression can
        // still call .NET (`[IO.File]::Delete(...)`), so it stays opaque.
        out.push(
          nested.shell === "powershell"
            ? hard(
                "hard.shell.expression",
                "ask",
                "UNKNOWN_SHELL_SYNTAX",
                "The PowerShell expression does not map to a command.",
              )
            : allow("default.shell.no-command", "SAFE_COMMAND", "No command is executed."),
        )
      }
      for (const process of nested.commands) out.push(...processRules(process, nested))
      for (const redirect of nested.redirects) {
        if (redirect.dynamic || !redirect.path) {
          out.push(
            redirect.effect === "write"
              ? hard(
                  "hard.redirect.dynamic",
                  "ask",
                  "DYNAMIC_TARGET",
                  "The redirect target cannot be determined statically.",
                  { operator: redirect.operator },
                )
              : soft(
                  "default.redirect.dynamic-read",
                  "DYNAMIC_TARGET",
                  "The redirect source cannot be determined statically.",
                  { operator: redirect.operator },
                ),
          )
          continue
        }
        out.push(...pathRules(redirect.path, redirect.effect, { recursive: false, executable: "redirect" }))
      }
    }
    if (out.length === 0) out.push(allow("default.shell", "SAFE_COMMAND", "No risky signal detected."))
    return out
  }

  function fileRules(action: Extract<NormalizedAction, { kind: "file" }>): Out {
    const out: Out = []
    if (action.paths.length === 0)
      out.push(
        hard("hard.file.no-path", "ask", "DYNAMIC_TARGET", "The file operation carries no resolvable path.", {
          permission: action.permission,
        }),
      )
    for (const target of action.paths)
      out.push(...pathRules(target, action.effect, { recursive: action.effect === "delete" }))
    return out
  }

  function permissionRules(action: Extract<NormalizedAction, { kind: "permission" }>): Out {
    const attrs = { permission: action.permission }
    if (action.permission === "sandbox_escalation")
      return [
        hard(
          "hard.sandbox.escalation",
          "ask",
          "SANDBOX_ESCALATION",
          "Running outside the sandbox needs interactive approval.",
          attrs,
        ),
      ]
    if (NETWORK_PASSTHROUGH.has(action.permission))
      return [soft("default.network.tool", "NETWORK_EGRESS", "Network-capable tool.", attrs)]
    if (READONLY_PERMISSIONS.has(action.permission))
      return [allow("default.tool.readonly", "SAFE_READ", "Read-only tool.")]
    return [soft("default.tool.unclassified", "UNCLASSIFIED_ACTION", "Tool without a security classification.", attrs)]
  }

  /** `ctx` is part of the contract (sandbox state, agent) even though the first rule set is context-free. */
  export function evaluate(action: NormalizedAction, _ctx: SecurityContext): Out {
    if (action.kind === "shell") return shellRules(action.command)
    if (action.kind === "file") return fileRules(action)
    return permissionRules(action)
  }
}
