// kilocode_change - new file
import { test, expect, describe, afterEach } from "bun:test"
import { Effect } from "effect"
import { KiloSecurityGate } from "@/kilocode/security-decision/gate"
import { SecurityReviewer } from "@/kilocode/security-decision/reviewer"
import type { SecurityDecisionTypes as T } from "@/kilocode/security-decision/types"

/**
 * The reviewer stage is the only place the layer awaits, and everything it decided against can move
 * inside that window: a rule can be added, the agent can be switched, the sandbox can be toggled,
 * the user's global block can be rewritten. A verdict computed against the old state and applied to
 * the new one is a decision about a call that no longer exists.
 *
 * So an `allow` is only applied when a *fresh* read of the live state matches the state the question
 * was asked about. Anything else — including a live read that fails — leaves the deterministic ask
 * standing, which is exactly the outcome the call would have had with no reviewer at all.
 */

const previous = process.env["KILO_SECURITY_DECISION"]
afterEach(() => {
  if (previous === undefined) delete process.env["KILO_SECURITY_DECISION"]
  else process.env["KILO_SECURITY_DECISION"] = previous
  SecurityReviewer.reset()
})

const CONTAINED: T.Containment = { sandbox: "operational", network: "deny", destinations: [], escalated: false }

/** A reviewable ask: a delete of an ordinary in-workspace file. */
const request = {
  permission: "bash",
  patterns: ["rm -rf build"],
  metadata: {
    securityFacts: {
      complete: true,
      composed: false,
      executable: "rm",
      argv: ["rm", "-rf", "build"],
      classified: true,
      effects: [{ operation: "delete", path: "/repo/build" }],
    },
  },
  sessionID: "ses_recheck",
  resolved: [{ pattern: "rm -rf build", action: "allow" as const }],
  humanOnly: false,
  workspace: "/repo",
  agent: "code",
}

/** A config whose global block can differ between the first read and the second. */
function config(...blocks: Array<Record<string, unknown>>) {
  let call = 0
  return {
    getGlobal: () =>
      Effect.sync(() => {
        const block = blocks[Math.min(call, blocks.length - 1)] ?? {}
        call += 1
        return { permission: block } as never
      }),
  }
}

/** What a fresh read reports. Defaults to the state the decision was made against. */
function live(patch: Partial<KiloSecurityGate.Live> = {}) {
  return () =>
    Effect.succeed({
      resolved: request.resolved,
      humanOnly: request.humanOnly,
      containment: CONTAINED,
      agent: request.agent,
      ...patch,
    } satisfies KiloSecurityGate.Live)
}

function run(input: Partial<Parameters<typeof KiloSecurityGate.evaluate>[0]> = {}) {
  process.env["KILO_SECURITY_DECISION"] = "1"
  return Effect.runPromise(
    KiloSecurityGate.evaluate({
      config: config({}),
      containment: CONTAINED,
      live: live(),
      ...request,
      ...input,
    }),
  )
}

/** A reviewer that would let every eligible call through. */
function permissive() {
  SecurityReviewer.bind(() => Promise.resolve('{"decision":"allow","reason_code":"ROUTINE_BUILD_CLEANUP"}'))
}

describe("the reviewer's verdict is bound to the state it was asked about", () => {
  test("the question is a reviewable ask to begin with", async () => {
    const out = await run()
    expect(out?.decision).toBe("ask")
    expect(out?.rule_id).toBe("SEC.V1.DESTRUCTIVE_FS")
    expect(out?.reviewable).toBe(true)
    expect(out?.audit.reviewer.state).toBe("not_run")
  })

  test("an allow applies while the live state still matches", async () => {
    permissive()
    const out = await run()
    expect(out?.decision).toBe("allow")
    expect(out?.audit.reviewer).toMatchObject({ state: "allow", reason_code: "ROUTINE_BUILD_CLEANUP" })
  })

  test("a sandbox toggled during the review drops the verdict", async () => {
    permissive()
    const out = await run({ live: live({ containment: { ...CONTAINED, sandbox: "failed" } }) })
    expect(out?.decision).toBe("ask")
    expect(out?.audit.reviewer).toMatchObject({ state: "keep_ask", reason_code: "AUTHORIZATION_CHANGED" })
  })

  test("an escalation granted during the review drops the verdict", async () => {
    permissive()
    const out = await run({ live: live({ containment: { ...CONTAINED, escalated: true } }) })
    expect(out?.decision).toBe("ask")
    expect(out?.audit.reviewer.reason_code).toBe("AUTHORIZATION_CHANGED")
  })

  test("a rule that lands during the review drops the verdict", async () => {
    permissive()
    const out = await run({ live: live({ resolved: [{ pattern: "rm -rf build", action: "ask" }] }) })
    expect(out?.decision).toBe("ask")
    expect(out?.audit.reviewer.reason_code).toBe("AUTHORIZATION_CHANGED")
  })

  test("a human-only guard raised during the review drops the verdict", async () => {
    permissive()
    const out = await run({ live: live({ humanOnly: true }) })
    expect(out?.decision).toBe("ask")
    expect(out?.audit.reviewer.reason_code).toBe("AUTHORIZATION_CHANGED")
  })

  test("an agent switched during the review drops the verdict", async () => {
    permissive()
    const out = await run({ live: live({ agent: "architect" }) })
    expect(out?.decision).toBe("ask")
    expect(out?.audit.reviewer.reason_code).toBe("AUTHORIZATION_CHANGED")
  })

  test("a rewritten user-global block drops the verdict", async () => {
    permissive()
    // The second read is the one taken after the await. It does not raise the floor, so only a
    // comparison over the rules themselves — not over the folded floor — can notice it.
    const out = await run({ config: config({}, { bash: { "*": "allow" } }) })
    expect(out?.decision).toBe("ask")
    expect(out?.audit.reviewer.reason_code).toBe("AUTHORIZATION_CHANGED")
  })

  test("a live read that fails is treated as changed, not as unchanged", async () => {
    permissive()
    const out = await run({ live: () => Effect.die(new Error("boom")) as never })
    expect(out?.decision).toBe("ask")
    expect(out?.audit.reviewer.reason_code).toBe("AUTHORIZATION_CHANGED")
  })

  test("the recheck never turns a keep_ask into something else", async () => {
    SecurityReviewer.bind(() => Promise.resolve('{"decision":"keep_ask","reason_code":"UNCLEAR_SCOPE"}'))
    const out = await run({ live: live({ humanOnly: true }) })
    expect(out?.decision).toBe("ask")
    expect(out?.audit.reviewer).toMatchObject({ state: "keep_ask", reason_code: "UNCLEAR_SCOPE" })
  })

  test("the comparison is against a fresh read, not against the captured input", async () => {
    permissive()
    let reads = 0
    const out = await run({
      live: () => {
        reads += 1
        return Effect.succeed({
          resolved: request.resolved,
          humanOnly: request.humanOnly,
          containment: CONTAINED,
          agent: request.agent,
        })
      },
    })
    expect(reads).toBe(1)
    expect(out?.decision).toBe("allow")
  })
})
