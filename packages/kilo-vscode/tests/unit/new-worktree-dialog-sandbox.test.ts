import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const path = join(__dirname, "..", "..", "webview-ui", "agent-manager", "NewWorktreeDialog.tsx")
const providerPath = join(__dirname, "..", "..", "src", "KiloProvider.ts")
const src = readFileSync(path, "utf8")
const provider = readFileSync(providerPath, "utf8")

describe("NewWorktreeDialog sandbox toggle", () => {
  it("uses the persisted default and only sends explicit modal overrides", () => {
    expect(src).toContain('vscode.postMessage({ type: "requestSandboxDefault", requestID: sandboxRequestID })')
    expect(src).toContain('if (message.type !== "sandboxDefaultStatus") return')
    expect(src).toContain("if (message.requestID !== sandboxRequestID) return")
    expect(src).toContain("setSandbox(message.enabled)")
    expect(src).toContain("setSandboxOverride(next === sandboxDefault() ? undefined : next)")
    expect(src).toContain(
      'vscode.postMessage({ type: "setSandboxDefault", enabled: next, requestID: sandboxRequestID })',
    )
    expect(src).toContain("sandbox: sandboxVisible() ? sandboxOverride() : undefined")
    expect(src).toContain("const { config, globalConfig, features, settings } = useConfig()")
    expect(src).toContain(
      "const sandboxVisible = () => features().sandboxControls && globalConfig().sandbox?.enabled === true",
    )
    expect(provider).toContain("await this.fetchAndSendSandboxDefault(message.contextDirectory, message.requestID)")
    expect(src).not.toContain("createSignal(config().sandbox?.enabled === true)")
    expect(src).not.toContain("visible as isSandboxVisible")
  })
})

describe("NewWorktreeDialog base branch", () => {
  it("sends the displayed default base branch when advanced options stay closed", () => {
    expect(src).toContain("const effectiveBaseBranch = () => baseBranch() ?? defaultBranch()")
    expect(src).toContain("baseBranch: effectiveBaseBranch(),")
    expect(src).not.toContain("baseBranch: advanced ? (baseBranch() ?? undefined) : undefined")
  })
})

// Evaluates each scenario with shared fixtures and the real model helpers in a fresh Bun process.
// Isolated module loading forces Solid's browser build instead of its non-reactive SSR build.
// The child's exit code propagates scenario assertion failures to the calling test.
function check(code: string) {
  const cwd = join(__dirname, "..", "..", "webview-ui")
  const script = `
    import assert from "node:assert/strict"
    import { dirname, join } from "node:path"
    import { plugin } from "bun"
    import { isModelValid } from "./src/context/provider-utils.ts"
    import { toggleModel, setAllocationVariant } from "./agent-manager/multi-model-utils.ts"
    import { DEFAULT_VARIANT } from "./src/context/session-variant-store.ts"

    const solid = join(dirname(require.resolve("solid-js")), "solid.js")
    plugin({
      name: "solid-browser",
      setup(build) {
        build.onResolve({ filter: /^solid-js$/ }, () => ({ path: solid }))
      },
    })
    const { batch, createComputed, createRoot, createSignal, onCleanup } = await import("solid-js")
    const { createDialogModels, createDialogPreferences } = await import("./agent-manager/new-worktree-models.ts")

    const x = { providerID: "kilo", modelID: "x" }
    const y = { providerID: "kilo", modelID: "y" }
    const z = { providerID: "kilo", modelID: "z" }
    const free = { providerID: "kilo", modelID: "kilo-auto/free" }
    const external = { providerID: "external", modelID: "custom" }
    const catalog = (...models) => Object.fromEntries(
      [...new Set(models.map((model) => model.providerID))].map((id) => [id, {
        id,
        name: id,
        models: Object.fromEntries(models.filter((model) => model.providerID === id).map((model) => [
          model.modelID,
          { id: model.modelID, name: model.modelID, variants: { high: {} } },
        ])),
      }]),
    )
    function scene(saved, initial = { providers: catalog(x, y), fallback: y, ready: true, connected: [] }) {
      const [snapshot, refresh] = createSignal(initial)
      const [agent, switchAgent] = createSignal("code")
      const state = createDialogModels({
        saved,
        ready: () => snapshot().ready,
        valid: (value) => isModelValid(snapshot().providers, snapshot().connected, value),
        variants: (value) => Object.keys(snapshot().providers[value.providerID]?.models[value.modelID]?.variants ?? {}),
        fallback: () => agent() === "code" ? snapshot().fallback : snapshot().alternate ?? null,
      })
      const seen = []
      createComputed(() => seen.push(state.model()))
      return { state, snapshot, refresh: (update) => refresh((current) => ({ ...current, ...update })), switchAgent, seen }
    }

    // Import the same reactive preference controller used by the dialog, without rendering unrelated UI.
    function dialog(saved = {}, initial = { providers: catalog(x, y), fallback: y, alternate: y, ready: true, connected: [] }) {
      const result = createRoot((dispose) => {
        const [snapshot, refresh] = createSignal(initial)
        const state = createDialogPreferences({
          saved,
          agent: saved.agent ?? "code",
          ready: () => snapshot().ready,
          valid: (value) => isModelValid(snapshot().providers, snapshot().connected, value),
          variants: (value) => Object.keys(snapshot().providers[value.providerID]?.models[value.modelID]?.variants ?? {}),
          fallback: (name) => name === "code" ? snapshot().fallback : snapshot().alternate ?? null,
          effort: (name, model) => model ? snapshot().efforts?.[name + "/" + model.modelID] ?? snapshot().efforts?.[name] : undefined,
        })
        return {
          ...state,
          pick: state.selectModel,
          choose: state.selectVariant,
          clear: () => state.selectVariant(DEFAULT_VARIANT),
          reset: state.clear,
          cached: state.saved,
          refresh: (update) => refresh((current) => ({ ...current, ...update })), dispose,
        }
      })
      onCleanup(result.dispose)
      return result
    }
    await createRoot(async (dispose) => {
      try {
        ${code}
      } finally {
        dispose()
      }
    })
  `
  const child = Bun.spawnSync([process.execPath, "--conditions=browser", "-e", script], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0)
}

