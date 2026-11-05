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
  const [impressed, setImpressed] = createSignal(false)
  const [exposed, setExposed] = createSignal(false)
  const visible = () =>
    props.enabled && props.sidebar && props.idle && vscode.active() && (impressed() || props.eligible)
  const token = crypto.randomUUID()
  let sequence = 0
  let request = ""
  let pending = false
  let stale = false
  let checking = false
  let room = false
  let action: UpsellAction | "rendered" | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => clearTimeout(timer)
  const track = (action: UpsellAction) =>
    vscode.postMessage({ type: "telemetry", event: TelemetryEventName.AGENT_MANAGER_UPSELL, properties: { action } })
  const send = (next: UpsellAction | "rendered") => {
    action = next
    request = `${token}:${++sequence}`
    vscode.postMessage({ type: "agentManagerUpsell", request, action: next })
  }
  const reveal = () => {
    setExposed(true)
    if (impressed()) return
    setImpressed(true)
    send("rendered")
    track("shown")
  }
  onCleanup(cancel)
  onCleanup(
    vscode.onMessage((message) => {
      if (message.type !== "agentManagerUpsellLoaded" || message.request !== request) return
      if (action === "shown") {
        if (!visible() || !props.eligible) return
        if (!message.display) {
          checking = false
          setView("hidden")
          return
        }
        if (checking) {
          checking = false
          stale = !room
          if (room) reveal()
          return
        }
      }
      if (message.display) setView("shown")
      if (action === "undo" && !message.display) setView("hidden")
      if (message.state.converted || message.state.opened) setView("hidden")
    }),
  )
  createEffect(() => {
    if (!props.enabled && view() === "shown") setView("hidden")
    if (!visible() || !props.eligible) {
      pending = false
      if (!impressed()) {
        request = ""
        checking = false
        setView("hidden")
      }
      return
    }
    if (impressed() || pending || view() !== "hidden") return
    pending = true
    send("shown")
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
        ref={(node) => {
          setExposed(false)
          room = false
          stale = false
          const observer = new IntersectionObserver(
            (entries) => {
              if (!node.isConnected) return
              room = entries.some((entry) => entry.intersectionRatio >= 0.01)
              if (!room) {
                setExposed(false)
                if (!impressed()) stale = true
                return
              }
              if (!visible() || view() === "hidden") return
              // A clipped candidate can outlive its authorization; recheck before exposing it.
              if (!impressed() && stale) {
                if (!checking) {
                  checking = true
                  send("shown")
                }
                return
              }
              reveal()
            },
            { threshold: 0.01 },
          )
          observer.observe(node)
          onCleanup(() => observer.disconnect())
        }}
        class="agent-manager-upsell"
        classList={{ "agent-manager-upsell-confirmation": view() === "confirmation" }}
        role="status"
        aria-live="polite"
        aria-hidden={!exposed()}
        inert={!exposed()}
        style={{ visibility: exposed() ? undefined : "hidden" }}
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
