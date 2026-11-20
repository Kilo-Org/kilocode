import { describe, expect, it } from "bun:test"
import {
  ROUTING_KEYS,
  modelRouting,
  routingClear,
  routingCustom,
  routingOverridden,
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

  it("routingCustom flags hand-written setups a single pin cannot represent", () => {
    const config = (routing: Record<string, unknown>) => ({
      provider: { [pid]: { models: { [mid]: { options: { provider: routing } } } } },
    })

    expect(routingCustom(config({ only: ["a/fp8", "b/fp8"] }), pid, mid)).toBe(true)
    expect(routingCustom(config({ order: ["a/fp8", "b/fp8"] }), pid, mid)).toBe(true)
    expect(routingCustom(config({ only: ["a/fp8"], order: ["b/fp8"] }), pid, mid)).toBe(true)

    expect(routingCustom(config(routingValue("a/fp8")), pid, mid)).toBe(false)
    expect(routingCustom(config({ order: ["a/fp8"] }), pid, mid)).toBe(false)
    expect(routingCustom(config(siblings), pid, mid)).toBe(false)
    expect(routingCustom(undefined, pid, mid)).toBe(false)
  })
})

describe("routing overridden above the global config", () => {
  const config = (routing: unknown, model = mid) => ({
    provider: { [pid]: { models: { [model]: { options: { provider: routing } } } } },
  })

  it("stays false while the effective routing is the global one", () => {
    const pinned = config(routingValue("gmicloud/fp8"))
    expect(routingOverridden(pinned, pinned, pid, mid)).toBe(false)
    expect(routingOverridden({}, {}, pid, mid)).toBe(false)
    expect(routingOverridden(undefined, undefined, pid, mid)).toBe(false)
  })

  it("reports a pin the global config does not hold", () => {
    expect(routingOverridden(config(routingValue("baseten/fp8")), {}, pid, mid)).toBe(true)
    expect(routingOverridden(config(routingValue("baseten/fp8")), config(routingValue("gmicloud/fp8")), pid, mid)).toBe(
      true,
    )
  })

  it("reports a field-level difference for every field the UI owns", () => {
    const global = routingValue("gmicloud/fp8")
    for (const key of ROUTING_KEYS) {
      const effective = { ...global, [key]: key === "allow_fallbacks" ? true : ["baseten/fp8"] }
      expect(routingOverridden(config(effective), config(global), pid, mid)).toBe(true)
    }
  })

  it("reports an explicit reset that removed the global pin", () => {
    // A project `options.provider: null` leaves no routing in the effective config.
    expect(routingOverridden(config(null), config(routingValue("gmicloud/fp8")), pid, mid)).toBe(true)
    expect(routingOverridden({}, config(routingValue("gmicloud/fp8")), pid, mid)).toBe(true)
  })

  it("ignores hand-configured sibling preferences the UI never writes", () => {
    expect(routingOverridden(config(siblings), {}, pid, mid)).toBe(false)
  })

  it("is scoped to the one provider and model it is asked about", () => {
    const effective = config(routingValue("gmicloud/fp8"))
    expect(routingOverridden(effective, {}, pid, "z-ai/glm-4.5")).toBe(false)
    expect(routingOverridden(effective, {}, "openrouter", mid)).toBe(false)
  })
})
