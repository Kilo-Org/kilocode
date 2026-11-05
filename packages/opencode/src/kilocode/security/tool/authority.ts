import path from "path"
import { evidence as makeEvidence } from "../decision"
import { PathRisk } from "../path"
import { SecurityRules } from "../rules"
import { SecretContent } from "../state/content"
import { SecuritySessionState } from "../state/store"
import { SecretValues } from "../state/values"
import { ToolCapability } from "./capability"
import type { FileEffect, SecurityContext, SecurityEvidence, ToolInvocation } from "../types"

/**
 * Delegated-authority evaluation for tool calls.
 *
 * The layer answers one question the engine could not answer before: *may this tool run at all,
 * given who wrote it and what it is allowed to do*. It produces structured evidence for the same
 * monotonic reducer as every other layer, so it can only tighten a decision.
 *
 * What it enforces:
 * - a tool whose authority nothing vouches for (unclassified custom tool, unclassified MCP tool,
 *   a built-in absent from the capability table) is never a silent ALLOW: the floor is a hard ASK;
 * - what the tool *says about itself* — an MCP annotation, a plugin's own metadata — may tighten a
 *   decision and never relax one, so lying about being read-only cannot help an attacker;
 * - the arguments of an unvetted tool are classified with the same path policy as a shell command,
 *   so "custom tool writes to ~/.ssh" or "MCP tool rewrites the Kilo config" is refused for the same
 *   reason the shell equivalent is;
 * - composition with the session's secret state: an outbound or unvetted tool call made
 *   while the session holds credential material needs a human, and a call that literally carries a
 *   value read from a credential this session is refused.
 *
 * What it deliberately does not do: read the tool's natural-language description, classify tools by
 * name, or block MCP as a category. An ordinary read-only MCP call with no secret context produces
 * no evidence at all and keeps the pre-existing low-friction path.
 */
export namespace ToolAuthority {
  export interface Input {
    invocation: ToolInvocation
    ctx: SecurityContext
    env: PathRisk.Env
    sessionID: string
    /** Bounded reader used to classify content an outbound tool would send. */
    readFile?: (canonical: string) => string | undefined
  }

  export interface Assessment {
    evidence: SecurityEvidence[]
    pending: SecuritySessionState.Pending
  }

  const EMPTY: SecuritySessionState.Pending = { reads: [], taints: [], untaints: [] }

  /** Bounds on argument inspection: an argument tree is untrusted input, not a data structure. */
  const MAX_STRINGS = 256
  const MAX_DEPTH = 6
  const MAX_LENGTH = 8192

  const URL = /^(?:https?|ftp|ws|wss):\/\//i

  /** Collect the string leaves of a tool call's arguments, bounded in both breadth and depth. */
  export function strings(value: unknown, depth = 0, out: string[] = []): string[] {
    if (out.length >= MAX_STRINGS || depth > MAX_DEPTH) return out
    if (typeof value === "string") {
      if (value.length > 0) out.push(value.length > MAX_LENGTH ? value.slice(0, MAX_LENGTH) : value)
      return out
    }
    if (Array.isArray(value)) {
      for (const item of value) strings(item, depth + 1, out)
      return out
    }
    if (typeof value === "object" && value !== null) {
      for (const item of Object.values(value as Record<string, unknown>)) strings(item, depth + 1, out)
    }
    return out
  }

  /**
   * Does this argument name a filesystem location, and which one? Deliberately narrow: an absolute
   * path, a `~` path, an explicit relative path, a path-shaped token with a separator and no
   * whitespace, or a `file://` URI (which is a path wearing a URL's clothes — excluding it would let
   * `file:///home/u/.ssh/id_rsa` slip past the same rules that stop the bare path). Prose and remote
   * URLs are not paths, so an ordinary text argument is never classified as one.
   *
   * One separator-less shape still has to be a path: a sensitive Kilo configuration name written the
   * way a tool that takes a filename actually takes it. `kilo.json` and `./kilo.json` are the same
   * file, so recognising only the second let a tool reach the project configuration through the
   * weaker spelling. The exception is exactly the classifier's own list of project-configuration
   * names — no wider heuristic — so `eslint` or `typescript` stays prose.
   */
  export function asPath(value: string): string | undefined {
    if (value.length === 0 || value.length > 4096) return undefined
    if (/[\r\n\t]/.test(value)) return undefined
    if (/^file:\/\//i.test(value)) {
      try {
        return decodeURIComponent(new globalThis.URL(value).pathname) || undefined
      } catch {
        return undefined
      }
    }
    if (value.includes("://")) return undefined
    if (/^(?:\/|~[\\/]|\.{1,2}[\\/]|[A-Za-z]:[\\/])/.test(value)) return value
    if (/\s/.test(value)) return undefined
    if (/[\\/]/.test(value)) return value
    return PathRisk.projectConfig(value) ? value : undefined
  }

