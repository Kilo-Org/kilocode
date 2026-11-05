// The new session model order of v1 `resolveModelSelection`.
import { describe, expect, test } from "bun:test"
import { configuredModel, initialModel } from "../webview-ui/src/v2/model-default"
import { kiloTeam } from "../webview-ui/src/v2/kilo-models"

const catalog = new Set(["kilo/auto", "kilo/a", "x/b", "kilo/team"])
const base = {
  agent: undefined,
  configured: undefined,
  team: false,
  recents: [],
  valid: (ref: { providerID: string; id: string }) => catalog.has(`${ref.providerID}/${ref.id}`),
  fallback: { providerID: "kilo", id: "auto" },
}

describe("initialModel", () => {
  test("prefers the agent model, then the configured model", () => {
    const agent = { providerID: "x", id: "b" }
    const configured = { providerID: "kilo", id: "a" }
    expect(initialModel({ ...base, agent, configured })).toEqual(agent)
    expect(initialModel({ ...base, configured })).toEqual(configured)
  })

  test("skips an agent or configured model that left the catalog", () => {
    expect(initialModel({ ...base, agent: { providerID: "gone", id: "m" } })).toEqual(base.fallback)

    expect(initialModel({ ...base, configured: { providerID: "gone", id: "m" } })).toEqual(base.fallback)
  })

  test("uses the most recent pick that is still in the catalog", () => {
    const recents = [
      { providerID: "gone", modelID: "m" },
      { providerID: "x", modelID: "b" },
      { providerID: "kilo", modelID: "a" },
    ]
    expect(initialModel({ ...base, recents })).toEqual({ providerID: "x", id: "b" })
  })

  test("a team account uses the team default instead of the recents", () => {
    const fallback = { providerID: "kilo", id: "team" }
    expect(initialModel({ ...base, team: true, fallback, recents: [{ providerID: "x", modelID: "b" }] })).toEqual(
      fallback,
    )
  })

  test("falls back to the server default without recents", () => {
    expect(initialModel(base)).toEqual(base.fallback)
  })

  test("waits for the account before it uses the recents", () => {
    const recents = [{ providerID: "x", modelID: "b" }]
    expect(initialModel({ ...base, team: undefined, recents })).toEqual(base.fallback)
  })
})

describe("kiloTeam", () => {
  test("is unknown until the first read and a team only with an organization", () => {
    expect(kiloTeam({ entries: new Map(), organizationID: undefined, ready: false })).toBeUndefined()
    expect(kiloTeam({ entries: new Map(), organizationID: null, ready: true })).toBe(false)
    expect(kiloTeam({ entries: new Map(), organizationID: "org", ready: true })).toBe(true)
  })
})

describe("configuredModel", () => {
  test("reads the last document that sets a model, as a string or an object", () => {
    // SAFETY: only the fields configuredModel reads.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const entries = [
      { type: "document", info: { model: "kilo/a" } },
      { type: "document", info: { model: { providerID: "x", model: "b", variant: "high" } } },
      { type: "document", info: {} },
    ] as unknown as Parameters<typeof configuredModel>[0]
    expect(configuredModel(entries)).toEqual({ providerID: "x", id: "b", variant: "high" })
    expect(configuredModel(entries?.slice(0, 1))).toEqual({ providerID: "kilo", id: "a" })
    expect(configuredModel(undefined)).toBeUndefined()
  })
})
