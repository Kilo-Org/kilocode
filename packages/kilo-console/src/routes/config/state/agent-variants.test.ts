import { describe, expect, test } from "bun:test"
import {
  variantChoices,
  variantCurrent,
  variantDirty,
  variantEdit,
  variantModel,
  variantParent,
  variantPersist,
  variantShown,
  variantState,
  variantValue,
} from "./agent-variant"
import type { AgentItem } from "./agents"

const agent = {
  name: "reviewer",
  mode: "subagent",
  native: true,
  source: "organization",
  permission: [],
  options: {},
} satisfies AgentItem

const SCRIPT = `
  globalThis.window = { fetch: globalThis.fetch }

  const { createComponent, createRoot } = await import("solid-js")
  const { ConfigContext } = await import("../../../context/config.tsx")
  const { useAgentBuilder } = await import("./agents.ts")

  const item = ${JSON.stringify(agent)}
  const result = {}

  createRoot(() =>
    createComponent(ConfigContext.Provider, {
      value: {
        data: () => ({
          agents: [item],
          effective: { provider: {} },
          modelState: { favorite: [] },
          providers: { connected: [], all: [] },
          tools: [],
          toolDetails: [],
          overlay: { collections: { agent: [] } },
        }),
        query: () => ({ scope: "global" }),
        saving: () => undefined,
        failure: () => undefined,
        target: () => ({ scope: "global" }),
        fail: () => {},
        run: () => {},
        save: () => {},
        patch: () => {},
        unset: () => {},
        tui: () => {},
      },
      get children() {
        result.state = useAgentBuilder(() => "reviewer")
      },
    }),
  )

  if (result.state?.variantEdit() !== false) {
    throw new Error("organization-native agent variant editing was allowed: " + result.state?.variantEdit())
  }
`

describe("agent variant settings", () => {
  test("builds inherit, default, and provider variant choices", () => {
    expect(variantChoices(["high", "max"])).toEqual([
      { value: "", label: "Inherit" },
      { value: "default", label: "Model default" },
      { value: "high", label: "high" },
      { value: "max", label: "max" },
    ])
  })

  test("keeps configured variants from overlay before effective agent fallback", () => {
    expect(variantValue({ cfg: "high", effective: "max" })).toBe("high")
    expect(variantValue({ cfg: undefined, effective: "max" })).toBe("max")
    expect(variantValue({ cfg: undefined, effective: undefined })).toBe("")
  })

  test("falls back to the effective agent model before the workspace model", () => {
    expect(variantModel({ draft: "", agent: "anthropic/claude-sonnet", workspace: "openai/gpt-5" })).toBe(
      "anthropic/claude-sonnet",
    )
    expect(variantModel({ draft: "anthropic/claude-opus", agent: "anthropic/claude-sonnet", workspace: "openai/gpt-5" })).toBe(
      "anthropic/claude-opus",
    )
    expect(variantModel({ draft: "", agent: "", workspace: "openai/gpt-5" })).toBe("openai/gpt-5")
  })

  test("uses the broader agent model only in project scope", () => {
    expect(variantParent({ scope: "project", global: "anthropic/claude-sonnet" })).toBe("anthropic/claude-sonnet")
    expect(variantParent({ scope: "global", global: "anthropic/claude-sonnet" })).toBe("")
  })

  test("skips redundant writes when the displayed variant is unchanged", () => {
    expect(variantDirty({ next: "high", saved: "high" })).toBe(false)
    expect(variantDirty({ next: "default", saved: "high" })).toBe(true)
    expect(variantDirty({ next: "", saved: "high" })).toBe(true)
  })

  test("collapses unsupported variants against the current model", () => {
    expect(variantCurrent({ current: "high", saved: "high", variants: ["max"] })).toBe("")
    expect(variantCurrent({ current: "max", saved: "high", variants: ["max"] })).toBe("max")
    expect(variantCurrent({ current: "default", saved: "high", variants: [] })).toBe("default")
  })

  test("keeps explicit inherit distinct from fallback display", () => {
    expect(variantShown({ cleared: true, current: "", saved: "high", variants: ["high"] })).toBe("")
    expect(variantShown({ cleared: false, current: "", saved: "high", variants: ["high"] })).toBe("high")
  })

  test("preserves unchanged unsupported variants when saving", () => {
    expect(variantPersist({ cleared: false, current: "high", saved: "high", variants: ["max"] })).toBe("high")
    expect(variantPersist({ cleared: true, current: "", saved: "high", variants: ["max"] })).toBe("")
  })

  test("uses scope-local data when seeding the builder variant", () => {
    expect(variantState({ scope: "project", global: "max", local: "high", effective: "high" })).toEqual({
      stored: "high",
      shown: "high",
    })
    expect(variantState({ scope: "global", global: "max", local: "high", effective: "high" })).toEqual({
      stored: "max",
      shown: "max",
    })
  })

  test("allows project overrides for inherited agents", () => {
    expect(variantEdit({ scope: "project", inherited: true, editable: true, source: "global" })).toBe(true)
    expect(variantEdit({ scope: "global", inherited: true, editable: true, source: "global" })).toBe(false)
    expect(variantEdit({ scope: "project", inherited: true, editable: false, source: "global" })).toBe(false)
  })

  test("allows native agent variant overrides", () => {
    expect(variantEdit({ scope: "project", native: true })).toBe(true)
    expect(variantEdit({ scope: "global", native: true, source: "system", editable: false })).toBe(true)
    expect(variantEdit({ scope: "global", native: true, source: "organization", editable: false })).toBe(false)
  })

  test("locks organization-native agents when their source is top-level", () => {
    const result = Bun.spawnSync(["bun", "--conditions=browser", "-e", SCRIPT], {
      cwd: import.meta.dir,
      stderr: "pipe",
    })

    expect(result.exitCode, result.stderr.toString()).toBe(0)
  })
})
