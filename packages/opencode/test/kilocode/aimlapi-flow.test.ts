// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { AimlapiApiError, type AimlapiClient, type PartnerCheckoutSession } from "../../src/kilocode/aimlapi/client"
import { AimlapiFlow, COPY, parseAmountUsd, validEmail, type FlowPhase, type FlowResult } from "../../src/kilocode/aimlapi/flow"

function session(status: PartnerCheckoutSession["status"], token = "sess_1"): PartnerCheckoutSession {
  return {
    id: "pcs_1",
    sessionToken: token,
    partnerId: "part_test",
    partnerName: "Kilo Code",
    userId: 1,
    amountUsdMinor: 2500,
    status,
    issuedKeyId: null,
    returnUrl: null,
  }
}

type Harness = {
  flow: AimlapiFlow
  phases: FlowPhase[]
  results: FlowResult[]
  opened: string[]
  last: () => FlowPhase
}

function harness(client: Partial<AimlapiClient>): Harness {
  const phases: FlowPhase[] = []
  const results: FlowResult[] = []
  const opened: string[] = []
  const flow = new AimlapiFlow({
    client: client as AimlapiClient,
    openUrl: async (url) => {
      opened.push(url)
    },
    change: (phase) => phases.push(phase),
    complete: (result) => results.push(result),
    pollIntervalMs: 1,
    pollTimeoutMs: 500,
  })
  return { flow, phases, results, opened, last: () => phases[phases.length - 1]! }
}

describe("parseAmountUsd", () => {
  test("empty and non-numeric inputs ask for an amount", () => {
    expect(parseAmountUsd("")).toEqual({ ok: false, error: COPY.errAmountMissing })
    expect(parseAmountUsd("abc")).toEqual({ ok: false, error: COPY.errAmountMissing })
    expect(parseAmountUsd("-5")).toEqual({ ok: false, error: COPY.errAmountMissing })
    expect(parseAmountUsd("Infinity")).toEqual({ ok: false, error: COPY.errAmountMissing })
  })

  test("below-minimum amounts return the $20 minimum error", () => {
    expect(parseAmountUsd("2")).toEqual({ ok: false, error: COPY.errAmountMin })
    expect(parseAmountUsd("19.99")).toEqual({ ok: false, error: COPY.errAmountMin })
  })

  test("valid amounts convert to USD minor units, $ prefix allowed", () => {
    expect(parseAmountUsd("20")).toEqual({ ok: true, usdMinor: 2000 })
    expect(parseAmountUsd("$25")).toEqual({ ok: true, usdMinor: 2500 })
    expect(parseAmountUsd("25.50")).toEqual({ ok: true, usdMinor: 2550 })
  })

  test("amounts above the backend maximum are rejected", () => {
    expect(parseAmountUsd("999999")).toEqual({ ok: false, error: COPY.errTopupFailed })
  })
})

describe("validEmail", () => {
  test("accepts plain addresses and rejects malformed ones", () => {
    expect(validEmail("user@example.com")).toBe(true)
    expect(validEmail("user@sub.example.io")).toBe(true)
    expect(validEmail("user@")).toBe(false)
    expect(validEmail("user @example.com")).toBe(false)
    expect(validEmail("user@example")).toBe(false)
  })
})

describe("submitKey (S3)", () => {
  test("valid key completes with the pasted key", async () => {
    const h = harness({
      getBalance: async () => ({ balance: 10, lowBalance: false, lowBalanceThreshold: 5 }),
    })
    await h.flow.submitKey("  my-key  ")
    expect(h.last().id).toBe("ready")
    expect(h.results).toEqual([{ apiKey: "my-key" }])
  })

  test("invalid key shows the canonical invalid-key error", async () => {
    const h = harness({
      getBalance: async () => {
        throw new AimlapiApiError("GET -> 401", 401, "")
      },
    })
    await h.flow.submitKey("bad")
    expect(h.last()).toEqual({ id: "paste-key", error: COPY.errInvalidKey })
    expect(h.results).toHaveLength(0)
  })
})

