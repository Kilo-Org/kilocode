import { describe, expect, it } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { useRoutingPick } from "../../webview-ui/src/hooks/useRoutingPick"
import { modelRouting, routingPartial } from "../../src/shared/provider-routing"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"

const model = { providerID: "kilo", modelID: "z-ai/glm-4.6" }
const other = { providerID: "kilo", modelID: "moonshotai/kimi-k2" }
const pinned = (provider: string, target = model) => routingPartial(target.providerID, target.modelID, provider)
const features = { indexing: false, sandboxControls: false, backgroundSubagents: false }

function setup(initial: Record<string, unknown> = {}) {
  const [config, setConfig] = createSignal<unknown>(initial)
  const sent: WebviewMessage[] = []
  let handler: ((message: ExtensionMessage) => void) | undefined
  const routing = createRoot(() =>
    useRoutingPick((model) => modelRouting(config(), model.providerID, model.modelID), {
      postMessage: (message) => sent.push(message),
      onMessage: (next) => {
        handler = next
        return () => {
          handler = undefined
        }
      },
    }),
  )
  // A config message updates the effective config before the hook sees it,
  // like the config context does. The effective config equals the global one
  // unless a project config shadows it.
  const fire = (message: ExtensionMessage, effective?: unknown) => {
    if (effective !== undefined) setConfig(effective)
    handler?.(message)
  }
  const updated = (global: Record<string, unknown>, effective: Record<string, unknown> = global) =>
    fire({ type: "configUpdated", config: effective, globalConfig: global, features }, effective)
  return { routing, sent, fire, updated }
}

describe("useRoutingPick", () => {
  it("shows the pick immediately and posts the write", () => {
    const { routing, sent } = setup()

    routing.pick(model, "gmicloud/fp8")

    expect(routing.value(model)).toBe("gmicloud/fp8")
    expect(sent).toEqual([{ type: "persistModelRouting", ...model, provider: "gmicloud/fp8" }])
  })

  it("settles on the config once its own write is confirmed", () => {
    const { routing, updated } = setup()
    routing.pick(model, "gmicloud/fp8")

    updated(pinned("gmicloud/fp8"))
    expect(routing.value(model)).toBe("gmicloud/fp8")

    // No pick pending any more: a later change from elsewhere shows through.
    updated(pinned("baseten/fp8"))
    expect(routing.value(model)).toBe("baseten/fp8")
  })

  it("keeps the latest pick while an earlier queued write confirms", () => {
    const { routing, updated } = setup()
    routing.pick(model, "gmicloud/fp8")
    routing.pick(model, "baseten/fp8")

    updated(pinned("gmicloud/fp8"))
    expect(routing.value(model)).toBe("baseten/fp8")

    updated(pinned("baseten/fp8"))
    expect(routing.value(model)).toBe("baseten/fp8")
  })

  it("survives the config reload that follows a write", () => {
    const { routing, fire } = setup(pinned("baseten/fp8"))
    routing.pick(model, "gmicloud/fp8")

    fire({ type: "configLoaded", config: pinned("baseten/fp8"), globalConfig: pinned("baseten/fp8"), features })
    expect(routing.value(model)).toBe("gmicloud/fp8")

    fire({ type: "configLoaded", config: pinned("gmicloud/fp8"), globalConfig: pinned("gmicloud/fp8"), features })
    fire({ type: "globalConfigLoaded", config: pinned("baseten/fp8") }, pinned("baseten/fp8"))
    expect(routing.value(model)).toBe("baseten/fp8")
  })

  it("clears to automatic routing the same way", () => {
    const { routing, sent, updated } = setup(pinned("gmicloud/fp8"))
    routing.pick(model, null)

    expect(routing.value(model)).toBeUndefined()
    expect(sent).toEqual([{ type: "persistModelRouting", ...model, provider: null }])
    updated(pinned("gmicloud/fp8"))
    expect(routing.value(model)).toBeUndefined()

    updated({})
    updated(pinned("baseten/fp8"))
    expect(routing.value(model)).toBe("baseten/fp8")
  })

  it("drops the pick when a write fails", () => {
    const { routing, fire } = setup(pinned("baseten/fp8"))
    routing.pick(model, "gmicloud/fp8")

    fire({ type: "configUpdateFailed", message: "Revision mismatch" })
    expect(routing.value(model)).toBe("baseten/fp8")
  })

  it("confirms against the global scope when a project pin shadows the pick", () => {
    const { routing, updated } = setup(pinned("baseten/fp8"))
    routing.pick(model, "gmicloud/fp8")

    updated(pinned("gmicloud/fp8"), pinned("baseten/fp8"))
    expect(routing.value(model)).toBe("baseten/fp8")
  })

  it("only applies to the picked model", () => {
    const { routing } = setup(pinned("baseten/fp8", other))
    routing.pick(model, "gmicloud/fp8")

    expect(routing.value(other)).toBe("baseten/fp8")
  })
})
