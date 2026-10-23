import { test, expect, describe, afterEach } from "bun:test"
import { Effect } from "effect"
import { KiloSecurityGate } from "../../../src/kilocode/security-decision/gate"
import { SecurityReviewer } from "../../../src/kilocode/security-decision/reviewer"
import { SecurityDecision } from "../../../src/kilocode/security-decision/core"
import { SecurityDecisionAdapter } from "../../../src/kilocode/security-decision/adapter"
import type { SecurityDecisionTypes } from "../../../src/kilocode/security-decision/types"

const containment: SecurityDecisionTypes.Containment = {
  sandbox: "off",
  network: "allow",
  destinations: [],
  escalated: false,
}

function input(patch: {
  action: SecurityDecisionTypes.Input["action"]
  baseline?: Partial<SecurityDecisionTypes.Input["baseline"]>
}): SecurityDecisionTypes.Input {
  return {
    version: 1,
    action: patch.action,
    baseline: { decision: "ask", authority: "untrusted", humanOnly: false, ...patch.baseline },
    metadata: { complete: true, truncated: false },
    containment,
  }
}

function shell(argv: readonly string[], patch: Partial<SecurityDecisionTypes.ExecFact> = {}) {
  return input({
    action: {
      kind: "bash",
      operation: "exec",
      paths: [],
      exec: { complete: true, composed: false, class: "known", executable: argv[0], argv, ...patch },
    },
  })
}

describe("dependency install", () => {
  test("asks without review for an npm install", () => {
    const out = SecurityDecision.decide(shell(["npm", "install", "lodash"]))
    expect(out.decision).toBe("ask")
    expect(out.rule_id).toBe("SEC.V1.DEPENDENCY_INSTALL")
    expect(out.reviewable).toBe(false)
  })

  test("asks for every package manager that fetches a dependency", () => {
    const commands = [
      ["pnpm", "add", "left-pad"],
      ["yarn", "add", "left-pad"],
      ["bun", "add", "left-pad"],
      ["pip", "install", "requests"],
      ["pip3", "install", "requests"],
      ["uv", "add", "requests"],
      ["poetry", "add", "requests"],
      ["cargo", "add", "serde"],
      ["go", "get", "example.com/pkg"],
      ["gem", "install", "rails"],
      ["bundle", "add", "rails"],
      ["composer", "require", "vendor/pkg"],
      ["deno", "add", "npm:left-pad"],
    ]
    for (const argv of commands) {
      const out = SecurityDecision.decide(shell(argv))
      expect({ argv, rule: out.rule_id, reviewable: out.reviewable }).toEqual({
        argv,
        rule: "SEC.V1.DEPENDENCY_INSTALL",
        reviewable: false,
      })
    }
  })

  test("asks for a runner that fetches and executes a package", () => {
    for (const argv of [
      ["npx", "cowsay"],
      ["bunx", "cowsay"],
      ["uvx", "ruff"],
      ["pipx", "run", "ruff"],
    ]) {
      const out = SecurityDecision.decide(shell(argv))
      expect({ argv, rule: out.rule_id }).toEqual({ argv, rule: "SEC.V1.DEPENDENCY_INSTALL" })
    }
  })

  test("asks for an install reached through a module invocation", () => {
    const out = SecurityDecision.decide(shell(["python3", "-m", "pip", "install", "requests"]))
    expect(out.rule_id).toBe("SEC.V1.DEPENDENCY_INSTALL")
  })

  test("--ignore-scripts is not a reason to auto-allow an install", () => {
    const out = SecurityDecision.decide(shell(["npm", "install", "--ignore-scripts", "lodash"]))
    expect(out.decision).toBe("ask")
    expect(out.rule_id).toBe("SEC.V1.DEPENDENCY_INSTALL")
    expect(out.reviewable).toBe(false)
  })

  test("asks for a bare invocation that installs from the lockfile", () => {
    const out = SecurityDecision.decide(shell(["yarn"]))
    expect(out.rule_id).toBe("SEC.V1.DEPENDENCY_INSTALL")
    expect(out.reviewable).toBe(false)
  })

  test("leaves a non-installing package manager command to the unclassified path", () => {
    const out = SecurityDecision.decide(shell(["npm", "run", "build"]))
    expect(out.rule_id).toBe("SEC.V1.UNCLASSIFIED_EXEC")
  })

  test("does not classify an install it could not fully parse", () => {
    const out = SecurityDecision.decide(shell(["npm", "install", "lodash"], { complete: false }))
    expect(out.rule_id).toBe("SEC.V1.EXEC_INCOMPLETE")
  })

  test("a deny still wins over an install", () => {
    const out = SecurityDecision.decide(
      input({
        action: {
          kind: "bash",
          operation: "exec",
          paths: [{ path: ".git/hooks/pre-commit", inWorkspace: true, class: "git_hook", operation: "update" }],
          exec: { complete: true, composed: false, class: "known", executable: "npm", argv: ["npm", "install", "x"] },
        },
      }),
    )
    expect(out.decision).toBe("deny")
    expect(out.rule_id).toBe("SEC.V1.GIT_HOOK_WRITE")
  })
})

