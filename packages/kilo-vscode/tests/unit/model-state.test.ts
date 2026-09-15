import { afterEach, describe, expect, it } from "bun:test"
import { link, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { PersistModelSelectionRequest } from "../../webview-ui/src/types/messages/webview-messages"

const dirs: string[] = []
const model = { providerID: "kilo", modelID: "model-a" }
const other = { providerID: "other", modelID: "model-b" }
const unrelated = {
  recent: [other],
  favorite: [model],
  variant: { "kilo/model-a": "low" },
  custom: { nested: [1, "keep", null] },
}

function load(): Promise<typeof import("../../src/kilo-provider/model-state")> {
  // Reload module-level path caching without replacing the persistence implementation.
  return import(`../../src/kilo-provider/model-state.ts?${crypto.randomUUID()}`)
}

async function fixture(data?: unknown, prefs?: unknown) {
  const dir = await mkdtemp(join(tmpdir(), "kilo-model-state-"))
  dirs.push(dir)
  const file = join(dir, "model.json")
  const preference = join(dir, "vscode-model.json")
  if (data !== undefined) await Bun.write(file, JSON.stringify(data))
  if (prefs !== undefined) await Bun.write(preference, JSON.stringify(prefs))
  const client = { path: { get: async () => ({ data: { state: dir } }) } } as unknown as KiloClient
  const host = await load()
  const messages: unknown[] = []
  const post = (message: unknown) => {
    messages.push(message)
  }
  return {
    dir,
    get file() {
      return Bun.file(file)
    },
    get preference() {
      return Bun.file(preference)
    },
    client,
    host,
    post,
    messages,
    save: (selection: Omit<PersistModelSelectionRequest, "type">) =>
      host.handleMessage("persistModelSelection", selection, client, post),
    request: async () => {
      expect(await host.handleMessage("requestModelSelections", {}, client, post)).toBe(true)
      return messages.at(-1)
    },
  }
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("model-state", () => {
  it("persists a preferred model and effort together while preserving other modes and unrelated fields", async () => {
    const state = await fixture({ ...unrelated, model: { code: other, plan: other } })

    expect(await state.save({ agent: "code", ...model, variant: "high" })).toBe(true)

    expect(await state.file.json()).toEqual({
      ...unrelated,
      model: { code: model, plan: other },
    })
    expect(await state.preference.json()).toEqual({ preferred: { ...model, variant: "high" } })
    expect(await state.request()).toEqual({
      type: "modelSelectionsLoaded",
      selections: { code: model, plan: other },
      preferred: { ...model, variant: "high" },
    })
  })

  it.each([undefined, ""])("saves an explicit default effort for variant %j", async (variant) => {
    const state = await fixture({ model: { plan: other } }, { preferred: { ...other, variant: "high" } })

    await state.save({ agent: "code", ...model, ...(variant === undefined ? {} : { variant }) })

    expect(await state.file.json()).toEqual({
      model: { plan: other, code: model },
    })
    expect(await state.preference.json()).toEqual({ preferred: { ...model, variant: "" } })
  })

  it("loads the saved combo after the host module reloads", async () => {
    const state = await fixture()
    await state.save({ agent: "code", ...model, variant: "high" })
    const host = await load()

    expect(await host.handleMessage("requestModelSelections", {}, state.client, state.post)).toBe(true)

    expect(state.messages).toEqual([
      { type: "modelSelectionsLoaded", selections: { code: model }, preferred: { ...model, variant: "high" } },
    ])
  })

  it("atomically replaces the complete preferred combo without modifying the previous file", async () => {
    const prefs = { preferred: { ...other, variant: "low" } }
    const state = await fixture({ model: { plan: other } }, prefs)
    const previous = join(state.dir, "previous.json")
    await link(join(state.dir, "vscode-model.json"), previous)

    await state.save({ agent: "code", ...model, variant: "high" })

    expect(await Bun.file(previous).json()).toEqual(prefs)
    expect(await state.preference.json()).toEqual({ preferred: { ...model, variant: "high" } })
  })

  it("loads legacy model memory without inventing a preferred combo", async () => {
    const state = await fixture({ model: { code: model, bad: { providerID: 42, modelID: "invalid" } } })

    expect(await state.request()).toEqual({ type: "modelSelectionsLoaded", selections: { code: model } })
  })

  it.each([undefined, "", "high"])(
    "validates and sanitizes a loaded preferred combo with variant %j",
    async (variant) => {
      const preferred = { ...model, ...(variant === undefined ? {} : { variant }) }
      const data = { model: { plan: other } }
      const prefs = { preferred: { ...preferred, extra: "discard" } }
      const state = await fixture(data, prefs)

      expect(await state.request()).toEqual({ type: "modelSelectionsLoaded", selections: { plan: other }, preferred })
      expect(await state.file.json()).toEqual(data)
      expect(await state.preference.json()).toEqual(prefs)
    },
  )

  it.each(
    [
      null,
      true,
      42,
      "invalid",
      [],
      {},
      { providerID: "kilo" },
      { modelID: "model-a" },
      { ...model, providerID: 42 },
      { ...model, providerID: "" },
      { ...model, modelID: null },
      { ...model, modelID: "" },
      { ...model, variant: null },
      { ...model, variant: 42 },
      { ...model, variant: false },
      { ...model, variant: {} },
      { ...model, variant: [] },
    ].map((preferred) => [preferred] as const),
  )("omits invalid preferred data %j without discarding model memory", async (preferred) => {
    const state = await fixture({ model: { code: model } }, { preferred })

    expect(await state.request()).toEqual({ type: "modelSelectionsLoaded", selections: { code: model } })
  })

  it.each(["{", "null", "[]", '"invalid"'])("recovers from invalid model.json contents %s", async (raw) => {
    const preferred = { ...model, variant: "high" }
    const state = await fixture(undefined, { preferred })
    await Bun.write(state.file, raw)

    expect(await state.request()).toEqual({ type: "modelSelectionsLoaded", selections: {}, preferred })
    await state.save({ agent: "code", ...model, variant: "high" })
    expect(await state.file.json()).toEqual({ model: { code: model } })
    expect(await state.preference.json()).toEqual({ preferred })
  })

  it.each(["{", "null", "[]", '"invalid"'])("ignores invalid vscode-model.json contents %s", async (raw) => {
    const state = await fixture({ model: { code: model } })
    await Bun.write(state.preference, raw)

    expect(await state.request()).toEqual({ type: "modelSelectionsLoaded", selections: { code: model } })
    await state.save({ agent: "code", ...model, variant: "high" })
    expect(await state.preference.json()).toEqual({ preferred: { ...model, variant: "high" } })
  })

  it.each([
    { agent: "", ...model },
    { agent: 42, ...model },
    { agent: "code", modelID: "model-a" },
    { agent: "code", ...model, modelID: null },
    { agent: "code", ...model, variant: null },
    { agent: "code", ...model, variant: 42 },
  ])("ignores invalid explicit selections %j without overwriting saved preferences", async (message) => {
    const data = { ...unrelated, model: { plan: other } }
    const prefs = { preferred: { ...other, variant: "high" } }
    const state = await fixture(data, prefs)

    expect(await state.host.handleMessage("persistModelSelection", message, state.client, state.post)).toBe(true)
    expect(await state.file.json()).toEqual(data)
    expect(await state.preference.json()).toEqual(prefs)
  })

  it("returns empty memory for a missing file and creates it on an explicit save", async () => {
    const state = await fixture()

    expect(await state.request()).toEqual({ type: "modelSelectionsLoaded", selections: {} })
    expect(await state.file.exists()).toBe(false)
    expect(await state.preference.exists()).toBe(false)
    await state.save({ agent: "code", ...model })
    expect(await state.file.json()).toEqual({ model: { code: model } })
    expect(await state.preference.json()).toEqual({ preferred: { ...model, variant: "" } })
  })

  it("clears model memory and preferred together while retaining unrelated fields", async () => {
    const state = await fixture({ ...unrelated, model: { code: model } }, { preferred: { ...model, variant: "high" } })

    await state.host.reset(state.client, state.post)

    expect(await state.file.json()).toEqual({ ...unrelated, model: {} })
    expect(await state.preference.json()).toEqual({})
    expect(state.messages).toEqual([{ type: "modelSelectionsLoaded", selections: {} }])
    const host = await load()
    await host.handleMessage("requestModelSelections", {}, state.client, state.post)
    expect(state.messages.at(-1)).toEqual({ type: "modelSelectionsLoaded", selections: {} })
  })

  it("preserves every model entry during concurrent saves and keeps the latest preferred combo", async () => {
    const state = await fixture({ ...unrelated, model: { existing: other } })
    const choices = Array.from({ length: 12 }, (_, index) => ({
      agent: `mode-${index}`,
      providerID: "kilo",
      modelID: `model-${index}`,
      variant: `effort-${index}`,
    }))

    await Promise.all([
      ...choices.map((choice) => state.save(choice)),
      state.save({ agent: "mode-0", ...other, variant: "" }),
    ])

    expect(await state.file.json()).toEqual({
      ...unrelated,
      model: {
        existing: other,
        ...Object.fromEntries(
          choices.map((choice) => [choice.agent, { providerID: choice.providerID, modelID: choice.modelID }]),
        ),
        "mode-0": other,
      },
    })
    expect(await state.preference.json()).toEqual({ preferred: { ...other, variant: "" } })
  })

  it("waits for pending persistence before returning model selections", async () => {
    const state = await fixture({ model: { plan: other } })

    const saving = state.save({ agent: "code", ...model, variant: "high" })
    const loaded = await state.request()
    await saving

    expect(loaded).toEqual({
      type: "modelSelectionsLoaded",
      selections: { plan: other, code: model },
      preferred: { ...model, variant: "high" },
    })
  })

  it("orders reset with pending saves without resurrecting cleared model memory", async () => {
    const state = await fixture({ ...unrelated, model: { existing: other } })

    await Promise.all([
      state.save({ agent: "code", ...model, variant: "high" }),
      state.host.reset(state.client, state.post),
      state.save({ agent: "plan", ...other }),
    ])

    expect(await state.file.json()).toEqual({
      ...unrelated,
      model: { plan: other },
    })
    expect(await state.preference.json()).toEqual({ preferred: { ...other, variant: "" } })
  })

  it.each(["high", ""])("retains preferred effort %j after a TUI rewrite of shared model state", async (variant) => {
    const state = await fixture()
    const preferred = { ...model, variant }
    await state.save({ agent: "code", ...preferred })
    const before = await state.preference.text()
    const shared = { model: { plan: other }, recent: [other], favorite: [], variant: { "other/model-b": "low" } }

    await Bun.write(state.file, JSON.stringify(shared))
    const host = await load()
    await host.handleMessage("requestModelSelections", {}, state.client, state.post)

    expect(state.messages).toEqual([{ type: "modelSelectionsLoaded", selections: { plan: other }, preferred }])
    expect(await state.preference.text()).toBe(before)
    expect(await state.file.json()).toEqual(shared)
  })

  it("does not read preferred metadata from the shared TUI file", async () => {
    const state = await fixture({ model: { code: model }, preferred: { ...other, variant: "high" } })

    expect(await state.request()).toEqual({ type: "modelSelectionsLoaded", selections: { code: model } })
  })

  it("keeps saving to the resolved state directory during a temporary disconnect", async () => {
    const state = await fixture()
    await state.request()
    await state.host.handleMessage(
      "persistModelSelection",
      { agent: "code", ...model, variant: "high" },
      null,
      state.post,
    )
    expect(await state.preference.json()).toEqual({ preferred: { ...model, variant: "high" } })
    await state.host.handleMessage("requestModelSelections", {}, null, state.post)
    expect(state.messages.at(-1)).toEqual({
      type: "modelSelectionsLoaded",
      selections: { code: model },
      preferred: { ...model, variant: "high" },
    })
  })

  it("defers a cold-start request without a client until a ready-client retry", async () => {
    const preferred = { ...model, variant: "high" }
    const state = await fixture({ model: { code: model } }, { preferred })

    expect(await state.host.handleMessage("requestModelSelections", {}, null, state.post)).toBe(true)
    expect(state.messages).toEqual([])
    expect(await state.request()).toEqual({ type: "modelSelectionsLoaded", selections: { code: model }, preferred })
  })

  it.each(["missing", "error"])("defers loading when the CLI state path is unavailable (%s)", async (reason) => {
    const preferred = { ...model, variant: "high" }
    const state = await fixture({ model: { code: model } }, { preferred })
    const client = {
      path: {
        get: async () => {
          if (reason === "error") throw new Error("CLI is not ready")
          return { data: {} }
        },
      },
    } as unknown as KiloClient

    expect(await state.host.handleMessage("requestModelSelections", {}, client, state.post)).toBe(true)
    expect(state.messages).toEqual([])
    expect(await state.request()).toEqual({ type: "modelSelectionsLoaded", selections: { code: model }, preferred })
  })
})
