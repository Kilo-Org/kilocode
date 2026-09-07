import { createHash } from "crypto"
import { readFileSync, realpathSync, statSync } from "fs"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { Global } from "@opencode-ai/core/global"

/**
 * Trust boundary for executable project code.
 *
 * Everything else in Security Auto adjudicates *tool calls*. This module adjudicates something that
 * happens earlier and cannot be undone: the moment Kilo runs `import()` on a file it discovered. A
 * `.kilocode/tool/*.ts` file or a project-declared plugin executes its module scope at that instant —
 * before any tool exists to gate, before the sandbox, before the model has done anything. Merely
 * opening a session in a cloned repository is enough.
 *
 * The principle is `discovery != execution`: a candidate is found, resolved and classified from its
 * *path* and its declaring config's scope, and only then may it be imported.
 *
 * What is trusted, and why:
 * - `builtin` — Kilo's own code;
 * - `trusted-config` — a file inside the user's global config directory, or a dependency declared by
 *   the user's global config. This is user/admin configuration, a level above the project;
 * - `workspace` / `unknown` — repository-controlled or unattributable. Untrusted executable authority
 *   by default: it is imported only when the user has approved *that exact content*.
 *
 * Approval lives in the global config (`experimental.security_auto_code_trust`) and is keyed by the
 * SHA-256 of the file, never by its path alone: a path-only approval would let an attacker swap the
 * contents afterwards. Nothing about the source is stored — only the digest, and only by the user.
 *
 * A project config cannot grant this trust: the list is read from the global config exclusively, and
 * the module's own exports and metadata are never consulted, because reading them would require the
 * very import this boundary exists to prevent.
 */
export namespace CodeTrust {
  const log = Log.create({ service: "security" })

  /** Where a candidate executable file comes from, decided structurally from its path and scope. */
  export type Origin = "builtin" | "trusted-config" | "workspace" | "unknown"

  /** What kind of executable extension the candidate is; used for the audit line only. */
  export type Kind = "custom-tool" | "plugin"

  export interface Policy {
    /** Layer on? When off, every candidate loads exactly as it did before (legacy semantics). */
    enabled: boolean
    /** SHA-256 digests the user vouched for, from the global config. */
    approved: ReadonlySet<string>
  }

  export interface Decision {
    allow: boolean
    origin: Origin
    /** SHA-256 of the file, when it could be read. */
    digest?: string
    /** Stable reason id: `trusted-origin`, `approved-digest`, `untrusted-origin`, `unreadable`. */
    reason: string
  }

  /** Blocked candidates, for the audit surface and for tests. Never holds file contents. */
  export interface Blocked {
    kind: Kind
    file: string
    origin: Origin
    digest?: string
    at: number
  }

  const MAX_FILE = 8 * 1024 * 1024
  const MAX_BLOCKED = 128
  const blockedList: Blocked[] = []

  export function blocked(): readonly Blocked[] {
    return blockedList
  }

  export function resetBlocked() {
    blockedList.length = 0
  }