describe("dependency manifest", () => {
  function manifest(patch: Partial<SecurityDecisionTypes.PathFact>, operation = "update") {
    return input({
      action: {
        kind: "edit",
        operation,
        paths: [{ path: "package.json", inWorkspace: true, class: "package_manifest", ...patch }],
      },
    })
  }

  test("asks without review for a declared dependency change", () => {
    const out = SecurityDecision.decide(manifest({ region: "dependencies" }))
    expect(out.decision).toBe("ask")
    expect(out.rule_id).toBe("SEC.V1.DEPENDENCY_MANIFEST_WRITE")
    expect(out.reviewable).toBe(false)
  })

  test("asks under its own rule when the change touches the script region", () => {
    const out = SecurityDecision.decide(manifest({ region: "scripts" }))
    expect(out.decision).toBe("ask")
    expect(out.rule_id).toBe("SEC.V1.PACKAGE_EXECUTION")
    expect(out.reviewable).toBe(false)
  })

  test("asks when the changed region could not be determined", () => {
    const out = SecurityDecision.decide(manifest({ region: "other" }))
    expect(out.rule_id).toBe("SEC.V1.DEPENDENCY_MANIFEST_WRITE")
  })

  test("asks without review when a manifest is deleted", () => {
    const out = SecurityDecision.decide(manifest({ region: "dependencies" }, "delete"))
    expect(out.rule_id).toBe("SEC.V1.DEPENDENCY_MANIFEST_WRITE")
    expect(out.reviewable).toBe(false)
  })

  test("has no opinion on reading a manifest", () => {
    const out = SecurityDecision.decide(manifest({ region: "dependencies" }, "read"))
    expect(out.decision).toBe("pass")
  })
})

describe("dependency manifest routing", () => {
  function evaluate(request: { permission: string; patterns: readonly string[]; metadata?: Record<string, unknown> }) {
    return SecurityDecisionAdapter.evaluate(
      { sessionID: "ses_1", callID: "call_1", ...request },
      {
        workspace: "/repo",
        effective: "allow",
        humanOnly: false,
        floor: { action: "allow", authority: "untrusted", conflict: false },
        containment,
      },
    )
  }

  function edit(file: string, diff?: string) {
    return evaluate({ permission: "edit", patterns: [file], metadata: { filepath: file, ...(diff ? { diff } : {}) } })
  }

  test("asks for a write to any dependency manifest or lockfile", () => {
    const files = [
      "package.json",
      "package-lock.json",
      "bun.lock",
      "bun.lockb",
      "yarn.lock",
      "pnpm-lock.yaml",
      "requirements.txt",
      "requirements-dev.txt",
      "pyproject.toml",
      "poetry.lock",
      "uv.lock",
      "Pipfile",
      "Cargo.toml",
      "Cargo.lock",
      "go.mod",
      "go.sum",
      "Gemfile",
      "Gemfile.lock",
      "composer.json",
      "composer.lock",
      "apps/web/package.json",
    ]
    for (const file of files) {
      const out = edit(file)
      expect({ file, rule: out.rule_id, reviewable: out.reviewable }).toEqual({
        file,
        rule: "SEC.V1.DEPENDENCY_MANIFEST_WRITE",
        reviewable: false,
      })
    }
  })

  test("has no opinion on reading a manifest", () => {
    expect(evaluate({ permission: "read", patterns: ["package.json"] }).decision).toBe("pass")
  })

  test("names the script rule when the diff changes the scripts block", () => {
    const diff = [
      "--- package.json",
      "+++ package.json",
      "@@ -4,6 +4,7 @@",
      '   "scripts": {',
      '     "build": "tsc",',
      '+    "postinstall": "node ./setup.js"',
      "   },",
    ].join("\n")
    const out = edit("package.json", diff)
    expect(out.rule_id).toBe("SEC.V1.PACKAGE_EXECUTION")
    expect(out.reviewable).toBe(false)
  })

  test("names the script rule from a lifecycle key alone when the block header is out of context", () => {
    const diff = ["--- package.json", "+++ package.json", "@@ -12,3 +12,4 @@", '+    "prepare": "husky install"'].join(
      "\n",
    )
    expect(edit("package.json", diff).rule_id).toBe("SEC.V1.PACKAGE_EXECUTION")
  })

  test("names the manifest rule when the diff changes a dependency block", () => {
    const diff = [
      "--- package.json",
      "+++ package.json",
      "@@ -8,5 +8,6 @@",
      '   "dependencies": {',
      '     "react": "^18.0.0",',
      '+    "reqeusts": "^1.0.0"',
      "   }",
    ].join("\n")
    expect(edit("package.json", diff).rule_id).toBe("SEC.V1.DEPENDENCY_MANIFEST_WRITE")
  })

  test("a scripts block merely present in the context does not name the script rule", () => {
    const diff = [
      "--- package.json",
      "+++ package.json",
      "@@ -1,6 +1,6 @@",
      " {",
      '-  "version": "1.0.0",',
      '+  "version": "1.0.1",',
      '   "scripts": {',
      '     "build": "tsc"',
      "   },",
    ].join("\n")
    expect(edit("package.json", diff).rule_id).toBe("SEC.V1.DEPENDENCY_MANIFEST_WRITE")
  })

  test("routes a shell install to the same rule as the structured route", () => {
    const out = evaluate({
      permission: "bash",
      patterns: ["npm install lodash"],
      metadata: {
        securityFacts: { complete: true, composed: false, executable: "npm", argv: ["npm", "install", "lodash"] },
      },
    })
    expect(out.rule_id).toBe("SEC.V1.DEPENDENCY_INSTALL")
    expect(out.reviewable).toBe(false)
    expect(out.review).toBeUndefined()
  })
})

