import { describe, expect, test } from "bun:test"
import { resolveSecurityStatus } from "./tool-security"
import { withSecurity } from "./basic-tool"

// Echo the key so assertions can see which string was chosen without a real dictionary.
const t = (key: string, params?: Record<string, string | number | boolean>) =>
  params
    ? `${key}(${Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join(",")})`
    : key

const record = (reviewer: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  securityDecision: { rule_id: "SEC.V1.UNCLASSIFIED_EXEC", reviewer, ...extra },
})

describe("resolveSecurityStatus", () => {
  test("no security record means no badge", () => {
    expect(resolveSecurityStatus(undefined, t)).toBeUndefined()
    expect(resolveSecurityStatus({ approval: { source: "agent" } }, t)).toBeUndefined()
  })

  test("each state gets its own label", () => {
    const label = (metadata: Record<string, unknown>) => resolveSecurityStatus(metadata, t)?.label
    expect(label(record({ state: "running" }, { final_enforcement: "ask_pending" }))).toBe("ui.security.reviewing")
    expect(label(record({ state: "allow" }, { final_enforcement: "allow" }))).toBe("ui.security.autoApproved")
    expect(label(record({ state: "keep_ask" }, { final_enforcement: "ask_pending" }))).toBe("ui.security.needsApproval")
    expect(label(record({ state: "not_run" }, { final_enforcement: "blocked" }))).toBe("ui.security.blocked")
  })

  test("the kind travels with the label so a host can style it", () => {
    const out = resolveSecurityStatus(record({ state: "running" }, { final_enforcement: "ask_pending" }), t)
    expect(out?.status.kind).toBe("reviewing")
  })

  test("details are a plain machine-readable line, not localized prose", () => {
    const out = resolveSecurityStatus(
      record({ state: "allow", reason_code: "ORDINARY_DEV_COMMAND", latency_ms: 42 }, { final_enforcement: "allow" }),
      t,
    )
    expect(out?.detail).toBe("SEC.V1.UNCLASSIFIED_EXEC · ORDINARY_DEV_COMMAND · 42ms")
  })

  test("details fall back to whatever the record actually carries", () => {
    const out = resolveSecurityStatus(record({ state: "running" }, { final_enforcement: "ask_pending" }), t)
    expect(out?.detail).toBe("SEC.V1.UNCLASSIFIED_EXEC")
  })
})

describe("withSecurity", () => {
  const badge = "<badge>" as never

  test("a structured trigger gets the badge in its status slot", () => {
    const out = withSecurity({ title: "npm test", subtitle: "bash" }, badge)
    expect(out).toEqual({ title: "npm test", subtitle: "bash", status: badge })
  })

  test("a trigger the caller built as an element has no slot and is left alone", () => {
    const element = { nodeType: 1 } as never
    expect(withSecurity(element, badge)).toBe(element)
    expect(withSecurity(undefined as never, badge)).toBeUndefined()
  })
})
