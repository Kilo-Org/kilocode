import { describe, expect, it } from "bun:test"
import path from "node:path"
import { Project, SyntaxKind } from "ts-morph"

const root = path.resolve(import.meta.dir, "../..")
const project = new Project({ useInMemoryFileSystem: true })
const source = project.createSourceFile(
  "ModelSelector.tsx",
  await Bun.file(path.join(root, "webview-ui/src/components/shared/ModelSelector.tsx")).text(),
)
const body = source
  .getVariableDeclarationOrThrow("ModelSelectorBase")
  .getInitializerIfKindOrThrow(SyntaxKind.ArrowFunction)
  .getBody()
  .asKindOrThrow(SyntaxKind.Block)
const helpers = source
  .getStatements()
  .filter((statement) => statement.getStart() < source.getVariableStatementOrThrow("ModelSelectorBase").getStart())
  .filter(
    (statement) => statement.isKind(SyntaxKind.VariableStatement) || statement.isKind(SyntaxKind.FunctionDeclaration),
  )
  .map((statement) => statement.getText())
  .join("\n")
// Run the component's real reactive setup and handlers, without compiling its JSX or loading the renderer graph.
const setup = new Bun.Transpiler({ loader: "ts" }).transformSync(`
  ${helpers}
  function selector(props) {
    ${body
      .getStatements()
      .filter((statement) => !statement.isKind(SyntaxKind.ReturnStatement))
      .map((statement) => statement.getText())
      .join("\n")}
    return { open, setOpen, search, setSearch, activeModel, hasProviders, canOpen, triggerLabel,
      visibleModels, filtered, favoriteKeys, favoriteModels, groups, rows, nodes,
      nodeMap, nodeIndex, rowMap, mounted, selectedKey, previewModel, handleKeyDown, toggleGroup }
  }
`)

function check(code: string) {
  const script = `
    import assert from "node:assert/strict"
    import { dirname, join } from "node:path"
    const solid = join(dirname(require.resolve("solid-js")), "solid.js")
    const { createRoot, createSignal, createMemo, createEffect, createUniqueId, createSelector, onCleanup, untrack } = await import(solid)
    const { KILO_GATEWAY_ID, isSmall, providerSortKey, isFree, isDataCollectedModel, hasByok, isAuto,
      freeDataLabel, autoSummary, buildTriggerLabel, sanitizeName, mostUsedModels, rankModelSearch } = await import("./webview-ui/src/components/shared/model-selector-utils.ts")
    const { isEnterKeyCommitNotIme } = await import("./webview-ui/src/utils/ime-enter.ts")
    const window = new EventTarget()
    const requestAnimationFrame = () => 1
    const cancelAnimationFrame = () => {}
    const SessionContext = {}
    const language = { t: (key) => key }
    const vscode = { getModelSelectorExpanded: () => true, setModelSelectorExpanded: () => {} }
    let provider
    let session
    const useProvider = () => provider
    const useLanguage = () => language
    const useVSCode = () => vscode
    const useContext = () => session
    ${setup}
    const model = (id, providerID = "kilo") => ({ id, name: id[0].toUpperCase() + id.slice(1), providerID, providerName: providerID })
    function scene(opts = {}) {
      const stats = { filters: 0, favorites: 0, usage: 0, recent: 0 }
      function catalog(items) {
        Object.defineProperty(items, "filter", { value(...args) {
          stats.filters++
          return Array.prototype.filter.apply(this, args)
        } })
        return items
      }
      const [models, setModels] = createSignal(catalog([model("alpha"), model("bravo"), model("charlie", "anthropic"), model("hidden", "offline"), model("kilo-auto/small")]))
      const [connected, setConnected] = createSignal(["anthropic"])
      const [value, setValue] = createSignal({ providerID: "kilo", modelID: "alpha" })
      const [override, setOverride] = createSignal()
      const [favorites, setFavorites] = createSignal([{ providerID: "kilo", modelID: "alpha" }])
      const [usage, setUsage] = createSignal({ "kilo/bravo": { count: 7, lastUsed: 10 } })
      const [recent, setRecent] = createSignal([])
      provider = { models, connected, findModel: (selection) => models().find((item) => item.providerID === selection?.providerID && item.id === selection?.modelID), kiloUnavailable: () => false }
      session = {
        favoriteModels: () => { stats.favorites++; return favorites() },
        modelUsageHistory: () => { stats.usage++; return usage() },
        recentModels: () => { stats.recent++; return recent() },
      }
      const props = { get value() { return value() }, get models() { return override() }, allowClear: true, ...opts,
        onSelect: (providerID, modelID) => setValue({ providerID, modelID }) }
      const state = createRoot((dispose) => ({ ...selector(props), dispose }))
      return { ...state, stats, value, setValue, setConnected, setOverride, setFavorites, setUsage, setRecent,
        refresh: (items) => setModels(catalog(items)) }
    }
    const flush = async () => { await Promise.resolve(); await Promise.resolve() }
    const key = (state, value) => state.handleKeyDown({ key: value, preventDefault() {} })
    const empty = (state) => {
      for (const name of ["visibleModels", "filtered", "favoriteModels", "groups", "rows", "nodes", "mounted"]) assert.deepEqual(state[name](), [], name)
      for (const name of ["favoriteKeys", "nodeMap", "nodeIndex", "rowMap"]) assert.equal(state[name]().size, 0, name)
      assert.equal(state.previewModel(), null)
    }
    ${code}
  `
  const child = Bun.spawnSync([process.execPath, "--conditions=browser", "-e", script], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  })
  expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0)
}

