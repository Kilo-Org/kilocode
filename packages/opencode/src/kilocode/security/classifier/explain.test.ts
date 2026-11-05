// The explanation is the one part of the security layer a person actually reads, and the one part
// that must never be able to influence what was decided. These tests hold both ends: every decision
// a user can meet has a sentence, and nothing about producing it can leak or decide anything.
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { RiskExplanation } from "./explain"
import type { ClassifierProvider } from "./provider"
import type { SecurityReasonCode } from "../types"

const base: RiskExplanation.Facts = {
  reasonCode: "NETWORK_EGRESS",
  decision: "ask",
  hard: true,
  subject: "token.txt",
  relation: "workspace",
  network: true,
  readSecret: false,
}

/** Every code the benchmark actually produces for a decision a person would see. */
const SEEN: SecurityReasonCode[] = [
  "NETWORK_EGRESS",
  "SENSITIVE_READ",
  "SECRET_EXFILTRATION",
  "SENSITIVE_WRITE",
  "PACKAGE_LIFECYCLE",
  "PACKAGE_PROVENANCE",
  "PACKAGE_INSTALL",
  "PACKAGE_UNVERIFIED",
  "UNCLASSIFIED_ACTION",
  "DELEGATED_AUTHORITY",
  "DESTRUCTIVE_GIT",
  "DESTRUCTIVE_FILESYSTEM",
  "DESTRUCTIVE_DEVICE",
  "INTERPRETER_INDIRECTION",
  "SHELL_INDIRECTION",
  "ENCODED_EXECUTION",
  "POLICY_TAMPERING",
]

describe("every decision a person can meet has a sentence", () => {
  for (const reasonCode of SEEN)
    test(reasonCode, () => {
      const text = RiskExplanation.template({ ...base, reasonCode })
      expect(text.length).toBeGreaterThan(20)
      // The rule id is what this feature exists to replace; it must not reappear in the sentence.
      expect(text).not.toContain(reasonCode)
      expect(text).not.toMatch(/hard\.|default\./)
    })

  test("an unknown code still produces a sentence rather than nothing", () => {
    const text = RiskExplanation.template({ ...base, reasonCode: "SAFE_COMMAND" })
    expect(text.length).toBeGreaterThan(20)
  })

  test("the sentence says what happens next", () => {
    expect(RiskExplanation.template({ ...base, decision: "ask" })).toContain("Approving")
    expect(RiskExplanation.template({ ...base, decision: "deny" })).toContain("will not run")
  })
})

describe("the sentence carries no location and no content", () => {
  test("a credential store is named as a class, never as a path", () => {
    const text = RiskExplanation.template({
      ...base,
      reasonCode: "SENSITIVE_READ",
      subject: "credentials",
      relation: "home-sensitive",
      store: "aws",
    })
    expect(text).toContain("aws")
    expect(text).not.toContain("/")
  })

  test("no template mentions a directory, a URL, or a home path", () => {
    for (const reasonCode of SEEN) {
      const text = RiskExplanation.template({ ...base, reasonCode, store: "ssh", subject: "id_rsa" })
      expect(text).not.toMatch(/https?:|~\/|\/Users\/|\/home\//)
    }
  })
})

describe("the semantic layer's finding is said in words", () => {
  test("a goal mismatch reads as a goal mismatch", () => {
    const text = RiskExplanation.template({ ...base, semantic: "USER_GOAL_MISMATCH" })
    expect(text).toContain("what you asked for")
  })

  test("an injection finding names the source of the instruction", () => {
    const text = RiskExplanation.template({ ...base, semantic: "PROMPT_INJECTION" })
    expect(text).toContain("asked it to do this")
  })
})

describe("a model may edit the sentence, and may not do anything else", () => {
  const withRewrite = (rewrite: ClassifierProvider["rewrite"]): ClassifierProvider => ({
    name: "stub",
    async classify() {
      return { risk: "ORDINARY", category: "NONE", confidence: "LOW" }
    },
    ...(rewrite ? { rewrite } : {}),
  })

  const run = (provider: ClassifierProvider | undefined, timeoutMs = 300) =>
    Effect.runPromise(RiskExplanation.generate({ provider, facts: base, timeoutMs }))

  test("no provider leaves the template in place", async () => {
    expect(await run(undefined)).toBe(RiskExplanation.template(base))
  })

  test("a provider without a rewrite method leaves the template in place", async () => {
    expect(await run(withRewrite(undefined))).toBe(RiskExplanation.template(base))
  })

  test("an acceptable rewrite is used", async () => {
    const better = "The agent wants to send a file from your project to an address outside this machine."
    expect(await run(withRewrite(async () => better))).toBe(better)
  })

  test("a provider that throws synchronously falls back, and does not escape as a defect", async () => {
    // Not hypothetical. A synchronous throw used to escape the Effect thunk, fail the whole
    // `SecurityGate.evaluate` scope, and be converted into a hard ask — which for a decision that had
    // already reached DENY is a downgrade. Presentation may not move a decision.
    const throwsSynchronously: ClassifierProvider = {
      name: "sync-throw",
      async classify() {
        return { risk: "ORDINARY", category: "NONE", confidence: "LOW" }
      },
      rewrite() {
        throw new Error("blew up before returning a promise")
      },
    }
    expect(await run(throwsSynchronously)).toBe(RiskExplanation.template(base))
  })

  test("an error falls back to the template", async () => {
    expect(
      await run(
        withRewrite(async () => {
          throw new Error("boom")
        }),
      ),
    ).toBe(RiskExplanation.template(base))
  })

  test("a hang is cut off by the deadline and falls back", async () => {
    const started = performance.now()
    const hanging = withRewrite(
      (_system, _text, signal) =>
        new Promise<string>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))),
    )
    expect(await run(hanging, 50)).toBe(RiskExplanation.template(base))
    expect(performance.now() - started).toBeLessThan(2000)
  })

  test("an answer that is not one plain sentence falls back", async () => {
    for (const junk of [
      "",
      "ok",
      "line one\nline two",
      "Visit https://example.com for details about this action and why it matters",
      "<b>The agent wants to send a file somewhere outside this machine right now</b>",
      "The agent will read /Users/somebody/.aws/credentials and then send them onward to a server",
      "word ".repeat(60),
    ])
      expect(await run(withRewrite(async () => junk))).toBe(RiskExplanation.template(base))
  })

  test("acceptable() is the whole gate on what a model may put in front of a person", () => {
    expect(RiskExplanation.acceptable("The agent wants to send a file to an outside address.")).toBe(true)
    expect(RiskExplanation.acceptable("yes")).toBe(false)
    expect(RiskExplanation.acceptable("a\nb")).toBe(false)
  })
})
