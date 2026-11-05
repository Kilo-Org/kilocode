import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { TelemetryEventName } from "../../../../src/services/telemetry/types"
import type { UpsellAction } from "../../../../src/shared/agent-manager-upsell"

export function AgentManagerUpsell(props: { enabled: boolean; sidebar: boolean; eligible: boolean; idle: boolean }) {
  const language = useLanguage()
  const vscode = useVSCode()
  const [view, setView] = createSignal<"hidden" | "shown" | "confirmation">("hidden")
  const visible = () => props.enabled && props.sidebar && props.idle && vscode.active()
  const token = crypto.randomUUID()
  let sequence = 0
  let request = ""
  let pending = false
  let action: UpsellAction | undefined
  let shown = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => clearTimeout(timer)
  const track = (action: UpsellAction) =>
    vscode.postMessage({ type: "telemetry", event: TelemetryEventName.AGENT_MANAGER_UPSELL, properties: { action } })
  const send = (next: UpsellAction) => {
    action = next
    request = `${token}:${++sequence}`
    vscode.postMessage({ type: "agentManagerUpsell", request, action: next })
  }
  onCleanup(cancel)
  onCleanup(
    vscode.onMessage((message) => {
      if (message.type !== "agentManagerUpsellLoaded" || message.request !== request) return
      if (action === "shown" && (!visible() || !props.eligible)) return
      if (message.display) setView("shown")
      if (action === "undo" && !message.display) setView("hidden")
      if (message.state.converted || message.state.opened) setView("hidden")
    }),
  )
  createEffect(() => {
    if (!visible() || !props.eligible) {
      pending = false
      return
    }
    if (pending || view() !== "hidden") return
    pending = true
    send("shown")
  })
  createEffect(() => {
    if (shown || !visible() || view() !== "shown") return
    shown = true
    track("shown")
  })
  const act = (action: Exclude<UpsellAction, "shown">) => {
    cancel()
    setView(action === "dont_show_again" ? "confirmation" : action === "undo" ? "shown" : "hidden")
    send(action)
    track(action)
    if (action === "opened") vscode.postMessage({ type: "openAgentManager" })
    if (action === "dont_show_again") timer = setTimeout(() => setView("hidden"), 6000)
  }
  return (
    <Show when={visible() && view() !== "hidden"}>
      <div
        class="agent-manager-upsell"
        classList={{ "agent-manager-upsell-confirmation": view() === "confirmation" }}
        role="status"
        aria-live="polite"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return
          event.preventDefault()
          event.stopPropagation()
          act("not_now")
        }}
      >
        <Show
          when={view() === "shown"}
          fallback={
            <div class="agent-manager-upsell-confirmation-body">
              <span>{language.t("sidebar.upsell.confirmation")}</span>
              <Button variant="ghost" class="agent-manager-upsell-undo" onClick={() => act("undo")}>
                {language.t("sidebar.upsell.undo")}
              </Button>
            </div>
          }
        >
          <div class="agent-manager-upsell-body">
            <div class="agent-manager-upsell-heading">
              <span class="agent-manager-upsell-tile" aria-hidden="true">
                K
              </span>
              <div class="agent-manager-upsell-copy">
                <span class="agent-manager-upsell-title">{language.t("sidebar.upsell.title")}</span>
                <span class="agent-manager-upsell-subtitle">{language.t("sidebar.upsell.body")}</span>
              </div>
            </div>
            <div class="agent-manager-upsell-benefits">
              <For each={["sidebar.upsell.parallel", "sidebar.upsell.worktree", "sidebar.upsell.attention"] as const}>
                {(key) => (
                  <div>
                    <Icon name="check" size="small" />
                    <span>{language.t(key)}</span>
                  </div>
                )}
              </For>
            </div>
            <div class="agent-manager-upsell-actions">
              <Button class="agent-manager-upsell-primary" onClick={() => act("opened")}>
                {language.t("sidebar.upsell.open")}
                <Icon name="arrow-right" size="small" />
              </Button>
              <Button variant="ghost" class="agent-manager-upsell-later" onClick={() => act("not_now")}>
                {language.t("sidebar.upsell.later")}
              </Button>
              <Button variant="ghost" class="agent-manager-upsell-never" onClick={() => act("dont_show_again")}>
                {language.t("sidebar.upsell.never")}
              </Button>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  )
}
