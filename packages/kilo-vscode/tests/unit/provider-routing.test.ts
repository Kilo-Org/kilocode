import { describe, expect, it } from "bun:test"
import {
  ROUTING_KEYS,
  modelRouting,
  routingClear,
  routingOverriddenByProject,
  routingPartial,
  routingUnsetPaths,
  routingValue,
} from "../../src/shared/provider-routing"
import { configUnsetPaths, pruneConfigSet } from "../../webview-ui/src/utils/config-utils"
import { routable } from "../../webview-ui/src/components/shared/model-selector-utils"

const pid = "kilo"
const mid = "z-ai/glm-4.6"

// Hand-configured sibling routing preferences that must survive every UI write.
const siblings = { data_collection: "deny", sort: "price" }

function routingNode(config: unknown): Record<string, unknown> {
  const node = (config as { provider: Record<string, { models: Record<string, { options: { provider: unknown } }> }> })
    .provider[pid].models[mid].options.provider
  return node as Record<string, unknown>
}

describe("provider routing persistence", () => {
  it("keeps both entry points on the same owned-field list", () => {
    expect(Object.keys(routingValue("x")).sort()).toEqual([...ROUTING_KEYS].sort())
    expect(Object.keys(routingClear()).sort()).toEqual([...ROUTING_KEYS].sort())
    expect(
      routingUnsetPaths(pid, mid)
        .map((path) => path[path.length - 1])
        .sort(),
    ).toEqual([...ROUTING_KEYS].sort())
  })

  it("chat path: unset paths target only the owned fields of the one model", () => {
    for (const path of routingUnsetPaths(pid, mid)) {
      expect(path.slice(0, 6)).toEqual(["provider", pid, "models", mid, "options", "provider"])
    }
    expect(routingUnsetPaths(pid, mid)).toHaveLength(ROUTING_KEYS.length)
  })

  it("settings path: clearing to Auto unsets only the owned fields", () => {
    const partial = routingPartial(pid, mid, null)

    // The save pipeline turns null sentinels into unset paths…
    const unset = configUnsetPaths(partial)
    expect(unset.sort()).toEqual(routingUnsetPaths(pid, mid).sort())

    // …and drops them from the set payload, so nothing else is written.
    const set = pruneConfigSet(partial) as Record<string, unknown>
    expect(routingNode(set)).toEqual({})
  })

  it("selecting a provider writes only the owned fields", () => {
    const partial = routingPartial(pid, mid, "gmicloud/fp8")
    expect(routingNode(partial)).toEqual({
      order: ["gmicloud/fp8"],
      only: ["gmicloud/fp8"],
      allow_fallbacks: false,
    })
    // No sibling keys are present in the write, so a deep merge cannot clobber them.
    for (const key of Object.keys(siblings)) {
      expect(key in routingNode(partial)).toBe(false)
    }
  })

  it("routable permits kilo and openrouter models but never auto routing IDs", () => {
    expect(routable("kilo", "z-ai/glm-4.6")).toBe(true)
    expect(routable("openrouter", "z-ai/glm-4.6")).toBe(true)
    expect(routable("anthropic", "claude-sonnet-4")).toBe(false)
    expect(routable("kilo", "kilo-auto/free")).toBe(false)
    expect(routable("kilo", "kilo-auto/small")).toBe(false)
    // Legacy auto-small has no kilo-auto/ prefix but is still an auto model.
    expect(routable("kilo", "auto-small")).toBe(false)
  })

  it("modelRouting reads the pinned slug and ignores sibling fields", () => {
    const config = {
      provider: {
        [pid]: {
          models: {
            [mid]: { options: { provider: { ...siblings, ...routingValue("gmicloud/fp8") } } },
          },
        },
      },
    }
    expect(modelRouting(config, pid, mid)).toBe("gmicloud/fp8")

    const cleared = {
      provider: { [pid]: { models: { [mid]: { options: { provider: { ...siblings } } } } } },
    }
    expect(modelRouting(cleared, pid, mid)).toBeUndefined()
  })
})

describe("project-level routing override", () => {
  const projectConfig = (routing: Record<string, unknown>, model = mid) => ({
    provider: { [pid]: { models: { [model]: { options: { provider: routing } } } } },
  })

  it("reports an override for every field the UI owns", () => {
    for (const key of ROUTING_KEYS) {
      expect(routingOverriddenByProject(projectConfig({ [key]: routingValue("gmicloud/fp8")[key] }), pid, mid)).toBe(
        true,
      )
    }
  })

  it("ignores hand-configured sibling preferences the UI never writes", () => {
    expect(routingOverriddenByProject(projectConfig(siblings), pid, mid)).toBe(false)
  })

  it("stays false without a project-level routing block", () => {
    expect(routingOverriddenByProject({}, pid, mid)).toBe(false)
    expect(routingOverriddenByProject(undefined, pid, mid)).toBe(false)
    expect(routingOverriddenByProject({ provider: { [pid]: { models: {} } } }, pid, mid)).toBe(false)
  })

  it("is scoped to the one provider and model it is asked about", () => {
    const config = projectConfig(routingValue("gmicloud/fp8"))
    expect(routingOverriddenByProject(config, pid, "z-ai/glm-4.5")).toBe(false)
    expect(routingOverriddenByProject(config, "openrouter", mid)).toBe(false)
  })

  it("flags allow_fallbacks alone — it shadows the pin the UI writes", () => {
    expect(routingOverriddenByProject(projectConfig({ allow_fallbacks: true }), pid, mid)).toBe(true)
  })
})