describe("submitEmail (S4)", () => {
  test("malformed email fails client-side without any HTTP call", async () => {
    let called = false
    const h = harness({
      checkAccount: async () => {
        called = true
        return { action: "sign-in" as const }
      },
    })
    await h.flow.submitEmail("nope@")
    expect(h.last()).toEqual({ id: "email", error: COPY.errEmailFormat })
    expect(called).toBe(false)
  })

  test("existing account branches to the code screen", async () => {
    const sent: string[] = []
    const h = harness({
      checkAccount: async () => ({ action: "sign-in" as const }),
      sendSignInCode: async (email) => {
        sent.push(email)
      },
    })
    await h.flow.submitEmail("User@Example.com")
    expect(sent).toEqual(["user@example.com"])
    expect(h.last()).toEqual({ id: "code", email: "user@example.com" })
  })

  test("new account registers passwordless and branches to credits", async () => {
    const h = harness({
      checkAccount: async () => ({ action: "sign-up" as const }),
      createPasswordlessAccount: async () => ({ token: "auth_tok", exp: 0 }),
    })
    await h.flow.submitEmail("new@example.com")
    expect(h.last()).toEqual({ id: "credits" })
  })
})

describe("submitCode (S10)", () => {
  async function begin(h: Harness) {
    await h.flow.submitEmail("user@example.com")
  }
  const signIn = {
    checkAccount: async () => ({ action: "sign-in" as const }),
    sendSignInCode: async () => {},
  }

  test("non-6-digit input fails locally with the short error", async () => {
    const h = harness({ ...signIn })
    await begin(h)
    await h.flow.submitCode("12345")
    expect(h.last()).toEqual({ id: "code", email: "user@example.com", error: COPY.errCodeWrong })
  })

  test("wrong code (4xx) shows the canonical error", async () => {
    const h = harness({
      ...signIn,
      verifySignInCode: async () => {
        throw new AimlapiApiError("POST -> 400", 400, '{"message":"code mismatch"}')
      },
    })
    await begin(h)
    await h.flow.submitCode("123456")
    expect(h.last()).toEqual({ id: "code", email: "user@example.com", error: COPY.errCodeWrong })
  })

  test("expired code maps to the expired error copy", async () => {
    const h = harness({
      ...signIn,
      verifySignInCode: async () => {
        throw new AimlapiApiError("POST -> 400", 400, '{"message":"code expired"}')
      },
    })
    await begin(h)
    await h.flow.submitCode("123456")
    expect(h.last()).toEqual({ id: "code", email: "user@example.com", error: COPY.errCodeExpired })
  })

  test("valid code issues a key and completes", async () => {
    const h = harness({
      ...signIn,
      verifySignInCode: async () => ({ token: "auth_tok", exp: 0 }),
      createKey: async () => ({ key: "issued-key", id: "key_1" }),
    })
    await begin(h)
    await h.flow.submitCode("123456")
    expect(h.last().id).toBe("ready")
    expect(h.results).toEqual([{ apiKey: "issued-key", apiKeyId: "key_1" }])
  })
})

