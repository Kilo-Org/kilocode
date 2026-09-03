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

    const solid = join(dirname(require.resolve("solid-js")), "solid.js")
    plugin({
      name: "solid-browser",
      setup(build) {
        build.onResolve({ filter: /^solid-js$/ }, () => ({ path: solid }))
      },
    })
    const { batch, createComputed, createRoot, createSignal } = await import("solid-js")
    const { createDialogModels } = await import("./agent-manager/new-worktree-models.ts")

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
    createRoot((dispose) => {
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
  it("persists only the saved choice and wires the effective model to display, variants, and guarded submission", () => {
    expect(src).toContain("saved: saved.model,")
    expect(src).toContain("fallback: () => session.modelForAgent(agent()),")
    expect(src).toContain("ready: provider.ready,")
    expect(src).toContain("const model = selection.model")
    expect(src).toContain("model: selection.choice(),")
    expect(src).not.toContain("model: model(),")
    expect(src).toContain("selection.select(undefined)")
    expect(src).not.toContain("setModel(")
    expect(src).toContain("selection.select(next)")
    expect(src).toContain("value={model()}")
    expect(src).toContain("const sel = model()")
    expect(src).toContain("session.variantForAgent(agent(), model())")
    expect(src).toContain("const sel = isCompare ? null : model()")
    expect(src).toContain("return selection.canSubmit(compareMode() ? modelAllocations() : undefined)")
    expect(src).toContain("if (!canSubmit()) return")
    expect(src).toContain("disabled={!canSubmit()}")
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

  it("never saves automatic initial, agent, or refreshed organization defaults", () => {
    check(`
      const { state, refresh, switchAgent, seen } = scene(undefined)
      assert.deepEqual(state.model(), y)
      assert.equal(state.choice(), undefined)
      state.select(y)
      assert.deepEqual(state.choice(), y)
      refresh({ providers: catalog(y, z), alternate: z })
      batch(() => {
        switchAgent("plan")
        state.select(undefined)
      })
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