  /** Read the user's policy. Global config only — a repository must not be able to trust itself. */
  export function policy(global: unknown, enabled: boolean): Policy {
    const experimental = (global as { experimental?: Record<string, unknown> } | undefined)?.experimental
    const raw = experimental?.["security_auto_code_trust"]
    const approved = new Set<string>()
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === "string" && /^[0-9a-f]{64}$/i.test(item.trim())) approved.add(item.trim().toLowerCase())
      }
    }
    return { enabled, approved }
  }

  /** Resolve symlinks where possible: a config directory reached through a link is still that directory. */
  function canonical(value: string): string {
    try {
      return realpathSync(value)
    } catch {
      // The nearest existing ancestor is the best available answer for a path that does not exist yet.
      const parent = path.dirname(value)
      if (parent === value) return path.resolve(value)
      try {
        return path.join(realpathSync(parent), path.basename(value))
      } catch {
        return path.resolve(value)
      }
    }
  }

  function within(file: string, dir: string | undefined): boolean {
    if (!dir) return false
    const base = canonical(dir)
    const target = canonical(file)
    return target === base || target.startsWith(base + path.sep)
  }

  /**
   * Classify a candidate. `scope` is the scope of the config entry that declared it, when there is
   * one; it may only *lower* trust — a project config declaring a dependency that happens to resolve
   * into a global cache directory is still project-controlled.
   */
  export function classify(input: { file: string; scope?: "global" | "local" }): Origin {
    const file = input.file.startsWith("file://") ? fileFromUrl(input.file) : input.file
    if (input.scope === "local") return "workspace"
    if (within(file, Global.Path.config)) return "trusted-config"
    if (input.scope === "global") return "trusted-config"
    return "workspace"
  }

  export function fileFromUrl(value: string): string {
    try {
      return value.startsWith("file://") ? decodeURIComponent(new URL(value).pathname) : value
    } catch {
      return value
    }
  }

  /** SHA-256 of a file's bytes. `undefined` when it cannot be read, which is never treated as trust. */
  export function digest(file: string): string | undefined {
    try {
      const target = fileFromUrl(file)
      const stat = statSync(target)
      if (!stat.isFile() || stat.size > MAX_FILE) return undefined
      return createHash("sha256").update(readFileSync(target)).digest("hex")
    } catch {
      return undefined
    }
  }

  const LOCAL_IMPORT =
    /(?:^|[^\w$])(?:import|export)\s+(?:[^"';]*?\sfrom\s*)?["'](\.[^"']*)["']|import\(\s*["'](\.[^"']*)["']\s*\)/g
  const EXTENSIONS = ["", ".ts", ".js", ".mjs", ".cjs", ".tsx", "/index.ts", "/index.js"]
  const MAX_CLOSURE = 64

  /**
   * The local files an entrypoint statically pulls in, transitively. Only relative specifiers are
   * followed: a bare package specifier is a dependency of the runtime, not part of the extension's own
   * reviewed content.
   *
   * This is what makes approval mean "these files", not "this one file plus whatever it imports". A
   * specifier computed at runtime is not visible here — that case is covered by the permissioned
   * runtime instead, where the imported code executes inside the host rather than in Kilo's process.
   */
  export function closure(file: string): string[] {
    const start = canonical(fileFromUrl(file))
    const seen = new Set<string>([start])
    const queue = [start]
    while (queue.length > 0 && seen.size <= MAX_CLOSURE) {
      const current = queue.shift()!
      let text: string
      try {
        const stat = statSync(current)
        if (!stat.isFile() || stat.size > MAX_FILE) continue
        text = readFileSync(current, "utf8")
      } catch {
        continue
      }
      for (const match of text.matchAll(LOCAL_IMPORT)) {
        const specifier = match[1] ?? match[2]
        if (!specifier) continue
        const base = path.resolve(path.dirname(current), specifier)
        for (const suffix of EXTENSIONS) {
          const candidate = canonical(base + suffix)
          try {
            if (!statSync(candidate).isFile()) continue
          } catch {
            continue
          }
          if (!seen.has(candidate)) {
            seen.add(candidate)
            queue.push(candidate)
          }
          break
        }
      }
    }
    return [...seen].sort()
  }

  /**
   * The digest an approval is keyed by. For a single-file extension it is that file's digest, so a
   * plain-file approval keeps working. For an extension that imports its own local modules it is a
   * digest over the whole closure, so editing an imported sibling revokes the entrypoint's approval
   * too.
   */
  export function closureDigest(file: string): string | undefined {
    const files = closure(file)
    if (files.length <= 1) return digest(file)
    const hash = createHash("sha256")
    for (const item of files) {
      const found = digest(item)
      if (found === undefined) return undefined
      hash.update(path.basename(item)).update("\0").update(found).update("\n")
    }
    return hash.digest("hex")
  }

  /**
   * Decide whether a discovered file may be imported. Pure with respect to the filesystem apart from
   * reading the candidate itself.
   */
  export function evaluate(input: { file: string; scope?: "global" | "local"; policy: Policy }): Decision {
    const origin = classify(input)
    if (!input.policy.enabled) return { allow: true, origin, reason: "layer-off" }
    if (origin === "builtin" || origin === "trusted-config") return { allow: true, origin, reason: "trusted-origin" }
    const found = closureDigest(input.file)
    if (found === undefined) return { allow: false, origin, reason: "unreadable" }
    if (input.policy.approved.has(found)) return { allow: true, origin, digest: found, reason: "approved-digest" }
    return { allow: false, origin, digest: found, reason: "untrusted-origin" }
  }

  /**
   * The call the loaders make immediately before `import()`. Returns true when the module may be
   * evaluated.
   *
   * The digest is verified a second time right before the answer is given, so a file swapped between
   * the approval check and the import is caught. The window between that final check and the
   * runtime's own read of the file is not closed — dynamic import takes a path, not bytes — and is
   * documented as a residual rather than claimed away.
   */
  export function guard(input: { file: string; kind: Kind; scope?: "global" | "local"; policy: Policy }): Decision {
    const decision = evaluate(input)
    if (decision.allow && decision.digest !== undefined) {
      // TOCTOU re-check: the approval was matched against a digest read a moment ago.
      const again = closureDigest(input.file)
      if (again !== decision.digest) {
        record(input.kind, input.file, decision.origin, again)
        return { allow: false, origin: decision.origin, digest: again, reason: "content-changed" }
      }
    }
    if (!decision.allow) {
      record(input.kind, input.file, decision.origin, decision.digest)
      log.info("executable code blocked", {
        kind: input.kind,
        origin: decision.origin,
        reason: decision.reason,
        file: path.basename(fileFromUrl(input.file)),
        ...(decision.digest ? { digest: decision.digest } : {}),
      })
    }
    return decision
  }

  function record(kind: Kind, file: string, origin: Origin, found: string | undefined) {
    blockedList.push({ kind, file: fileFromUrl(file), origin, ...(found ? { digest: found } : {}), at: Date.now() })
    if (blockedList.length > MAX_BLOCKED) blockedList.splice(0, blockedList.length - MAX_BLOCKED)
  }

  /**
   * The line a human needs in order to approve a blocked candidate. Deliberately explicit: approval is
   * a user action in user-owned configuration, not something the agent or the repository can perform.
   */
  export function approvalHint(item: Blocked): string {
    return item.digest
      ? `Add "${item.digest}" to experimental.security_auto_code_trust in your global Kilo config to allow ${item.file}.`
      : `${item.file} could not be read for fingerprinting; it will not be loaded.`
  }
}