  /** Convenience predicate over {@link asPath}. */
  export function pathLike(value: string): boolean {
    return asPath(value) !== undefined
  }

  function urlLike(value: string): boolean {
    return URL.test(value)
  }

  function resolve(value: string, cwd: string): string | undefined {
    const found = asPath(value)
    if (found === undefined) return undefined
    return path.isAbsolute(found) || found.startsWith("~") ? found : path.resolve(cwd, found)
  }

  /** The filesystem effect an unvetted tool would have, from its declared capabilities. */
  function effectOf(capabilities: readonly string[]): FileEffect {
    if (capabilities.includes("filesystem-write") || capabilities.includes("process")) return "write"
    if (capabilities.includes("filesystem-read")) return "read"
    return "unknown"
  }

  function hard(
    rule: string,
    action: "ask" | "deny",
    reasonCode: SecurityEvidence["reasonCode"],
    message: string,
    attributes?: SecurityEvidence["attributes"],
  ) {
    return makeEvidence({ rule, source: "hard", action, reasonCode, message, ...(attributes ? { attributes } : {}) })
  }

  function soft(
    rule: string,
    reasonCode: SecurityEvidence["reasonCode"],
    message: string,
    attributes?: SecurityEvidence["attributes"],
  ) {
    return makeEvidence({
      rule,
      source: "default",
      action: "ask",
      reasonCode,
      message,
      ...(attributes ? { attributes } : {}),
    })
  }

