import { expect, test } from "bun:test"
import { Effect } from "effect"
import { fetchAccountBalance, fetchBalance, fetchKiloPass, parseKiloPass } from "../src/account.js"
import { fixture } from "./fixture.js"

test("fetches the selected organization balance with the Kilo bearer transport", async () => {
  using backend = fixture()
  const balance = await Effect.runPromise(fetchBalance(backend.url, "fixture-token", "selected"))

  expect(balance).toEqual({ balance: 42.5 })
  expect(backend.requests.at(-1)).toMatchObject({
    path: "/api/profile/balance",
    authorization: "Bearer fixture-token",
    organizationID: "selected",
  })
})

test("returns independent null metadata when balance or personal pass fetches fail", async () => {
  using backend = fixture()
  backend.state.balanceStatus = 503
  const balanceUnavailable = await Effect.runPromise(fetchAccountBalance(backend.url, "fixture-token", null))
  expect(balanceUnavailable).toEqual({
    balance: null,
    kiloPass: {
      currentPeriodBaseCreditsUsd: 19,
      currentPeriodUsageUsd: 4.5,
      currentPeriodBonusCreditsUsd: 2,
      nextBillingAt: "2026-10-01T00:00:00.000Z",
    },
  })

  backend.state.balanceStatus = 200
  backend.state.kiloPassStatus = 503
  const passUnavailable = await Effect.runPromise(fetchAccountBalance(backend.url, "fixture-token", null))
  expect(passUnavailable).toEqual({ balance: { balance: 42.5 }, kiloPass: null })
})

test("does not request personal Kilo Pass data for organization balance", async () => {
  using backend = fixture()
  const value = await Effect.runPromise(fetchAccountBalance(backend.url, "fixture-token", "selected"))

  expect(value).toEqual({ balance: { balance: 42.5 }, kiloPass: null })
  expect(backend.requests.map((item) => item.path)).toEqual(["/api/profile/balance"])
})

test("parses both documented tRPC envelopes and omits inactive passes", async () => {
  expect(
    parseKiloPass([
      {
        result: {
          data: {
            subscription: {
              status: "trialing",
              currentPeriodBaseCreditsUsd: 5,
              currentPeriodUsageUsd: 1,
              currentPeriodBonusCreditsUsd: null,
              nextRenewalAt: "2026-11-01T00:00:00.000Z",
            },
          },
        },
      },
    ]),
  ).toEqual({
    currentPeriodBaseCreditsUsd: 5,
    currentPeriodUsageUsd: 1,
    currentPeriodBonusCreditsUsd: 0,
    nextBillingAt: "2026-11-01T00:00:00.000Z",
  })
  expect(parseKiloPass({ subscription: { status: "canceled", currentPeriodBaseCreditsUsd: 5 } })).toBeNull()
})

test("treats malformed pass response as absent metadata", async () => {
  using backend = fixture()
  backend.state.kiloPass = { invalid: true }
  expect(await Effect.runPromise(fetchKiloPass(backend.url, "fixture-token"))).toBeNull()
})
