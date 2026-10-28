// Auto-approve for permission requests, ported from v1's composer toggle
// (packages/kilo-vscode/src/commands/toggle-auto-approve.ts on main). v1 kept the
// toggle in the extension host and auto-replied "once" to each permission.asked
// event. v2 has no such server toggle, so the webview reacts to the requests it
// receives over the v2 client and the host only persists the on/off state.
import type { PermissionRequest } from "@opencode/client"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { createEffect, createSignal, on, onCleanup } from "solid-js"
import { useLanguage } from "../context/language"
import { useVSCode } from "../context/vscode"
import { shouldApprove, RESPONDED_LIMIT } from "./auto-approve-policy"
import { useV2 } from "./client"

export function createAutoApprove() {
  const v2 = useV2()
  const vscode = useVSCode()
  const [enabled, setEnabled] = createSignal(false)
  const responded = new Set<string>()

  onCleanup(
    vscode.onMessage((message) => {
      if (message.type === "autoApproveStateLoaded") setEnabled(message.value)
    }),
  )
  vscode.postMessage({ type: "requestAutoApproveState" })

  const approve = (request: PermissionRequest) => {
    // Read `enabled()` here too: the sweep may resolve after the toggle turned off.
    if (!shouldApprove(request, enabled(), responded)) return
    responded.add(request.id)
    for (const oldest of responded) {
      if (responded.size <= RESPONDED_LIMIT) break
      responded.delete(oldest)
    }
    void v2.data.session.permission
      .reply({ sessionID: request.sessionID, requestID: request.id, decision: "once" })
      // A failed reply leaves the request pending, so allow a later sweep to retry it.
      .catch(() => responded.delete(request.id))
  }

  // Requests that arrive while connected: the event stream fills the session permission store, and this reads it.
  createEffect(() => {
    if (!enabled() || v2.connection.status() !== "connected") return
    for (const id of v2.data.session.permission.sessions())
      for (const request of v2.data.session.permission.list(id) ?? []) approve(request)
  })

  // Requests that were already pending before this client connected: the event stream does not replay them.
  createEffect(
    on([enabled, v2.connection.status] as const, ([active, status]) => {
      if (!active || status !== "connected") return
      void v2.api.permission.request
        .list({ location: { directory: v2.directory } })
        .then((response) => response.data.forEach(approve))
        .catch(v2.report)
    }),
  )

  return {
    enabled,
    toggle() {
      const value = !enabled()
      setEnabled(value)
      vscode.postMessage({ type: "persistAutoApproveState", value })
    },
  }
}

export function AutoApproveAction(props: { enabled: boolean; onToggle: () => void }) {
  const language = useLanguage()
  const label = () =>
    props.enabled ? language.t("prompt.action.autoApprove.disable") : language.t("prompt.action.autoApprove.enable")
  const tooltip = () =>
    `${language.t(props.enabled ? "prompt.action.autoApprove.enabled" : "prompt.action.autoApprove.disabled")} ${language.t("prompt.action.autoApprove.sandboxExcluded")}`
  return (
    <div class="prompt-action">
      <Tooltip value={tooltip()} placement="top" openDelay={0}>
        <IconButton
          icon="shield"
          variant="ghost"
          size="small"
          onClick={props.onToggle}
          aria-label={label()}
          aria-pressed={props.enabled}
          class="prompt-status-button"
          classList={{ "prompt-status-button--active": props.enabled }}
        />
      </Tooltip>
    </div>
  )
}
