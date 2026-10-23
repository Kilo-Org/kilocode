import { afterEach, describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { useRoutingPick } from "../../webview-ui/src/hooks/useRoutingPick"
import {
  handleWorkspaceConfigMessage,
  requestWorkspaceConfig,
  resetWorkspaceConfigStore,
  workspaceConfigEntry,
} from "../../webview-ui/src/context/workspace-config"
import { modelRouting, routingPartial } from "../../src/shared/provider-routing"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"

const dir = "/worktree"
const model = { providerID: "kilo", modelID: "z-ai/glm-4.6" }
const other = { providerID: "kilo", modelID: "moonshotai/kimi-k2" }
const pinned = (provider: string, target = model) => routingPartial(target.providerID, target.modelID, provider)
const features = { indexing: false, sandboxControls: false, backgroundSubagents: false }

afterEach(() => {
  resetWorkspaceConfigStore()
})

// Wires the hook to the real workspace config store the way the chat selector
// does. The store sees every message first, as it does under ProviderProvider.
function setup(initial: Record<string, unknown> = {}, global = initial) {
  const sent: WebviewMessage[] = []
  const post = (message: WebviewMessage) => void sent.push(message)
  let handler: ((message: ExtensionMessage) => void) | undefined
  const entry = () => workspaceConfigEntry(dir)
  const routing = createRoot(() =>
    useRoutingPick(
      (model) => modelRouting(entry()?.config, model.providerID, model.modelID),
      () => {
        const value = entry()
        return value !== undefined && !value.stale
      },
      {
        postMessage: post,
        onMessage: (next) => {
          handler = next
          return () => {
            handler = undefined
          }
        },
      },
    ),
  )
  const fire = (message: ExtensionMessage) => {
    handleWorkspaceConfigMessage(message)
    handler?.(message)
  }
  // The selector re-requests a stale entry, and the backend answers with the
  // workspace's effective config and the merged global config.
  const reload = (effective: Record<string, unknown>, global = effective) => {
    requestWorkspaceConfig(dir, post)
    const request = sent.findLast((message) => message.type === "requestWorkspaceConfig")
    if (request?.type !== "requestWorkspaceConfig") throw new Error("Expected a workspace config request")
    fire({
      type: "workspaceConfigLoaded",
      requestID: request.requestID,
      directory: dir,
      config: effective,
      globalConfig: global,
    })
  }
  const updated = (global: Record<string, unknown>) =>
    fire({ type: "configUpdated", config: global, globalConfig: global, features })
  const writes = () => sent.filter((message) => message.type === "persistModelRouting")
  reload(initial, global)
  return { routing, fire, reload, updated, writes }
}

describe("useRoutingPick", () => {
  it("shows the pick immediately and posts the write", () => {
    const { routing, writes } = setup()

    routing.pick(model, "gmicloud/fp8")

    expect(routing.value(model)).toBe("gmicloud/fp8")
    expect(writes()).toEqual([{ type: "persistModelRouting", ...model, provider: "gmicloud/fp8" }])
  })

  it("holds the pick until the workspace config reloads after its write", () => {
    const { routing, reload, updated } = setup(pinned("baseten/fp8"))
    routing.pick(model, "gmicloud/fp8")

    // Confirmed in the global config, but the workspace entry still holds the
    // config from before the write while it reloads.
    updated(pinned("gmicloud/fp8"))
    expect(routing.value(model)).toBe("gmicloud/fp8")

    reload(pinned("gmicloud/fp8"))
    expect(routing.value(model)).toBe("gmicloud/fp8")
    expect(routing.picking(model)).toBe(false)

    // No pick pending any more: a later change from elsewhere shows through.
    updated(pinned("baseten/fp8"))
    reload(pinned("baseten/fp8"))
    expect(routing.value(model)).toBe("baseten/fp8")
  })

  it("keeps the latest pick while an earlier queued write confirms", () => {
    const { routing, reload, updated } = setup()
    routing.pick(model, "gmicloud/fp8")
    routing.pick(model, "baseten/fp8")

    updated(pinned("gmicloud/fp8"))
    reload(pinned("gmicloud/fp8"))
    expect(routing.value(model)).toBe("baseten/fp8")

    updated(pinned("baseten/fp8"))
    reload(pinned("baseten/fp8"))
    expect(routing.value(model)).toBe("baseten/fp8")
    expect(routing.picking(model)).toBe(false)
  })

  it("survives the config reload that follows a write", () => {
    const { routing, fire, reload } = setup(pinned("baseten/fp8"))
    routing.pick(model, "gmicloud/fp8")

    fire({ type: "configLoaded", config: pinned("baseten/fp8"), globalConfig: pinned("baseten/fp8"), features })
    reload(pinned("baseten/fp8"))
    expect(routing.value(model)).toBe("gmicloud/fp8")

    fire({ type: "configLoaded", config: pinned("gmicloud/fp8"), globalConfig: pinned("gmicloud/fp8"), features })
    reload(pinned("gmicloud/fp8"))
    fire({ type: "globalConfigLoaded", config: pinned("baseten/fp8") })
    reload(pinned("baseten/fp8"))
    expect(routing.value(model)).toBe("baseten/fp8")
  })

  it("clears to automatic routing the same way", () => {
    const { routing, reload, updated, writes } = setup(pinned("gmicloud/fp8"))
    routing.pick(model, null)

    expect(routing.value(model)).toBeUndefined()
    expect(writes()).toEqual([{ type: "persistModelRouting", ...model, provider: null }])
    updated(pinned("gmicloud/fp8"))
    reload(pinned("gmicloud/fp8"))
    expect(routing.value(model)).toBeUndefined()

    updated({})
    reload({})
    expect(routing.picking(model)).toBe(false)
    updated(pinned("baseten/fp8"))
    reload(pinned("baseten/fp8"))
    expect(routing.value(model)).toBe("baseten/fp8")
  })

  it("drops the pick when a write fails", () => {
    const { routing, fire } = setup(pinned("baseten/fp8"))
    routing.pick(model, "gmicloud/fp8")

    fire({ type: "configUpdateFailed", message: "Not saved: /repo/kilo.json takes precedence" })
    expect(routing.value(model)).toBe("baseten/fp8")
    expect(routing.picking(model)).toBe(false)
  })

  it("settles on the effective routing when a higher config shadows the written pick", () => {
    const { routing, reload, updated } = setup(pinned("baseten/fp8"), {})
    routing.pick(model, "gmicloud/fp8")

    updated(pinned("gmicloud/fp8"))
    reload(pinned("baseten/fp8"), pinned("gmicloud/fp8"))
    expect(routing.value(model)).toBe("baseten/fp8")
  })

  it("only applies to the picked model", () => {
    const { routing } = setup(pinned("baseten/fp8", other))
    routing.pick(model, "gmicloud/fp8")

    expect(routing.value(other)).toBe("baseten/fp8")
    expect(routing.picking(other)).toBe(false)
  })
})