  /**
   * Assess one tool call. Pure with respect to session state: it reads the state and returns what
   * the call *would* taint, never mutating anything itself.
   */
  export function assess(input: Input): Assessment {
    const descriptor = input.invocation.descriptor
    const capabilities = descriptor.capabilities
    const internal = descriptor.provenance === "builtin"
    const delegated = descriptor.provenance === "mcp-remote" || descriptor.provenance === "mcp-local"
    const evidence: SecurityEvidence[] = []
    const taints: SecuritySessionState.Pending["taints"] = []

    const identity = {
      tool: descriptor.tool,
      provenance: descriptor.provenance,
      ...(descriptor.mcp ? { server: descriptor.mcp.server, operation: descriptor.mcp.tool } : {}),
    }

    // 1. Authority. Nothing vouching for the tool is the whole point of the conservative floor: it
    //    applies to an unclassified custom tool, an unclassified MCP tool, and equally to a built-in
    //    that was added without being classified — which is what keeps the coverage invariant honest.
    if (ToolCapability.unknown(capabilities)) {
      evidence.push(
        hard(
          delegated
            ? "hard.tool.mcp-unknown-authority"
            : internal
              ? "hard.tool.unclassified"
              : "hard.tool.unknown-authority",
          "ask",
          "DELEGATED_AUTHORITY",
          delegated
            ? `The MCP server "${descriptor.mcp?.server ?? "unknown"}" offers "${descriptor.mcp?.tool ?? descriptor.tool}" with authority this policy cannot establish.`
            : internal
              ? "The tool has no security classification."
              : "The tool comes from outside Kilo and its authority cannot be established.",
          identity,
        ),
      )
    }

    // 1b. Some authority cannot be delegated by a declaration. Declaring a tool read-only or
    //     network-capable describes a bounded effect the policy can still reason about; declaring that
    //     it runs processes or edits security state hands it the exact authority this engine exists to
    //     adjudicate, and the engine cannot see the command it will run. The declaration keeps the tool
    //     usable — it just cannot make it unattended.
    if (!internal && (capabilities.includes("process") || capabilities.includes("security-control"))) {
      evidence.push(
        hard(
          "hard.tool.delegated-execution",
          "ask",
          "DELEGATED_AUTHORITY",
          "The tool runs code or changes security state on Kilo's behalf, and the policy cannot inspect what it will do.",
          identity,
        ),
      )
    }

    // 2. Self-declared hints. The source is lower trust than the policy, so a hint may only tighten:
    //    a server claiming "read only" changes nothing, a server admitting "destructive" adds a reason.
    if (!internal && descriptor.hints?.destructive === true) {
      evidence.push(
        hard(
          "hard.tool.declared-destructive",
          "ask",
          "DELEGATED_AUTHORITY",
          "The tool declares that it makes destructive changes.",
          identity,
        ),
      )
    }

    // 3. Arguments of an unvetted tool are classified with the same path policy as a shell command.
    //    Built-in tools are excluded: their own asks already carry the real target to the engine.
    const values = strings(input.invocation.args)
    if (!internal) {
      const effect = effectOf(capabilities)
      const seen = new Set<string>()
      for (const value of values) {
        const absolute = resolve(value, input.ctx.cwd)
        if (absolute === undefined) continue
        if (seen.has(absolute)) continue
        seen.add(absolute)
        const target = PathRisk.classify(absolute, input.ctx.cwd, input.env)
        // A workspace-relative target of an unknown tool is ordinary work; only the risky relations
        // produce evidence, exactly as they would for a command touching the same path.
        evidence.push(...SecurityRules.pathRules(target, effect, { recursive: false, executable: descriptor.tool }))
      }
      if (values.some(urlLike)) {
        evidence.push(
          soft("default.tool.network-argument", "NETWORK_EGRESS", "The call carries an outbound URL.", identity),
        )
      }
    }

    // 4. Composition with the session's secret state, for tool calls rather than shells.
    const outbound =
      ToolCapability.outbound(capabilities) || (!internal && (delegated || ToolCapability.unknown(capabilities)))
    const carries = SecuritySessionState.matches(input.sessionID, [
      ...new Set(values.flatMap((value) => SecretValues.tokens(value))),
    ])
    // A path argument naming a file that received credential material earlier in this session is the
    // same deterministic data link the shell layer refuses, reached through a tool instead of a pipe.
    const tainted =
      outbound &&
      values.some((value) => {
        const absolute = resolve(value, input.ctx.cwd)
        if (absolute === undefined) return false
        const target = PathRisk.classify(absolute, input.ctx.cwd, input.env)
        return SecuritySessionState.taintOf(input.sessionID, target.canonical) !== undefined
      })
    // An outbound tool asked to send a file whose contents are credential material. The path says
    // nothing and the agent never read it, so only the content itself can establish this.
    const secretContent =
      outbound && input.readFile !== undefined
        ? values.some((value) => {
            const absolute = resolve(value, input.ctx.cwd)
            if (absolute === undefined) return false
            const target = PathRisk.classify(absolute, input.ctx.cwd, input.env)
            if (target.relation === "unknown") return false
            const text = input.readFile!(target.canonical)
            return text !== undefined && SecretContent.sensitive(text, { file: target.canonical })
          })
        : false
    if (secretContent) {
      evidence.push(
        hard(
          "hard.tool.secret-content",
          "deny",
          "SECRET_EXFILTRATION",
          "The call would send a file whose contents are credential material.",
          identity,
        ),
      )
      SecuritySessionState.note(input.sessionID, {
        at: Date.now(),
        kind: "egress-denied",
        rule: "hard.tool.secret-content",
      })
    }
    if (tainted) {
      evidence.push(
        hard(
          "hard.tool.tainted-file",
          "deny",
          "SECRET_EXFILTRATION",
          "The call would send a file that received credential material earlier in this session.",
          identity,
        ),
      )
      SecuritySessionState.note(input.sessionID, {
        at: Date.now(),
        kind: "egress-denied",
        rule: "hard.tool.tainted-file",
      })
    }
    if (carries && outbound) {
      evidence.push(
        hard(
          "hard.tool.secret-argument",
          "deny",
          "SECRET_EXFILTRATION",
          "The call carries a credential value read earlier in this session to a tool that can send it out.",
          identity,
        ),
      )
      SecuritySessionState.note(input.sessionID, {
        at: Date.now(),
        kind: "egress-denied",
        rule: "hard.tool.secret-argument",
      })
    } else if (outbound && SecuritySessionState.hasSecretContext(input.sessionID)) {
      evidence.push(
        hard(
          "hard.tool.secret-context",
          "ask",
          "SECRET_EXFILTRATION",
          "Credential material was read earlier in this session; letting this tool act needs confirmation.",
          identity,
        ),
      )
      SecuritySessionState.note(input.sessionID, {
        at: Date.now(),
        kind: "egress-asked",
        rule: "hard.tool.secret-context",
      })
    }

    // 5. Controlled propagation through a built-in writer: a file tool that writes a value read from
    //    a credential this session makes its target carry that material, so a later upload is caught.
    //    This mirrors the shell copy/redirect propagation and is not a general taint engine.
    if (carries && internal && capabilities.includes("filesystem-write")) {
      for (const value of values) {
        const absolute = resolve(value, input.ctx.cwd)
        if (absolute === undefined) continue
        const target = PathRisk.classify(absolute, input.ctx.cwd, input.env)
        if (target.relation === "unknown") continue
        taints.push({ canonical: target.canonical, labels: ["secret"], via: "write-content" })
      }
    }

    return { evidence, pending: taints.length > 0 ? { reads: [], taints, untaints: [] } : EMPTY }
  }
}
