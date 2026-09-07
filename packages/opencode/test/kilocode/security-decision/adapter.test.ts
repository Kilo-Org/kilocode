import { test, expect, describe } from "bun:test"
import { SecurityDecisionAdapter } from "../../../src/kilocode/security-decision/adapter"

const containment = { sandbox: "off", network: "allow", destinations: [], escalated: false } as const

function evaluate(
  request: {
    source?: "builtin" | "mcp"
    permission: string
    patterns: readonly string[]
    metadata?: Record<string, unknown>
    sessionID?: string
    callID?: string
  },
  ctx: Partial<Parameters<typeof SecurityDecisionAdapter.evaluate>[1]> = {},
) {
  return SecurityDecisionAdapter.evaluate(
    { sessionID: "ses_1", callID: "call_1", ...request },
    {
      workspace: "/repo",
      effective: "allow",
      humanOnly: false,
      floor: { action: "allow", authority: "untrusted", conflict: false },
      containment,
      ...ctx,
    },
  )
}

describe("SecurityDecisionAdapter.enabled", () => {
  test("is off unless the server environment turns it on", () => {
    expect(SecurityDecisionAdapter.enabled({})).toBe(false)
    expect(SecurityDecisionAdapter.enabled({ KILO_SECURITY_DECISION: "0" })).toBe(false)
    expect(SecurityDecisionAdapter.enabled({ KILO_SECURITY_DECISION: "1" })).toBe(true)
    expect(SecurityDecisionAdapter.enabled({ KILO_SECURITY_DECISION: "true" })).toBe(true)
  })
})

