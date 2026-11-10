// The new session model order of v1 `resolveModelSelection`.
import { describe, expect, test } from "bun:test"
import { configuredModel, initialModel } from "../webview-ui/src/v2/model-default"
import { kiloTeam } from "../webview-ui/src/v2/kilo-models"

const catalog = ["kilo/auto", "kilo/a", "x/b", "kilo/team", "kilo/first", "kilo/kilo-auto/free"]
const ref = (item: string) => ({ providerID: item.slice(0, item.indexOf("/")), id: item.slice(item.indexOf("/") + 1) })
const models = catalog.map(ref)
// v1 `KILO_AUTO`, the free router a personal account falls back to.
const free = { providerID: "kilo", id: "kilo-auto/free" }
const valid = (value: { providerID: string; id: string }) =>
  catalog.includes(`${value.providerID}/${value.id}`)
const base = {
  pick: undefined,
  agent: undefined,
  configured: undefined,
  team: false,
  loaded: true,
  recents: [],
  models,
  serverDefault: { providerID: "kilo", id: "auto" },
  valid,
}

describe("initialModel", () => {
  test("prefers the pick of this scope, then the agent model, then the configured model", () => {
    const agent = { providerID: "x", id: "b" }
    const configured = { providerID: "kilo", id: "a" }
    const pick = { providerID: "kilo", id: "team" }
    expect(initialModel({ ...base, pick, agent, configured })).toEqual(pick)
    expect(initialModel({ ...base, agent, configured })).toEqual(agent)
    expect(initialModel({ ...base, configured })).toEqual(configured)
  })

  test("skips a pick, agent or configured model that left the catalog", () => {
    const gone = { providerID: "gone", id: "m" }
    expect(initialModel({ ...base, pick: gone })).toEqual(free)
    expect(initialModel({ ...base, agent: gone })).toEqual(free)
    expect(initialModel({ ...base, configured: gone })).toEqual(free)
  })

  test("a pick beats the team default, as v1 Pick(scope, agent)", () => {
    const pick = { providerID: "x", id: "b" }
    expect(initialModel({ ...base, team: true, pick })).toEqual(pick)
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
    const serverDefault = { providerID: "kilo", id: "team" }
    expect(
      initialModel({ ...base, team: true, serverDefault, recents: [{ providerID: "x", modelID: "b" }] }),
    ).toEqual(serverDefault)
  })

  test("a team account falls back to the first Kilo model when its default left the catalog", () => {
    expect(
      initialModel({
        ...base,
        team: true,
        serverDefault: { providerID: "kilo", id: "gone" },
        recents: [{ providerID: "x", modelID: "b" }],
      }),
    ).toEqual({ providerID: "kilo", id: "auto" })
  })

  test("a personal account falls back to Kilo Auto Free without recents, as v1 KILO_AUTO", () => {
    expect(initialModel(base)).toEqual(free)
  })

  test("uses the server default when the catalog no longer lists Kilo Auto Free", () => {
    const withoutFree = catalog.filter((item) => item !== "kilo/kilo-auto/free")
    expect(
      initialModel({
        ...base,
        models: withoutFree.map(ref),
        valid: (value) => withoutFree.includes(`${value.providerID}/${value.id}`),
      }),
    ).toEqual(base.serverDefault)
  })

  test("waits for the account before it uses the recents", () => {
    const recents = [{ providerID: "x", modelID: "b" }]
    expect(initialModel({ ...base, team: undefined, recents })).toBeUndefined()
  })

  test("waits for the recents before it falls back", () => {
    expect(initialModel({ ...base, loaded: false })).toBeUndefined()
    expect(initialModel({ ...base, loaded: false, recents: [{ providerID: "x", modelID: "b" }] })).toBeUndefined()
  })

  test("an agent or configured model still applies while the account is unknown, unless it is Kilo", () => {
    const agent = { providerID: "x", id: "b" }
    expect(initialModel({ ...base, team: undefined, loaded: false, agent })).toEqual(agent)
    expect(initialModel({ ...base, team: undefined, agent: { providerID: "kilo", id: "a" } })).toBeUndefined()
    expect(initialModel({ ...base, loaded: false, configured: { providerID: "kilo", id: "a" } })).toBeUndefined()
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
