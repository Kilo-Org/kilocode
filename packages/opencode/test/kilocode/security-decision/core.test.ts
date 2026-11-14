import { test, expect, describe } from "bun:test"
import { SecurityDecision } from "../../../src/kilocode/security-decision/core"
import type { SecurityDecisionTypes } from "../../../src/kilocode/security-decision/types"

const containment: SecurityDecisionTypes.Containment = {
  sandbox: "off",
  network: "allow",
  destinations: [],
  escalated: false,
  widened: false,
}

function input(patch: {
  action: SecurityDecisionTypes.Input["action"]
  baseline?: Partial<SecurityDecisionTypes.Input["baseline"]>
  metadata?: Partial<SecurityDecisionTypes.Input["metadata"]>
  containment?: Partial<SecurityDecisionTypes.Containment>
}): SecurityDecisionTypes.Input {
  return {
    version: 1,
    action: patch.action,
    baseline: { decision: "ask", authority: "untrusted", humanOnly: false, ...patch.baseline },
    metadata: { complete: true, truncated: false, ...patch.metadata },
    containment: { ...containment, ...patch.containment },
  }
}

function path(patch: Partial<SecurityDecisionTypes.PathFact> & { path: string }): SecurityDecisionTypes.PathFact {
  return { path: patch.path, inWorkspace: patch.inWorkspace ?? true, class: patch.class ?? "ordinary" }
}

describe("SecurityDecision.decide", () => {
  test("returns the no-opinion rule id when it has no opinion", () => {
    const out = SecurityDecision.decide(
      input({ action: { kind: "read", operation: "read", paths: [path({ path: "src/a.ts" })] } }),
    )
    expect(out.decision).toBe("pass")
    expect(out.rule_id).toBe("SEC.V1.NO_OPINION")
    expect(out.reason).toBe("SEC.V1.NO_OPINION")
  })

  test("denies a write to a git hook", () => {
    const out = SecurityDecision.decide(
      input({
        action: {
          kind: "edit",
          operation: "update",
          paths: [path({ path: ".git/hooks/pre-commit", class: "git_hook" })],
        },
      }),
    )
    expect(out.decision).toBe("deny")
    expect(out.rule_id).toBe("SEC.V1.GIT_HOOK_WRITE")
  })

  test("asks instead of denying when the git hook target is not exact", () => {
    const out = SecurityDecision.decide(
      input({
        action: {
          kind: "edit",
          operation: "unknown",
          paths: [path({ path: ".git/hooks/pre-commit", class: "git_hook" })],
        },
      }),
    )
    expect(out.decision).toBe("ask")
    expect(out.rule_id).toBe("SEC.V1.AMBIGUOUS_OPERATION")
  })

  test("denies an exact destructive root delete", () => {
    const out = SecurityDecision.decide(
      input({
        action: {
          kind: "bash",
          operation: "delete",
          paths: [path({ path: "/", inWorkspace: false, class: "root" })],
          exec: { complete: true, composed: false, executable: "rm", class: "known" },
        },
      }),
    )
    expect(out.decision).toBe("deny")
    expect(out.rule_id).toBe("SEC.V1.DESTRUCTIVE_ROOT")
  })

  test("asks rather than denying a destructive root delete parsed incompletely", () => {
    const out = SecurityDecision.decide(
      input({
        action: {
          kind: "bash",
          operation: "delete",
          paths: [path({ path: "/", inWorkspace: false, class: "root" })],
          exec: { complete: false, composed: false, executable: "rm", class: "known" },
        },
      }),
    )
    expect(out.decision).toBe("ask")
    expect(out.rule_id).toBe("SEC.V1.EXEC_INCOMPLETE")
  })

  test("asks for a delete of an ordinary workspace file", () => {
    const out = SecurityDecision.decide(
      input({ action: { kind: "edit", operation: "delete", paths: [path({ path: "docs/old.md" })] } }),
    )
    expect(out.decision).toBe("ask")
    expect(out.rule_id).toBe("SEC.V1.DESTRUCTIVE_FS")
  })

  test("asks for a sensitive path read", () => {
    const out = SecurityDecision.decide(
      input({ action: { kind: "read", operation: "read", paths: [path({ path: ".env", class: "sensitive" })] } }),
    )
    expect(out.decision).toBe("ask")
    expect(out.rule_id).toBe("SEC.V1.SENSITIVE_BOUNDARY")
  })

  test("asks for a CI config edit", () => {
    const out = SecurityDecision.decide(
      input({
        action: { kind: "edit", operation: "update", paths: [path({ path: ".github/workflows/ci.yml", class: "ci" })] },
      }),
    )
    expect(out.decision).toBe("ask")
    expect(out.rule_id).toBe("SEC.V1.CI_AUTHORITY")
  })

  test("asks for an opaque delegated MCP action", () => {
    const out = SecurityDecision.decide(
      input({ action: { kind: "mcp", operation: "invoke", paths: [] }, metadata: { complete: false } }),
    )
    expect(out.decision).toBe("ask")
    expect(out.rule_id).toBe("SEC.V1.DELEGATED_OPAQUE")
  })

  test("asks when metadata is incomplete or truncated", () => {
    const incomplete = SecurityDecision.decide(
      input({
        action: { kind: "edit", operation: "update", paths: [path({ path: "src/a.ts" })] },
        metadata: { complete: false },
      }),
    )
    expect(incomplete.decision).toBe("ask")
    expect(incomplete.rule_id).toBe("SEC.V1.METADATA_INCOMPLETE")
    const truncated = SecurityDecision.decide(
      input({
        action: { kind: "edit", operation: "update", paths: [path({ path: "src/a.ts" })] },
        metadata: { truncated: true },
      }),
    )
    expect(truncated.decision).toBe("ask")
    expect(truncated.rule_id).toBe("SEC.V1.METADATA_INCOMPLETE")
  })

  test("one unknown target holds a multi-target result at ask", () => {
    const out = SecurityDecision.decide(
      input({
        action: {
          kind: "edit",
          operation: "update",
          paths: [path({ path: "src/a.ts" }), path({ path: "unknown", class: "unknown" })],
        },
      }),
    )
    expect(out.decision).toBe("ask")
  })

  test("never denies when the baseline is human-only", () => {
    const out = SecurityDecision.decide(
      input({
        action: {
          kind: "edit",
          operation: "update",
          paths: [path({ path: ".git/hooks/pre-commit", class: "git_hook" })],
        },
        baseline: { humanOnly: true },
      }),
    )
    expect(out.decision).toBe("ask")
  })

  test("never denies when the baseline authority is the xdg global floor", () => {
    const out = SecurityDecision.decide(
      input({
        action: {
          kind: "edit",
          operation: "update",
          paths: [path({ path: ".git/hooks/pre-commit", class: "git_hook" })],
        },
        baseline: { authority: "xdg_global" },
      }),
    )
    expect(out.decision).toBe("ask")
  })

  test("marks an ask reviewable only when it is a soft ambiguity", () => {
    const ambiguous = SecurityDecision.decide(
      input({ action: { kind: "edit", operation: "delete", paths: [path({ path: "docs/old.md" })] } }),
    )
    expect(ambiguous.reviewable).toBe(true)
    const sensitive = SecurityDecision.decide(
      input({ action: { kind: "read", operation: "read", paths: [path({ path: ".env", class: "sensitive" })] } }),
    )
    expect(sensitive.reviewable).toBe(false)
  })

  test("reasons never echo a command or a path", () => {
    const out = SecurityDecision.decide(
      input({
        action: {
          kind: "bash",
          operation: "delete",
          paths: [path({ path: "/Users/secret/thing", inWorkspace: false, class: "root" })],
          exec: { complete: true, composed: false, executable: "rm", class: "known" },
        },
      }),
    )
    expect(out.reason).not.toContain("/Users/secret")
    expect(out.reason).not.toContain("rm")
    expect(out.reason).toMatch(/^SEC\.V1\./)
  })
})