describe("submitAmount (S5 -> S6 -> S7)", () => {
  const signUp = {
    checkAccount: async () => ({ action: "sign-up" as const }),
    createPasswordlessAccount: async () => ({ token: "auth_tok", exp: 0 }),
  }

  test("happy path: session, pay, browser, poll to paid, exchange, success", async () => {
    const payCalls: { paymentSessionId: string }[] = []
    let polls = 0
    const h = harness({
      ...signUp,
      createSession: async () => session("pending_payment"),
      pay: async (_bearer, _token, input) => {
        payCalls.push({ paymentSessionId: input.paymentSessionId })
        return { checkout: { providerSessionId: "cs_1", payUrl: "https://pay.test/x" }, partnerCheckout: session("pending_payment") }
      },
      getSession: async () => (++polls < 2 ? session("pending_payment") : session("paid")),
      exchange: async () => ({ apiKey: "exchanged-key", apiKeyId: "key_2" }),
    })
    await h.flow.submitEmail("new@example.com")
    await h.flow.submitAmount("25", true)

    expect(h.opened).toEqual(["https://pay.test/x"])
    const success = h.phases.find((phase) => phase.id === "topup-success")
    expect(success).toEqual({ id: "topup-success", amountUsd: "25", email: "new@example.com" })
    expect(h.results).toEqual([{ apiKey: "exchanged-key", apiKeyId: "key_2" }])
    expect(payCalls).toHaveLength(1)
  })

  test("retry after failure reuses the same paymentSessionId for the same intent", async () => {
    const payCalls: string[] = []
    let failFirstPoll = true
    const h = harness({
      ...signUp,
      createSession: async () => session("pending_payment"),
      pay: async (_bearer, _token, input) => {
        payCalls.push(input.paymentSessionId)
        return { checkout: { providerSessionId: "cs_1", payUrl: null }, partnerCheckout: session("pending_payment") }
      },
      getSession: async () => {
        if (failFirstPoll) {
          failFirstPoll = false
          return session("failed")
        }
        return session("paid")
      },
      exchange: async () => ({ apiKey: "k", apiKeyId: "id" }),
    })
    await h.flow.submitEmail("new@example.com")
    await h.flow.submitAmount("25", true)
    expect(h.last()).toEqual({ id: "credits", error: COPY.errTopupFailed })
    await h.flow.submitAmount("25", true)
    expect(payCalls).toHaveLength(2)
    expect(payCalls[0]).toBe(payCalls[1])
  })

  test("changing the amount regenerates the idempotency handle", async () => {
    const payCalls: string[] = []
    let phase: "fail" | "pass" = "fail"
    const h = harness({
      ...signUp,
      createSession: async () => session("pending_payment"),
      pay: async (_bearer, _token, input) => {
        payCalls.push(input.paymentSessionId)
        return { checkout: { providerSessionId: "cs_1", payUrl: null }, partnerCheckout: session("pending_payment") }
      },
      getSession: async () => {
        if (phase === "fail") {
          phase = "pass"
          return session("cancelled")
        }
        return session("paid")
      },
      exchange: async () => ({ apiKey: "k", apiKeyId: "id" }),
    })
    await h.flow.submitEmail("new@example.com")
    await h.flow.submitAmount("25", true)
    await h.flow.submitAmount("30", true)
    expect(payCalls).toHaveLength(2)
    expect(payCalls[0]).not.toBe(payCalls[1])
  })

  test("terminal checkout failure clears the session so retry starts fresh", async () => {
    const sessions: string[] = []
    let created = 0
    let succeed = false
    const h = harness({
      ...signUp,
      createSession: async () => {
        created += 1
        const token = `sess_${created}`
        sessions.push(token)
        return session("pending_payment", token)
      },
      pay: async (_bearer, token) => {
        return { checkout: { providerSessionId: "cs", payUrl: null }, partnerCheckout: session("pending_payment", token) }
      },
      getSession: async () => (succeed ? session("paid") : ((succeed = true), session("expired"))),
      exchange: async () => ({ apiKey: "k", apiKeyId: "id" }),
    })
    await h.flow.submitEmail("new@example.com")
    await h.flow.submitAmount("25", true)
    await h.flow.submitAmount("25", true)
    expect(created).toBe(2)
  })

  test("below-minimum amount never touches the network", async () => {
    let called = false
    const h = harness({
      ...signUp,
      createSession: async () => {
        called = true
        return session("pending_payment")
      },
    })
    await h.flow.submitEmail("new@example.com")
    await h.flow.submitAmount("2", true)
    expect(h.last()).toEqual({ id: "credits", error: COPY.errAmountMin })
    expect(called).toBe(false)
  })
})