describe("dependency boundary at the gate", () => {
  const previous = process.env["KILO_SECURITY_DECISION"]
  afterEach(() => {
    if (previous === undefined) delete process.env["KILO_SECURITY_DECISION"]
    else process.env["KILO_SECURITY_DECISION"] = previous
    SecurityReviewer.reset()
  })

  function run(input: Partial<Parameters<typeof KiloSecurityGate.evaluate>[0]>) {
    process.env["KILO_SECURITY_DECISION"] = "1"
    return Effect.runPromise(
      KiloSecurityGate.evaluate({
        config: { getGlobal: () => Effect.succeed({ permission: {} } as any) },
        workspace: "/repo",
        permission: "bash",
        patterns: [],
        sessionID: "ses_1",
        callID: "call_1",
        humanOnly: false,
        resolved: [],
        ...input,
      }),
    )
  }

  const install = {
    permission: "bash",
    patterns: ["npm install lodash"],
    metadata: {
      securityFacts: { complete: true, composed: false, executable: "npm", argv: ["npm", "install", "lodash"] },
    },
    resolved: [{ pattern: "npm install lodash", action: "allow" as const }],
  }

  test("an allow-everything reviewer cannot turn a dependency install into an allow", async () => {
    let called = 0
    SecurityReviewer.bind(() => {
      called++
      return Promise.resolve('{"decision":"allow","reason_code":"ORDINARY_DEV_WORK"}')
    })

    const out = await run(install)

    expect(out?.decision).toBe("ask")
    expect(out?.rule_id).toBe("SEC.V1.DEPENDENCY_INSTALL")
    expect(called).toBe(0)
    expect(out?.audit.reviewer).toEqual({ state: "not_run" })
  })

  test("an allow-everything reviewer cannot turn a manifest write into an allow", async () => {
    let called = 0
    SecurityReviewer.bind(() => {
      called++
      return Promise.resolve('{"decision":"allow","reason_code":"ORDINARY_DEV_WORK"}')
    })

    const out = await run({
      permission: "edit",
      patterns: ["package.json"],
      metadata: { filepath: "package.json" },
      resolved: [{ pattern: "package.json", action: "allow" as const }],
    })

    expect(out?.decision).toBe("ask")
    expect(out?.rule_id).toBe("SEC.V1.DEPENDENCY_MANIFEST_WRITE")
    expect(called).toBe(0)
  })

  test("a session allow of every bash command does not lower the install boundary", async () => {
    const out = await run({ ...install, resolved: [{ pattern: "*", action: "allow" as const }] })

    expect(out?.decision).toBe("ask")
    expect(out?.rule_id).toBe("SEC.V1.DEPENDENCY_INSTALL")
  })
})