describe("ModelSelector closed popup work", () => {
  it("keeps trigger state reactive without catalog filtering or personalization work while closed", () => {
    check(`
      const state = scene()
      try {
        await flush()
        empty(state)
        assert.equal(state.triggerLabel(), "Alpha")
        assert.equal(state.canOpen(), true)
        assert.deepEqual(state.stats, { filters: 0, favorites: 0, usage: 0, recent: 0 })
        state.setValue({ providerID: "kilo", modelID: "bravo" })
        state.setFavorites([{ providerID: "kilo", modelID: "bravo" }])
        state.setUsage({ "kilo/alpha": { count: 9, lastUsed: 20 } })
        state.setRecent([{ providerID: "kilo", modelID: "bravo" }])
        state.refresh([model("bravo"), model("delta")])
        assert.equal(state.triggerLabel(), "Bravo")
        empty(state)
        assert.deepEqual(state.stats, { filters: 0, favorites: 0, usage: 0, recent: 0 })
      } finally { state.dispose() }
    `)
  })

  it("preserves availability rules, constrained catalogs, and clearing an unavailable selection", () => {
    check(`
      const state = scene({ allowClear: false })
      try {
        await flush()
        state.setValue(null)
        state.refresh([model("hidden", "offline"), model("kilo-auto/small")])
        assert.equal(state.hasProviders(), false)
        assert.equal(state.canOpen(), false)
        assert.equal(state.triggerLabel(), "dialog.model.noProviders")
        state.setConnected(["offline"])
        assert.equal(state.hasProviders(), true)
        assert.equal(state.canOpen(), true)
        state.setOverride([])
        assert.equal(state.canOpen(), false)
        state.setOverride([model("hidden", "offline")])
        assert.equal(state.canOpen(), true)
        empty(state)
        assert.equal(state.stats.filters, 0)
        const small = scene({ includeAutoSmall: true })
        small.refresh([model("kilo-auto/small")])
        assert.equal(small.canOpen(), true)
        small.dispose()
        const clear = scene()
        clear.refresh([])
        assert.equal(clear.hasProviders(), false)
        assert.equal(clear.canOpen(), true)
        clear.setValue(null)
        assert.equal(clear.canOpen(), false)
        clear.dispose()
      } finally { state.dispose() }
    `)
  })

  it("restores favorites, usage, search, preview, and keyboard selection on open and reopen", () => {
    check(`
      const state = scene()
      try {
        await flush()
        state.setOpen(true)
        await flush()
        assert.ok(state.stats.filters > 0)
        assert.deepEqual(state.groups().map((group) => group.key), ["favorites", "most-used", "kilo", "anthropic"])
        assert.equal(state.selectedKey(), "favorite:kilo/alpha")
        assert.equal(state.previewModel()?.id, "alpha")
        state.toggleGroup("favorites")
        assert.equal(state.nodeMap().has("favorite:kilo/alpha"), false)
        key(state, "ArrowRight")
        assert.equal(state.nodeMap().has("favorite:kilo/alpha"), true)
        key(state, "ArrowRight")
        assert.equal(state.selectedKey(), "favorite:kilo/alpha")
        state.setSearch("bravo")
        assert.equal(state.selectedKey(), "model:kilo/bravo")
        assert.equal(state.previewModel()?.id, "bravo")
        assert.equal(state.value().modelID, "alpha")
        key(state, "Enter")
        assert.equal(state.value().modelID, "bravo")
        assert.equal(state.open(), false)
        empty(state)
        const stats = { ...state.stats }
        state.setFavorites([{ providerID: "kilo", modelID: "bravo" }])
        state.setUsage({ "kilo/alpha": { count: 9, lastUsed: 20 } })
        state.refresh([model("alpha"), model("bravo"), model("delta")])
        assert.deepEqual(state.stats, stats)
        state.setOpen(true)
        await flush()
        assert.equal(state.search(), "")
        assert.equal(state.selectedKey(), "favorite:kilo/bravo")
        assert.equal(state.previewModel()?.id, "bravo")
        assert.equal(state.nodeMap().has("model:kilo/delta"), true)
        assert.deepEqual(state.groups().find((group) => group.key === "most-used").rows.map((row) => row.model.id), ["alpha"])
        key(state, "Escape")
        assert.equal(state.value().modelID, "bravo")
        empty(state)
      } finally { state.dispose() }
    `)
  })
})