describe("SecurityDecisionAdapter.evaluate", () => {
  test("denies an edit that writes a git hook", () => {
    const out = evaluate({ permission: "edit", patterns: [".git/hooks/pre-commit"], metadata: { filepath: "x" } })
    expect(out.decision).toBe("deny")
    expect(out.rule_id).toBe("SEC.V1.GIT_HOOK_WRITE")
  })

  test("asks for an edit of a CI workflow", () => {
    const out = evaluate({ permission: "edit", patterns: [".github/workflows/ci.yml"], metadata: { filepath: "x" } })
    expect(out.rule_id).toBe("SEC.V1.CI_AUTHORITY")
  })

  test("has no opinion on an ordinary workspace edit", () => {
    const out = evaluate({ permission: "edit", patterns: ["src/a.ts"], metadata: { filepath: "x" } })
    expect(out.decision).toBe("pass")
  })

  test("asks for a path outside the workspace", () => {
    const out = evaluate({ permission: "external_directory", patterns: ["/etc/*"], metadata: { access: "read" } })
    expect(out.decision).toBe("ask")
    expect(out.rule_id).toBe("SEC.V1.SENSITIVE_BOUNDARY")
  })

  test("takes the delete operation from apply-patch file metadata", () => {
    const out = evaluate({
      permission: "edit",
      patterns: ["docs/old.md"],
      metadata: { filepath: "docs/old.md", files: [{ relativePath: "docs/old.md", type: "delete" }] },
    })
    expect(out.rule_id).toBe("SEC.V1.DESTRUCTIVE_FS")
  })

  test("uses explicit MCP provenance for an opaque delegated action", () => {
    const out = evaluate({ source: "mcp", permission: "mymcp_do_thing", patterns: ["*"], metadata: {} })
    expect(out.decision).toBe("ask")
    expect(out.rule_id).toBe("SEC.V1.DELEGATED_OPAQUE")
  })

  test("asks for a shell command whose parse facts are missing", () => {
    const out = evaluate({ permission: "bash", patterns: ["git status"], metadata: { command: "git status" } })
    expect(out.decision).toBe("ask")
    expect(out.rule_id).toBe("SEC.V1.METADATA_INCOMPLETE")
  })

  test("has no opinion on a shell command proven inert", () => {
    const out = evaluate({
      permission: "bash",
      patterns: ["git status"],
      metadata: {
        command: "git status",
        securityFacts: { complete: true, composed: false, executable: "git", argv: ["git", "status"] },
      },
    })
    expect(out.decision).toBe("pass")
  })

  test("fails closed when malformed argv tokens would be discarded", () => {
    const out = evaluate({
      permission: "bash",
      patterns: ["git status"],
      metadata: {
        securityFacts: {
          complete: true,
          composed: false,
          executable: "git",
          argv: ["git", "status", { hidden: "--upload-pack=evil" }],
        },
      },
    })

    expect(out).toMatchObject({
      decision: "ask",
      rule_id: "SEC.V1.METADATA_INCOMPLETE",
      reviewable: false,
      audit: { metadata_complete: true, metadata_truncated: true },
    })
    expect(out.review).toBeUndefined()
  })

  test("fails closed when a malformed executable would be discarded", () => {
    const out = evaluate({
      permission: "bash",
      patterns: ["git status"],
      metadata: {
        securityFacts: { complete: true, composed: false, executable: { hidden: "curl" }, argv: ["git", "status"] },
      },
    })

    expect(out).toMatchObject({
      decision: "ask",
      rule_id: "SEC.V1.METADATA_INCOMPLETE",
      reviewable: false,
      audit: { metadata_complete: true, metadata_truncated: true },
    })
    expect(out.review).toBeUndefined()
  })

  test("fails closed when malformed effects would be discarded", () => {
    const out = evaluate({
      permission: "bash",
      patterns: ["git status"],
      metadata: {
        securityFacts: {
          complete: true,
          composed: false,
          executable: "git",
          argv: ["git", "status"],
          effects: [
            { operation: "read", path: "README.md" },
            { operation: "erase", path: "/" },
          ],
        },
      },
    })

    expect(out).toMatchObject({
      decision: "ask",
      rule_id: "SEC.V1.METADATA_INCOMPLETE",
      reviewable: false,
      audit: { metadata_complete: true, metadata_truncated: true },
    })
    expect(out.review).toBeUndefined()
  })

  test("fails closed when a malformed effect path would be discarded", () => {
    const out = evaluate({
      permission: "bash",
      patterns: ["cat target"],
      metadata: {
        securityFacts: {
          complete: true,
          composed: false,
          executable: "cat",
          argv: ["cat", "target"],
          effects: [{ operation: "read", path: { hidden: "/etc/shadow" } }],
        },
      },
    })

    expect(out).toMatchObject({
      decision: "ask",
      rule_id: "SEC.V1.METADATA_INCOMPLETE",
      reviewable: false,
      audit: { metadata_complete: true, metadata_truncated: true },
    })
    expect(out.review).toBeUndefined()
  })

  // kilocode_change - 17 targets is an ordinary delete, not an oversized one. The refusal below is
  // now driven by the request budget, so the fixture is a request that genuinely cannot fit.
  test("an ordinary number of targets still reaches the reviewer", () => {
    const effects = Array.from({ length: 17 }, (_, i) => ({ operation: "delete", path: `/repo/file-${i}.txt` }))
    const out = evaluate({
      permission: "bash",
      patterns: ["rm files"],
      metadata: {
        securityFacts: {
          complete: true,
          composed: false,
          executable: "rm",
          argv: ["rm", "files"],
          classified: true,
          effects,
        },
      },
    })

    expect(out).toMatchObject({ decision: "ask", rule_id: "SEC.V1.DESTRUCTIVE_FS", reviewable: true })
    expect(out.review?.action.paths.length).toBe(17)
  })

  test("does not send a reviewable action when the action itself cannot fit the reviewer budget", () => {
    const out = evaluate({
      permission: "bash",
      patterns: ["rm huge"],
      metadata: {
        securityFacts: {
          complete: true,
          composed: false,
          executable: "rm",
          argv: ["rm", ...Array.from({ length: 400 }, (_, i) => `argument-${i}`.padEnd(200, "x"))],
          classified: true,
          effects: [{ operation: "delete", path: "/repo/docs/old.md" }],
        },
      },
    })

    expect(out).toMatchObject({
      decision: "ask",
      rule_id: "SEC.V1.METADATA_INCOMPLETE",
      reviewable: false,
      audit: { metadata_truncated: true },
    })
    expect(out.review).toBeUndefined()
  })

  // kilocode_change - 33 arguments is a file list, not an overflow; it now reaches the reviewer whole
  test("an ordinary argument count reaches the reviewer with every argument intact", () => {
    const argv = ["rm", ...Array.from({ length: 32 }, (_, i) => `arg-${i}`)]
    const out = evaluate({
      permission: "bash",
      patterns: ["rm lots-of-arguments"],
      metadata: {
        securityFacts: {
          complete: true,
          composed: false,
          executable: "rm",
          argv,
          classified: true,
          effects: [{ operation: "delete", path: "docs/old.md" }],
        },
      },
    })

    expect(out).toMatchObject({ decision: "ask", rule_id: "SEC.V1.DESTRUCTIVE_FS", reviewable: true })
    expect(out.review?.action.argv).toEqual(argv)
  })

  // kilocode_change - a clean parse is not proof of safety; an unclassified action is a reviewable ask
  test("asks for a fully parsed command whose effects it does not know", () => {
    const out = evaluate({
      permission: "bash",
      patterns: ["sed -i s/a/b/ f"],
      metadata: {
        command: "sed -i s/a/b/ f",
        securityFacts: { complete: true, composed: false, executable: "sed", argv: ["sed", "-i", "s/a/b/", "f"] },
      },
    })
    expect(out.decision).toBe("ask")
    expect(out.rule_id).toBe("SEC.V1.UNCLASSIFIED_EXEC")
  })

  test("asks for a composed shell command", () => {
    const out = evaluate({
      permission: "bash",
      patterns: ["a | b"],
      metadata: { command: "a | b", securityFacts: { complete: true, composed: true } },
    })
    expect(out.rule_id).toBe("SEC.V1.EXEC_COMPOSED")
  })

  test("carries the xdg floor into the decision so the core cannot deny under it", () => {
    const out = evaluate(
      { permission: "edit", patterns: [".git/hooks/pre-commit"], metadata: { filepath: "x" } },
      { floor: { action: "ask", authority: "xdg_global", conflict: true } },
    )
    expect(out.decision).toBe("ask")
    expect(out.audit.authority_level).toBe("xdg_global")
    expect(out.audit.authority_basis).toBe("xdg_scope")
    expect(out.audit.authority_conflict).toBe(true)
  })

  test("fails closed to ask when normalization throws", () => {
    const hostile = {
      permission: "edit",
      sessionID: "ses_1",
      callID: "call_1",
      metadata: {},
      get patterns(): readonly string[] {
        throw new Error("boom")
      },
    }
    const out = SecurityDecisionAdapter.evaluate(hostile, {
      workspace: "/repo",
      effective: "allow",
      humanOnly: false,
      floor: { action: "allow", authority: "untrusted", conflict: false },
      containment,
    })
    expect(out.decision).toBe("ask")
    expect(out.rule_id).toBe("SEC.V1.INTERNAL_ERROR")
  })

  test("writes an audit record with the mandatory fields and no echoed content", () => {
    const out = evaluate({
      permission: "bash",
      patterns: ["rm -rf /Users/secret/thing"],
      metadata: { command: "rm -rf /Users/secret/thing", securityFacts: { complete: true, composed: false } },
    })
    expect(out.audit.schema).toBe("kilo.security-decision/v1")
    expect(out.audit.policy_version).toBe("kilo.security-decision/v1")
    expect(out.audit.reviewer).toEqual({ state: "not_run" })
    expect(out.audit.metadata_complete).toBe(true)
    expect(out.audit.metadata_truncated).toBe(false)
    expect(out.audit.containment).toMatchObject(containment)
    expect(out.audit.sessionID).toBe("ses_1")
    expect(out.audit.callID).toBe("call_1")
    expect(typeof out.audit.latency_ms).toBe("number")
    expect(JSON.stringify(out.audit)).not.toContain("secret")
    expect(JSON.stringify(out.audit)).not.toContain("rm -rf")
  })

  test("finalize records the enforcement outcome onto the audit", () => {
    const out = evaluate({ permission: "edit", patterns: ["src/a.ts"], metadata: { filepath: "x" } })
    const final = SecurityDecisionAdapter.finalize(out.audit, "allow", "rule")
    expect(final.final_enforcement).toBe("allow")
    expect(final.enforcement_source).toBe("rule")
  })
})

