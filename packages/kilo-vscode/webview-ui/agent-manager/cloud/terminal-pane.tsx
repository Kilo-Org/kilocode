import type { OpenCodeClient } from "@opencode/client"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { createSignal, For, Show } from "solid-js"
import { useLanguage } from "../../src/context/language"
import { TerminalTab } from "../terminal/TerminalTab"
import { cloudTerminal } from "./terminal"
import type { ChatRoute } from "./route"
import { InspectorTabStrip } from "../InspectorTabStrip"
import { SortableTerminalTab } from "../terminal/SortableTerminalTab"
import { focusCloudChat } from "./focus"
import type { CloudShells } from "./shell-tabs"

export function CloudTerminalPane(props: {
  api: OpenCodeClient
  shells: CloudShells
  visible: boolean
  close: () => void
}) {
  const { t } = useLanguage()
  const { tabs, setTabs, active, setActive, add, focus, remove, request } = props.shells
  const [titles, setTitles] = createSignal<Record<string, string>>({})
  const title = (id: string) => titles()[id] || t("agentManager.tab.terminal")
  return (
    <section
      class="am-side-terminal am-cloud-terminal"
      classList={{ "am-side-terminal-visible": props.visible }}
      inert={!props.visible}
      aria-label={t("agentManager.tab.terminal")}
    >
      <InspectorTabStrip
        ids={tabs}
        active={active}
        label={t("agentManager.tab.terminal")}
        overlay={title}
        onSelect={setActive}
        onActivate={focus}
        onReorder={(from, to) =>
          setTabs((prev) => {
            const next = [...prev]
            next.splice(next.indexOf(from), 1)
            next.splice(prev.indexOf(to), 0, from)
            return next
          })
        }
        renderTab={(id, api) => (
          <SortableTerminalTab
            id={id}
            label={title(id)}
            tooltip={title(id)}
            role="tab"
            active={id === active()}
            selected={id === active()}
            tabIndex={id === active() ? 0 : -1}
            onKeyDown={(e) => api.focus.key(id, e)}
            onSelect={() => focus(id)}
            onClose={() => {
              if (remove(id)) api.focus.restore()
              else props.close()
              requestAnimationFrame(api.release)
            }}
            onCloseOthers={() => {
              setTabs([id])
              api.focus.run(() => setActive(id))
            }}
          />
        )}
        action={() => (
          <div class="am-side-terminal-add">
            <IconButton icon="plus" variant="ghost" size="small" label={t("agentManager.terminal.add")} onClick={add} />
          </div>
        )}
      />
      <div class="am-side-terminal-layer" classList={{ "am-side-terminal-layer-active": props.visible }}>
        <For each={tabs()}>
          {(id) => (
            <div
              class="am-terminal-slot"
              classList={{ "am-terminal-slot-visible": active() === id }}
              inert={active() !== id}
            >
              <RemoteShell
                api={props.api}
                route={props.shells.route}
                id={id}
                active={props.visible && active() === id}
                serial={request().id === id ? request().serial : 0}
                title={(value) => setTitles((prev) => ({ ...prev, [id]: value }))}
              />
            </div>
          )}
        </For>
      </div>
    </section>
  )
}

function RemoteShell(props: {
  api: OpenCodeClient
  route: ChatRoute
  id: string
  active: boolean
  serial: number
  title: (value: string) => void
}) {
  const { t } = useLanguage()
  const [failure, setFailure] = createSignal<{ message: string; stopped: boolean; opened?: boolean }>()
  const [attempt, setAttempt] = createSignal(1)
  const [connecting, setConnecting] = createSignal(true)
  const remote = cloudTerminal(
    props.api,
    props.route.directory,
    props.route.target,
    (e, stopped, opened) => {
      // The promise RPC client rejects declared plugin failures as {type, message}, not Error instances.
      const message =
        e &&
        typeof e === "object" &&
        "type" in e &&
        e.type === "HostedError" &&
        "message" in e &&
        typeof e.message === "string"
          ? e.message
          : t(opened ? "agentManager.cloud.shellEnded" : "agentManager.terminal.connectionError")
      setConnecting(false)
      setFailure({ message, stopped, opened })
    },
    () => {
      setFailure(undefined)
      setConnecting(false)
    },
  )
  return (
    <>
      <Show when={connecting()}>
        <div class="am-cloud-notice" role="status">
          {t("prompt.placeholder.connecting")}
        </div>
      </Show>
      <Show when={failure()}>
        {(f) => (
          <div class="am-cloud-notice" classList={{ "am-side-terminal-state": f().stopped && !f().opened }}>
            <span class="am-empty-state-text" role="alert">
              {f().message}
            </span>
            <Show when={f().stopped}>
              <Button
                size="small"
                onClick={() => {
                  setConnecting(true)
                  setFailure(undefined)
                  setAttempt((n) => n + 1)
                }}
              >
                {t(f().opened ? "agentManager.terminal.add" : "common.retry")}
              </Button>
            </Show>
          </div>
        )}
      </Show>
      <Show when={attempt()} keyed>
        {(_attempt) => (
          <TerminalTab
            terminalId={`cloud:${props.id}`}
            remote={remote}
            active={props.active}
            focusOnActivate={false}
            focusSerial={props.serial}
            onFocusPrompt={() => focusCloudChat(true)}
            onTitleChange={props.title}
            font={{ fontFamily: "var(--vscode-editor-font-family), monospace", fontSize: 13 }}
          />
        )}
      </Show>
    </>
  )
}