/**
 * Operational confinement is useful audit evidence, but the current sandbox is not a complete
 * capability boundary: reads remain ambient and built-in Kilo roots remain writable. It therefore
 * cannot settle an unclassified command without a human.
 */
describe("containment as evidence for an unclassified command", () => {
  const exec: SecurityDecisionTypes.ExecFact = {
    complete: true,
    composed: false,
    executable: "npm",
    argv: ["npm", "test"],
    classified: false,
    class: "known",
  }

  const action = (paths: SecurityDecisionTypes.PathFact[] = []): SecurityDecisionTypes.Input["action"] => ({
    kind: "bash",
    operation: "exec",
    paths,
    exec,
  })

  const contained = {
    sandbox: "operational",
    network: "deny",
    destinations: [],
    escalated: false,
    widened: false,
  } as const

  test("keeps a contained unclassified command at an ask, reviewable per invocation", () => {
    const out = SecurityDecision.decide(input({ action: action(), containment: contained }))
    expect(out.decision).toBe("ask")
    expect(out.rule_id).toBe("SEC.V1.CONTAINED_EXEC")
    expect(out.requirements).toEqual(["sandbox", "restricted_network"])
    // `npm test` names no program the scan cannot see, so this one invocation earns eligibility.
    // The class does not: a carrier stays non-reviewable — see reviewer-eligibility.test.ts.
    expect(out.reviewable).toBe(true)
  })

  test("a contained command that carries another program is never reviewable", () => {
    const out = SecurityDecision.decide(
      input({
        action: {
          ...action(),
          exec: { ...exec, executable: "sh", argv: ["sh", "-c", "cat .env"] },
        },
        containment: contained,
      }),
    )
    expect(out.rule_id).toBe("SEC.V1.CONTAINED_EXEC")
    expect(out.reviewable).toBe(false)
  })

  test.each([["off"], ["unknown"], ["unavailable"], ["failed"]] as const)(
    "keeps the ask when the sandbox is %s",
    (sandbox) => {
      const out = SecurityDecision.decide(input({ action: action(), containment: { ...contained, sandbox } }))
      expect(out.rule_id).toBe("SEC.V1.UNCLASSIFIED_EXEC")
      expect(out.decision).toBe("ask")
    },
  )

  test("keeps the ask when the sandbox is operational but the network is open", () => {
    const out = SecurityDecision.decide(input({ action: action(), containment: { ...contained, network: "allow" } }))
    expect(out.rule_id).toBe("SEC.V1.UNCLASSIFIED_EXEC")
  })

  test("keeps an exactly bounded proxy at a non-reviewable contained ask", () => {
    const bounded = SecurityDecision.decide(
      input({
        action: action(),
        containment: { ...contained, network: "proxy", destinations: ["registry.npmjs.org"] },
      }),
    )
    expect(bounded.rule_id).toBe("SEC.V1.CONTAINED_EXEC")
    expect(bounded.decision).toBe("ask")
    const unbounded = SecurityDecision.decide(
      input({ action: action(), containment: { ...contained, network: "proxy" } }),
    )
    expect(unbounded.rule_id).toBe("SEC.V1.UNCLASSIFIED_EXEC")
  })

  test("keeps the ask when the profile grants write beyond its built-in roots", () => {
    const out = SecurityDecision.decide(input({ action: action(), containment: { ...contained, widened: true } }))
    expect(out.rule_id).toBe("SEC.V1.UNCLASSIFIED_EXEC")
    expect(out.decision).toBe("ask")
  })

  test("keeps the ask when the call escalated out of the sandbox", () => {
    const out = SecurityDecision.decide(input({ action: action(), containment: { ...contained, escalated: true } }))
    expect(out.rule_id).toBe("SEC.V1.UNCLASSIFIED_EXEC")
  })

  test("keeps the ask when a target left the workspace or could not be named", () => {
    const outside = SecurityDecision.decide(
      input({
        action: action([path({ path: "/etc/hosts", inWorkspace: false })]),
        containment: contained,
      }),
    )
    expect(outside.rule_id).toBe("SEC.V1.SENSITIVE_BOUNDARY")
    const unnamed = SecurityDecision.decide(
      input({ action: action([path({ path: "", class: "unknown" })]), containment: contained }),
    )
    expect(unnamed.rule_id).toBe("SEC.V1.UNKNOWN_TARGET")
  })

  test("never overrides a deterministic path rule", () => {
    const hook = SecurityDecision.decide(
      input({
        action: {
          ...action([path({ path: ".git/hooks/pre-commit", class: "git_hook" })]),
          operation: "update",
        },
        containment: contained,
      }),
    )
    expect(hook.rule_id).toBe("SEC.V1.GIT_HOOK_WRITE")
    expect(hook.decision).toBe("deny")
  })

  test("never overrides the dependency boundary", () => {
    const out = SecurityDecision.decide(
      input({
        action: {
          ...action(),
          exec: { ...exec, argv: ["npm", "install", "lodash"] },
        },
        containment: contained,
      }),
    )
    expect(out.rule_id).toBe("SEC.V1.DEPENDENCY_INSTALL")
  })

  test("never narrows a human-only ask", () => {
    const out = SecurityDecision.decide(
      input({ action: action(), containment: contained, baseline: { humanOnly: true } }),
    )
    expect(out.rule_id).toBe("SEC.V1.UNCLASSIFIED_EXEC")
    expect(out.decision).toBe("ask")
  })

  test("never pierces an authority floor the layer did not raise itself", () => {
    for (const authority of ["xdg_global", "hard", "unknown"] as const) {
      const out = SecurityDecision.decide(input({ action: action(), containment: contained, baseline: { authority } }))
      expect({ authority, rule: out.rule_id }).toEqual({ authority, rule: "SEC.V1.UNCLASSIFIED_EXEC" })
    }
  })

  test("an incomplete or composed parse is never contained evidence", () => {
    const incomplete = SecurityDecision.decide(
      input({ action: { ...action(), exec: { ...exec, complete: false } }, containment: contained }),
    )
    expect(incomplete.rule_id).toBe("SEC.V1.EXEC_INCOMPLETE")
    const composed = SecurityDecision.decide(
      input({ action: { ...action(), exec: { ...exec, composed: true } }, containment: contained }),
    )
    expect(composed.rule_id).toBe("SEC.V1.EXEC_COMPOSED")
  })
})