describe("permission-specific normalization", () => {
  test.each([
    ["todowrite", ["*"], {}],
    ["board_read", ["*"], {}],
    ["board_post", ["*"], { to: "main", type: "INFO" }],
    ["skill", ["../../.env"], {}],
    ["task", ["explore"], { subagent_type: "explore" }],
    ["websearch", ["find .env examples"], { query: "find .env examples" }],
    ["webfetch", ["https://example.com/.env"], { url: "https://example.com/.env" }],
    ["browser_open", ["navigate:http://localhost:3000"], { url: "http://localhost:3000" }],
    ["agent_manager", ["overview"], { action: "list" }],
    ["workflow_tool_approval", ["read: .env"], { tools: [] }],
  ])("does not classify %s patterns as filesystem paths", (permission, patterns, metadata) => {
    const out = evaluate({ permission, patterns, metadata })

    expect(out.decision).toBe("pass")
    expect(out.rule_id).toBe("SEC.V1.NO_OPINION")
  })

  test("treats an MCP resource identifier carried by read as opaque rather than a local path", () => {
    const out = evaluate({
      permission: "read",
      patterns: ["mcp:docs:file:///remote/.env"],
      metadata: { server: "docs", uri: "file:///remote/.env" },
    })

    expect(out.decision).toBe("pass")
    expect(out.rule_id).toBe("SEC.V1.NO_OPINION")
  })

  test("classifies grep's real search path, not its regex", () => {
    const regex = evaluate({ permission: "grep", patterns: ["(^|/)\\.env$"], metadata: { pattern: "(^|/)\\.env$" } })
    const hidden = evaluate({
      permission: "grep",
      patterns: ["harmless"],
      metadata: { pattern: "harmless", path: "/repo/.env" },
    })

    expect(regex.rule_id).toBe("SEC.V1.NO_OPINION")
    expect(hidden.rule_id).toBe("SEC.V1.SENSITIVE_BOUNDARY")
    expect(hidden.decision).toBe("ask")
  })

  test("keeps glob syntax opaque while classifying its explicit search root", () => {
    const pattern = evaluate({ permission: "glob", patterns: ["**/.env"], metadata: { pattern: "**/.env" } })
    const outside = evaluate({
      permission: "glob",
      patterns: ["**/*.ts"],
      metadata: { pattern: "**/*.ts", path: "/outside" },
    })

    expect(pattern.rule_id).toBe("SEC.V1.NO_OPINION")
    expect(outside.rule_id).toBe("SEC.V1.SENSITIVE_BOUNDARY")
  })

  test.each([
    ["semantic_search", ["authentication flow"], { query: "authentication flow", path: "../.env" }],
    ["lsp", ["*"], { operation: "hover", filePath: "/repo/.env" }],
    ["notebook_read", ["display-name"], { path: "/repo/.env" }],
    ["notebook_edit", ["display-name"], { path: "/repo/.env" }],
    ["notebook_execute", ["display-name"], { path: "/repo/.env" }],
    ["repo_overview", ["owner/repo"], { repository: "owner/repo", path: "/outside/repo" }],
    ["repo_clone", ["owner/repo"], { repository: "owner/repo", path: "/outside/repo" }],
    ["recall", ["session"], { sessionID: "ses_other", directory: "/outside/repo" }],
  ])("uses the concrete metadata path for %s", (permission, patterns, metadata) => {
    const out = evaluate({ permission, patterns, metadata })

    expect(out.decision).toBe("ask")
    expect(out.rule_id).toBe("SEC.V1.SENSITIVE_BOUNDARY")
  })

  test("fails closed when resolved filesystem identities are not index-aligned with paths", () => {
    const out = evaluate({
      permission: "edit",
      patterns: ["src/a.ts", "src/b.ts"],
      metadata: { securityPaths: ["/repo/src/a.ts"] },
    })

    expect(out).toMatchObject({
      decision: "ask",
      rule_id: "SEC.V1.METADATA_INCOMPLETE",
      reviewable: false,
      audit: { metadata_truncated: true },
    })
  })
})