describe("NewWorktreeDialog models", () => {
  it("caches only explicit model choices and guards submission using the available model", () => {
    check(`
      const state = dialog()
      await Promise.resolve()
      assert.deepEqual(state.model(), y)
      assert.deepEqual(state.cached(), { agent: "code", model: undefined, variant: undefined })
      assert.equal(state.selection.canSubmit(), true)
      state.refresh({ providers: {}, ready: false })
      assert.equal(state.model(), null)
      assert.equal(state.cached().model, undefined)
      assert.equal(state.selection.canSubmit(), false)
      state.refresh({ providers: catalog(x, y), ready: true })
      state.pick("kilo", "x")
      assert.deepEqual(state.model(), x)
      assert.deepEqual(state.cached(), { agent: "code", model: x, variant: "" })
      assert.equal(state.selection.canSubmit(), true)
    `)
  })

  it("keeps saved X through reactive X to Y to X catalog changes", () => {
    check(`
      const { state, refresh, seen } = scene(x)
      assert.deepEqual(state.model(), x)
      refresh({ providers: catalog(y) })
      assert.deepEqual(state.model(), y)
      assert.deepEqual(state.choice(), x)
      assert.equal(state.canSubmit(), true)
      refresh({ providers: catalog(x, y) })
      assert.deepEqual(state.choice(), x)
      assert.deepEqual(seen, [x, y, x])
    `)
  })

  it("keeps an explicit model and effort per agent through mode switches", () => {
    check(`
      const state = dialog({ model: x, variant: "high" }, {
        providers: catalog(x, y), fallback: x, alternate: y, ready: true, connected: [],
      })
      await Promise.resolve()
      assert.deepEqual(state.model(), x)
      assert.equal(state.effectiveVariant(), "high")
      state.selectAgent("plan")
      assert.deepEqual(state.model(), y)
      assert.equal(state.effectiveVariant(), undefined)
      state.selectAgent("code")
      assert.deepEqual(state.model(), x)
      assert.equal(state.effectiveVariant(), "high")
      assert.deepEqual(state.cached().model, x)
      assert.equal(state.cached().variant, "high")
    `)
  })

  it("keeps picks per agent so switching modes and back restores the choice", () => {
    check(`
      const state = dialog({}, {
        providers: catalog(x, y, z), fallback: x, alternate: z, ready: true, connected: [],
      })
      assert.deepEqual(state.model(), x)
      state.pick("kilo", "y")
      state.selectAgent("plan")
      assert.deepEqual(state.model(), z)
      state.selectAgent("code")
      assert.deepEqual(state.model(), y)
      assert.deepEqual(state.cached().model, y)
    `)
  })

  it.each([
    [undefined, "high"],
    ["", ""],
  ])("uses the target model preference only when outgoing effort is %s", (value, expected) => {
    check(`
      const state = dialog({ model: x, variant: ${JSON.stringify(value)} }, {
        providers: catalog(x, y), fallback: x, ready: true, connected: [], efforts: { "code/y": "high" },
      })
      state.pick("kilo", "y")
      assert.equal(state.variant(), ${JSON.stringify(expected)})
    `)
  })

  it("switches to the target agent's default when it has no dialog pick", () => {
    check(`
      const state = dialog({}, {
        providers: catalog(x, y), fallback: x, alternate: y, ready: true, connected: [],
        efforts: { code: "high" },
      })
      await Promise.resolve()
      assert.deepEqual(state.model(), x)
      assert.equal(state.effectiveVariant(), "high")
      state.selectAgent("plan")
      assert.deepEqual(state.model(), y)
      assert.equal(state.effectiveVariant(), undefined)
      state.selectAgent("code")
      assert.deepEqual(state.model(), x)
      assert.equal(state.effectiveVariant(), "high")
      assert.equal(state.selection.choice(), undefined)
      assert.equal(state.cached().model, undefined)
    `)
  })

  it("resolves the target agent's configured effort when it has no pick", () => {
    check(`
      const providers = catalog(x)
      providers.kilo.models.x.variants = { low: {}, high: {} }
      const state = dialog({}, {
        providers, fallback: x, alternate: x, ready: true, connected: [],
        efforts: { code: "high", plan: "low" },
      })
      await Promise.resolve()
      state.selectAgent("plan")
      assert.equal(state.effectiveVariant(), "low")
      assert.equal(state.variant(), undefined)
      state.selectAgent("code")
      assert.equal(state.effectiveVariant(), "high")
      assert.equal(state.variant(), undefined)
    `)
  })

  it.each(["", "high"])("keeps inherited raw effort %s through catalog changes", (value) => {
    check(`
      const providers = catalog(x)
      providers.kilo.models.x.variants = { low: {} }
      const state = dialog({}, {
        providers, fallback: x, alternate: x, ready: true, connected: [],
        efforts: { code: ${JSON.stringify(value)} },
      })
      await Promise.resolve()
      assert.equal(state.variant(), undefined)
      assert.equal(state.effectiveVariant(), ${value === "" ? "undefined" : '"low"'})
      state.refresh({ providers: catalog(x) })
      assert.equal(state.effectiveVariant(), ${value === "" ? "undefined" : '"high"'})
    `)
  })

  it("restores the saved effort after an empty catalog refresh and reopening", () => {
    check(`
      const state = dialog({ model: x, variant: "high" })
      await Promise.resolve()
      state.refresh({ providers: {}, ready: false })
      assert.equal(state.model(), null)
      assert.equal(state.effectiveVariant(), undefined)
      assert.equal(state.cached().variant, "high")
      const reopened = dialog(state.cached(), { providers: {}, fallback: y, ready: false, connected: [] })
      await Promise.resolve()
      assert.equal(reopened.cached().variant, "high")
      reopened.refresh({ providers: catalog(x, y), ready: true })
      assert.deepEqual(reopened.model(), x)
      assert.equal(reopened.effectiveVariant(), "high")
    `)
  })

  it("does not overwrite saved effort with a temporary catalog fallback's nearest effort", () => {
    check(`
      const state = dialog({ model: x, variant: "high" })
      await Promise.resolve()
      const providers = catalog(y)
      providers.kilo.models.y.variants = { low: {} }
      state.refresh({ providers })
      assert.deepEqual(state.model(), y)
      assert.equal(state.effectiveVariant(), "low")
      assert.equal(state.cached().variant, "high")
      state.selectAgent("plan")
      state.refresh({ providers: catalog(x, y) })
      assert.deepEqual(state.model(), y)
      state.selectAgent("code")
      assert.deepEqual(state.model(), x)
      assert.equal(state.effectiveVariant(), "high")
    `)
  })

  it("carries the saved effort when explicitly picking a model during a temporary fallback", () => {
    check(`
      const state = dialog({ model: x, variant: "high" })
      await Promise.resolve()
      const providers = catalog(y, z)
      providers.kilo.models.y.variants = { low: {} }
      providers.kilo.models.z.variants = { low: {}, high: {} }
      state.refresh({ providers })
      assert.equal(state.effectiveVariant(), "low")
      state.pick("kilo", "z")
      assert.deepEqual(state.model(), z)
      assert.equal(state.effectiveVariant(), "high")
    `)
  })

  it("keeps an explicit Default per agent across mode switches", () => {
    check(`
      const state = dialog({}, {
        providers: catalog(x, y), fallback: x, alternate: y, ready: true, connected: [],
        efforts: { code: "high", plan: "high" },
      })
      await Promise.resolve()
      state.clear()
      assert.equal(state.variant(), "")
      assert.deepEqual(state.selection.choice(), x)
      state.selectAgent("plan")
      assert.equal(state.effectiveVariant(), "high")
      state.selectAgent("code")
      assert.equal(state.effectiveVariant(), undefined)
      assert.equal(state.variant(), "")
      const reopened = dialog(state.cached())
      await Promise.resolve()
      assert.deepEqual(reopened.model(), x)
      assert.equal(reopened.effectiveVariant(), undefined)
      assert.equal(reopened.variant(), "")
    `)
  })

  it("uses the agent default and variant preference when no pick is saved", () => {
    check(`
      const state = dialog({}, {
        providers: catalog(x, y), fallback: x, ready: true, connected: [], efforts: { "code/y": "high" },
      })
      assert.deepEqual(state.model(), x)
      assert.equal(state.effectiveVariant(), undefined)
      const other = dialog({ agent: "plan" }, {
        providers: catalog(x, y), fallback: x, alternate: y, ready: true, connected: [], efforts: { "plan/y": "high" },
      })
      assert.deepEqual(other.model(), y)
      assert.equal(other.effectiveVariant(), "high")
    `)
  })

  it("clears the saved model and effort after submit so reopening starts from config", () => {
    check(`
      const state = dialog()
      await Promise.resolve()
      state.pick("kilo", "x")
      assert.deepEqual(state.cached().model, x)
      state.reset()
      assert.deepEqual(state.cached(), { agent: "code", model: undefined, variant: undefined })
      assert.deepEqual(state.model(), y)
    `)
  })

  it("pins a model on explicit effort selection and keeps the choice through refreshes", () => {
    check(`
      const state = dialog()
      await Promise.resolve()
      state.choose("high")
      assert.deepEqual(state.selection.choice(), y)
      state.refresh({ fallback: x })
      assert.deepEqual(state.model(), y)
      const allocations = setAllocationVariant(toggleModel(new Map(), "kilo", "x", "X"), "kilo", "x", "high")
      assert.equal(state.selection.canSubmit(allocations), true)
      state.selectAgent("plan")
      state.refresh({ ready: false })
      state.refresh({ ready: true })
      state.selectAgent("code")
      assert.deepEqual(state.selection.choice(), y)
      assert.equal(state.variant(), "high")
    `)
  })

  it("restores an initially unavailable cached X without replacing it with Y", () => {
    check(`
      const { state, refresh } = scene(x, { providers: catalog(y), fallback: y, ready: true, connected: [] })
      assert.deepEqual(state.model(), y)
      assert.deepEqual(state.choice(), x)
      const reopened = scene(state.choice(), { providers: catalog(y), fallback: y, ready: true, connected: [] })
      assert.deepEqual(reopened.state.model(), y)
      reopened.refresh({ providers: catalog(x, y) })
      assert.deepEqual(reopened.state.model(), x)
      state.select(y)
      refresh({ providers: catalog(x, y) })
      assert.deepEqual(state.model(), y)
      assert.deepEqual(state.choice(), y)
    `)
  })

  it("follows the target agent's default on mode switch without saving a choice", () => {
    check(`
      const { state, refresh, switchAgent, seen } = scene(undefined)
      assert.deepEqual(state.model(), y)
      assert.equal(state.choice(), undefined)
      refresh({ providers: catalog(y, z), alternate: z })
      switchAgent("plan")
      assert.deepEqual(state.model(), z)
      assert.equal(state.choice(), undefined)
      refresh({ providers: catalog(x), alternate: x })
      assert.deepEqual(seen, [y, z, x])
      assert.equal(state.choice(), undefined)
    `)
  })

  it("retains explicit legacy free and connected external models", () => {
    check(`
      const initial = { providers: catalog(free, external, y), fallback: y, ready: true, connected: ["external"] }
      assert.deepEqual(scene(free, initial).state.model(), free)
      const { state, refresh } = scene(external, initial)
      assert.deepEqual(state.model(), external)
      refresh({ ready: false, providers: catalog(external) })
      assert.deepEqual(state.model(), external)
      assert.equal(state.canSubmit(), true)
      refresh({ ready: true, providers: catalog(external, y), connected: [] })
      assert.deepEqual(state.model(), y)
      assert.deepEqual(state.choice(), external)
      refresh({ connected: ["external"] })
      assert.deepEqual(state.model(), external)
    `)
  })

  it("keeps external-only comparisons usable while a Kilo catalog refresh blocks mixed comparisons", () => {
    check(`
      const { state, refresh } = scene(x, {
        providers: catalog(x, external, y), fallback: y, ready: true, connected: ["external"],
      })
      const solo = toggleModel(new Map(), "external", "custom", "Custom")
      const mixed = toggleModel(solo, "kilo", "x", "X")
      const original = [...mixed.values()].map((entry) => ({ ...entry }))
      assert.equal(state.canSubmit(solo), true)
      assert.equal(state.canSubmit(mixed), true)
      refresh({ ready: false, providers: catalog(external), fallback: null })
      assert.equal(state.model(), null)
      assert.equal(state.canSubmit(), false)
      assert.equal(state.canSubmit(solo), true)
      assert.equal(state.canSubmit(mixed), false)
      assert.deepEqual(state.choice(), x)
      assert.deepEqual([...mixed.values()], original)
      refresh({ ready: true, providers: catalog(x, external, y), fallback: y })
      assert.deepEqual(state.model(), x)
      assert.equal(state.canSubmit(mixed), true)
    `)
  })

  it("blocks pending, empty, and invalid fallback catalogs without clearing a saved choice", () => {
    check(`
      const { state, refresh, seen } = scene(x)
      refresh({ ready: false })
      assert.equal(state.model(), null)
      assert.equal(state.canSubmit(), false)
      assert.deepEqual(state.choice(), x)
      refresh({ ready: true, providers: {} })
      assert.equal(state.model(), null)
      assert.equal(state.canSubmit(), false)
      refresh({ providers: catalog(y), fallback: x })
      assert.equal(state.canSubmit(), false)
      refresh({ fallback: null })
      assert.equal(state.canSubmit(), false)
      refresh({ providers: catalog(x) })
      assert.deepEqual(seen, [x, null, x])
      assert.deepEqual(state.choice(), x)
      assert.equal(state.canSubmit(), true)
    `)
  })

  it("blocks invalid comparison models and variants without rewriting explicit allocations", () => {
    check(`
      const { state, refresh } = scene(x)
      const first = toggleModel(new Map(), "kilo", "x", "X")
      const allocations = toggleModel(first, "kilo", "y", "Y")
      const original = [...allocations.values()].map((entry) => ({ ...entry }))
      const [allowed, setAllowed] = createSignal(false)
      createComputed(() => setAllowed(state.canSubmit(allocations)))
      assert.equal(allowed(), true)
      refresh({ providers: catalog(y) })
      assert.deepEqual(state.model(), y)
      assert.equal(allowed(), false)
      assert.deepEqual([...allocations.values()], original)
      refresh({ providers: catalog(x, y) })
      assert.equal(allowed(), true)
      refresh({ ready: false })
      assert.equal(allowed(), false)
      refresh({ ready: true })
      const variants = setAllocationVariant(allocations, "kilo", "x", "high")
      assert.equal(state.canSubmit(variants), true)
      refresh({ providers: { kilo: { id: "kilo", name: "kilo", models: {
        x: { id: "x", name: "X", variants: { low: {} } },
        y: { id: "y", name: "Y" },
      } } } })
      assert.equal(state.canSubmit(variants), false)
      assert.equal(variants.get("kilo/x").variant, "high")
      assert.equal(state.canSubmit(new Map()), false)
      const disconnected = toggleModel(new Map(), "external", "custom", "Custom")
      refresh({ providers: catalog(external), connected: [] })
      assert.equal(state.canSubmit(disconnected), false)
      refresh({ connected: ["external"] })
      assert.equal(state.canSubmit(disconnected), true)
    `)
  })
})