/**
 * High-confidence credential files, and the two directories that hold git hooks under their modern
 * names. Both are extensions of tables that already exist: nothing here weakens a rule, and the cost
 * of a false positive is one ask on a file ordinary work rarely touches.
 */
describe("credential files and hook directories", () => {
  const decide = (permission: string, file: string) =>
    evaluate({ permission, patterns: [`/repo/${file}`], metadata: {} })

  test.each([
    [".npmrc"],
    [".git-credentials"],
    [".pypirc"],
    [".dockercfg"],
    [".htpasswd"],
    [".terraformrc"],
    [".docker/config.json"],
    [".kube/config"],
    ["keys/id_rsa"],
    ["keys/id_ed25519"],
    ["keys/id_ecdsa"],
    ["cert.p12"],
    ["cert.pfx"],
    ["store.jks"],
    ["store.keystore"],
    ["secrets.yaml"],
    ["secrets.yml"],
    ["service-account.json"],
  ])("reading %s crosses the sensitive boundary", (file) => {
    const out = decide("read", file)
    expect({ file, rule: out.rule_id, reviewable: out.reviewable }).toEqual({
      file,
      rule: "SEC.V1.SENSITIVE_BOUNDARY",
      reviewable: false,
    })
  })

  test.each([[".npmrc"], [".kube/config"], ["keys/id_rsa"]])("writing %s crosses it too", (file) => {
    expect(decide("write", file).rule_id).toBe("SEC.V1.SENSITIVE_BOUNDARY")
  })

  test.each([["src/index.ts"], ["package.json"], ["README.md"], ["config.json"], ["docs/keystore.md"]])(
    "%s stays ordinary",
    (file) => {
      expect(decide("read", file).rule_id).not.toBe("SEC.V1.SENSITIVE_BOUNDARY")
    },
  )

  /**
   * `.husky` and `.githooks` are where `core.hooksPath` points in a modern repository, so a write
   * there installs a hook exactly as a write to `.git/hooks` does. They ask rather than deny:
   * unlike `.git/hooks`, these files are committed and a developer edits them by hand.
   */
  test.each([[".husky/pre-commit"], [".husky/commit-msg"], [".githooks/pre-push"]])(
    "writing %s is a control-plane change",
    (file) => {
      const out = decide("write", file)
      expect({ file, rule: out.rule_id, decision: out.decision, reviewable: out.reviewable }).toEqual({
        file,
        rule: "SEC.V1.CONTROL_PLANE_WRITE",
        decision: "ask",
        reviewable: false,
      })
    },
  )

  test("reading a hook directory is ordinary", () => {
    expect(decide("read", ".husky/pre-commit").rule_id).toBe("SEC.V1.NO_OPINION")
  })

  test.each([
    [".git/hooks/pre-commit"],
    [".git/modules/demo/hooks/pre-commit"],
    ["./tmp/../.git/modules/demo/hooks/pre-commit"],
  ])("writing the executable git hook %s denies", (file) => {
    const out = decide("write", file)
    expect({ rule: out.rule_id, decision: out.decision, reviewable: out.reviewable }).toEqual({
      rule: "SEC.V1.GIT_HOOK_WRITE",
      decision: "deny",
      reviewable: false,
    })
  })
})
