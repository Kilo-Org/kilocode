import { createEffect, createSignal, For, onCleanup, Show, type Accessor, type Component, type Setter } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { useLanguage } from "../src/context/language"
import { useVSCode } from "../src/context/vscode"
import type { AgentManagerBrowserInspectionMessage, ExtensionMessage, WebviewMessage } from "../src/types/messages"
import { SidePanel } from "./side-panel-layout"

export function createBrowserPanel(
  current: Accessor<SidePanel | null>,
  panel: Setter<SidePanel | null>,
  history: Setter<boolean>,
  review: Setter<boolean>,
) {
  const [enabled, configure] = createSignal(
    (globalThis as typeof globalThis & { KILO_BROWSER_AUTOMATION?: boolean }).KILO_BROWSER_AUTOMATION === true,
  )
  const visible = () => current() === SidePanel.Browser
  const close = () => panel(null)
  const open = () => {
    history(false)
    review(false)
    panel(SidePanel.Browser)
  }
  return {
    enabled,
    visible,
    close,
    bind: (current: Accessor<string | undefined>) => ({
      browser: configure,
      current,
      closeBrowser: close,
      openBrowser: open,
    }),
    toggle: () => {
      if (!enabled()) return
      if (visible()) return close()
      open()
    },
    render: (session: Accessor<string | undefined>, project: Accessor<string | undefined>) => (
      <Show when={enabled() && visible()}>
        <BrowserPanel sessionId={session} projectId={project} onClose={close} />
      </Show>
    ),
  }
}

type State = Extract<ExtensionMessage, { type: "agentManager.browserState" }>
type Devtools = Extract<ExtensionMessage, { type: "agentManager.browserDevtools" }>
type Inspection = AgentManagerBrowserInspectionMessage
type Position = { x: number; y: number; width: number; height: number }
type Pointer = MouseEvent & { currentTarget: HTMLButtonElement }

function feedback(message: Inspection): string {
  const element = message.element
  const attrs = [
    element?.id ? `id="${element.id}"` : undefined,
    element?.classes ? `class="${element.classes}"` : undefined,
  ]
    .filter(Boolean)
    .join(" ")
  return [
    "Browser feedback",
    message.url ? `URL: ${message.url}` : undefined,
    message.title ? `Page: ${message.title}` : undefined,
    element ? `Selected element: <${element.tag}${attrs ? ` ${attrs}` : ""}>` : "Selected element: unavailable",
    element?.selector ? `Selector: ${element.selector}` : undefined,
    element?.rect
      ? `Bounds: x=${element.rect.x.toFixed(3)}, y=${element.rect.y.toFixed(3)}, width=${element.rect.width.toFixed(3)}, height=${element.rect.height.toFixed(3)}`
      : undefined,
    element?.text ? `Visible text: ${element.text}` : undefined,
    message.logs.length ? `Console diagnostics:\n${message.logs.map((line) => `- ${line}`).join("\n")}` : undefined,
  ]
    .filter(Boolean)
    .join("\n")
}

function position(event: Pointer): Position {
  const bounds = event.currentTarget.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    width: bounds.width,
    height: bounds.height,
  }
}

const Toolbar: Component<{
  url: string
  active: boolean
  selecting: boolean
  docked: boolean
  ready: boolean
  onUrl: (value: string) => void
  onOpen: () => void
  onSelect: () => void
  onDevtools: () => void
  onRefresh: () => void
  onClose: () => void
}> = (props) => {
  const t = useLanguage().t
  return (
    <div class="am-browser-toolbar">
      <TextField
        class="am-browser-url"
        value={props.url}
        onChange={props.onUrl}
        placeholder={t("agentManager.browser.urlPlaceholder")}
        aria-label={t("agentManager.browser.url")}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key === "Enter") props.onOpen()
        }}
      />
      <Button size="small" variant="primary" disabled={!props.url.trim() || !props.active} onClick={props.onOpen}>
        {t("agentManager.browser.open")}
      </Button>
      <Button
        size="small"
        variant="secondary"
        aria-pressed={props.selecting}
        disabled={!props.ready}
        onClick={props.onSelect}
      >
        {t("agentManager.browser.inspect")}
      </Button>
      <IconButton
        icon="console"
        size="small"
        variant="ghost"
        aria-label={t("agentManager.browser.devtools")}
        aria-pressed={props.docked}
        onClick={props.onDevtools}
        disabled={!props.ready}
      />
      <IconButton
        icon="refresh"
        size="small"
        variant="ghost"
        aria-label={t("agentManager.browser.refresh")}
        onClick={props.onRefresh}
        disabled={!props.ready}
      />
      <IconButton
        icon="close"
        size="small"
        variant="ghost"
        aria-label={t("agentManager.browser.close")}
        onClick={props.onClose}
        disabled={!props.ready}
      />
    </div>
  )
}

const Picker: Component<{
  active: boolean
  hovered?: Inspection
  onMove: (value: Position) => void
  onSelect: (value: Position) => void
}> = (props) => {
  const t = useLanguage().t
  const bounds = () => props.hovered?.element?.rect
  return (
    <Show when={props.active}>
      <button
        type="button"
        class="am-browser-inspect"
        aria-label={t("agentManager.browser.inspect")}
        onMouseMove={(event) => props.onMove(position(event))}
        onClick={(event) => props.onSelect(position(event))}
      />
      <Show when={bounds()} keyed>
        {(rect) => (
          <div
            class="am-browser-hover-outline"
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.width * 100}%`,
              height: `${rect.height * 100}%`,
            }}
          >
            <span classList={{ "am-browser-hover-label-inside": rect.y < 0.05 }}>
              {props.hovered?.element?.selector}
            </span>
          </div>
        )}
      </Show>
    </Show>
  )
}

const Viewport: Component<{
  state?: State
  session?: string
  selecting: boolean
  hovered?: Inspection
  onMove: (value: Position) => void
  onSelect: (value: Position) => void
}> = (props) => {
  const t = useLanguage().t
  const issue = () => props.state?.frameError || props.state?.error
  const page = () =>
    props.state?.url &&
    props.state.status !== "closed" &&
    (props.state.status !== "error" || !!props.state.title) &&
    props.state.url
  const identity = () => {
    const url = page()
    return url ? `${props.state?.browserId}:${props.state?.navigation ?? 0}:${url}` : undefined
  }
  return (
    <div class="am-browser-viewport" aria-live="polite">
      <Show
        when={identity()}
        keyed
        fallback={
          <div class="am-browser-empty">
            <div>{props.session ? t("agentManager.browser.empty") : t("agentManager.browser.noSession")}</div>
          </div>
        }
      >
        {(_key) => (
          <iframe
            class="am-browser-frame"
            src={props.state?.url}
            title={t("agentManager.browser.screenshotAlt")}
            sandbox="allow-scripts allow-forms allow-same-origin"
            referrerpolicy="no-referrer"
          />
        )}
      </Show>
      <Picker
        active={props.selecting && !!props.state?.url}
        hovered={props.hovered}
        onMove={props.onMove}
        onSelect={props.onSelect}
      />
      <Show when={issue()}>
        {(message) => (
          <div class="am-browser-error-overlay" role="alert">
            {message()}
          </div>
        )}
      </Show>
    </div>
  )
}

const Tools: Component<{ url: string; onClose: () => void }> = (props) => {
  const t = useLanguage().t
  return (
    <section class="am-browser-devtools" aria-label={t("agentManager.browser.devtoolsTitle")}>
      <div class="am-browser-devtools-toolbar">
        <span>{t("agentManager.browser.devtoolsTitle")}</span>
        <IconButton icon="close" size="small" variant="ghost" aria-label={t("common.close")} onClick={props.onClose} />
      </div>
      <iframe
        class="am-browser-devtools-frame"
        src={props.url}
        title={t("agentManager.browser.devtoolsTitle")}
        sandbox="allow-scripts allow-forms allow-same-origin"
        referrerpolicy="no-referrer"
      />
    </section>
  )
}

const Diagnostics: Component<{ logs: string[] }> = (props) => (
  <Show when={props.logs.length}>
    <div class="am-browser-console" role="log" aria-live="polite">
      <For each={props.logs}>
        {(line) => (
          <div class="am-browser-console-entry" data-level={line.match(/^\[([^\]]+)\]/)?.[1] ?? "error"}>
            {line}
          </div>
        )}
      </For>
    </div>
  </Show>
)

const Footer: Component<{ state?: State; selected?: Inspection; onClose: () => void }> = (props) => {
  const t = useLanguage().t
  return (
    <div class="am-browser-footer">
      <span>{props.state?.url || t("agentManager.browser.localOnly")}</span>
      <Show when={props.selected?.element?.selector}>
        {(selector) => <span class="am-browser-selected">{selector()}</span>}
      </Show>
      <Show when={props.state?.errors}>
        {(errors) => <span class="am-browser-errors">{t("agentManager.browser.errors", { count: errors() })}</span>}
      </Show>
      <Button size="small" variant="ghost" onClick={props.onClose}>
        {t("agentManager.browser.hide")}
      </Button>
    </div>
  )
}

interface Props {
  sessionId: Accessor<string | undefined>
  projectId: Accessor<string | undefined>
  onClose: () => void
}

const BrowserPanel: Component<Props> = (props) => {
  const t = useLanguage().t
  const vscode = useVSCode()
  const [url, setUrl] = createSignal("")
  const [selecting, setSelecting] = createSignal(false)
  const [pointing, setPointing] = createSignal(false)
  const [hovered, setHovered] = createSignal<Inspection>()
  const [selected, setSelected] = createSignal<Inspection>()
  const [state, setState] = createSignal<State>()
  const [tools, setTools] = createSignal<Devtools>()
  let frame: number | undefined
  let pending: Position | undefined
  let active: string | undefined
  let sequence = 0

  const stop = () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    pending = undefined
    active = undefined
    setHovered(undefined)
  }

  const post = (message: WebviewMessage) => vscode.postMessage(message)

  const request = (
    type:
      | "agentManager.browser.open"
      | "agentManager.browser.refresh"
      | "agentManager.browser.close"
      | "agentManager.browser.devtools",
  ) => {
    const session = props.sessionId()
    if (!session) return
    post({
      type,
      sessionId: session,
      projectId: props.projectId(),
      ...(type.endsWith("open") ? { url: url().trim() } : {}),
      ...(type.endsWith("devtools")
        ? {
            theme:
              document.body.classList.contains("vscode-light") ||
              document.body.classList.contains("vscode-high-contrast-light")
                ? ("light" as const)
                : ("dark" as const),
          }
        : {}),
    })
  }

  const inspect = (value: Position, hover: boolean) => {
    const session = props.sessionId()
    if (!session) return
    const id = String(++sequence)
    if (hover) active = id
    post({
      type: "agentManager.browser.inspect",
      sessionId: session,
      projectId: props.projectId(),
      ...value,
      hover,
      requestId: id,
    })
  }

  const input = (value: Position, click: boolean) => {
    const session = props.sessionId()
    if (!session) return
    post({ type: "agentManager.browser.input", sessionId: session, projectId: props.projectId(), ...value, click })
  }

  const schedule = () => {
    if (frame !== undefined || active || !pending || (!selecting() && !pointing())) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      const value = pending
      pending = undefined
      if (!value || (!selecting() && !pointing())) return
      if (pointing()) input(value, false)
      inspect(value, true)
    })
  }

  const move = (value: Position) => {
    pending = value
    schedule()
  }

  const choose = (value: Position) => {
    stop()
    if (pointing()) {
      input(value, true)
      return
    }
    setSelecting(false)
    inspect(value, false)
  }

  const toggle = () => {
    const next = !selecting()
    stop()
    setSelecting(next)
  }

  const dock = () => {
    if (tools()) {
      setTools(undefined)
      return
    }
    request("agentManager.browser.devtools")
  }

  const update = (message: State) => {
    const changed = message.url !== state()?.url
    const current = message.inspecting === true
    if (current !== pointing()) {
      stop()
      setPointing(current)
      if (current) setSelecting(false)
    }
    if (tools()?.browserId !== message.browserId || message.status === "closed") setTools(undefined)
    setState(message)
    if (message.url && changed) setUrl(message.url)
  }

  const receive = (message: Inspection, session: string) => {
    if (message.hover) {
      if ((!selecting() && !pointing()) || message.requestId !== active) return
      active = undefined
      setHovered(message)
      schedule()
      return
    }
    const content = feedback(message)
    const element = message.element
    const browser = element?.selector
      ? {
          id: crypto.randomUUID(),
          sessionId: session,
          selector: element.selector,
          text: element.text,
          url: message.url,
          content,
        }
      : undefined
    window.postMessage({ type: "appendChatBoxMessage", text: content, browser }, "*")
    setSelected(message)
    setSelecting(false)
    stop()
  }

  createEffect(() => {
    const session = props.sessionId()
    setState(undefined)
    setUrl("")
    setSelecting(false)
    setPointing(false)
    setSelected(undefined)
    setTools(undefined)
    stop()
    if (!session) return

    const off = vscode.onMessage((message) => {
      if (
        message.type !== "agentManager.browserState" &&
        message.type !== "agentManager.browserInspection" &&
        message.type !== "agentManager.browserDevtools"
      ) {
        return
      }
      if (message.sessionId !== session) return
      if (message.projectId && message.projectId !== props.projectId()) return
      if (message.type === "agentManager.browserDevtools") {
        if (message.browserId !== state()?.browserId) return
        setTools(message)
        return
      }
      if (message.type === "agentManager.browserState") return update(message)
      receive(message, session)
    })
    onCleanup(() => {
      off()
      stop()
    })
    post({ type: "agentManager.browser.state", sessionId: session, projectId: props.projectId() })
  })

  return (
    <div class="am-browser-panel" aria-label={t("agentManager.browser.title")}>
      <Toolbar
        url={url()}
        active={!!props.sessionId()}
        selecting={selecting()}
        docked={!!tools()}
        ready={!!state()?.url && state()?.status !== "closed"}
        onUrl={setUrl}
        onOpen={() => request("agentManager.browser.open")}
        onSelect={toggle}
        onDevtools={dock}
        onRefresh={() => request("agentManager.browser.refresh")}
        onClose={() => request("agentManager.browser.close")}
      />
      <div class="am-browser-meta">
        <span>{state()?.title || t("agentManager.browser.empty")}</span>
        <span class="am-browser-status" role="status" aria-live="polite">
          {state()?.status ?? t("agentManager.browser.notStarted")}
        </span>
      </div>
      <div class="am-browser-workspace" classList={{ "am-browser-workspace-docked": !!tools() }}>
        <Viewport
          state={state()}
          session={props.sessionId()}
          selecting={selecting() || pointing()}
          hovered={hovered()}
          onMove={move}
          onSelect={choose}
        />
        <Show when={tools()} keyed>
          {(entry) => <Tools url={entry.url} onClose={() => setTools(undefined)} />}
        </Show>
      </div>
      <Show when={!tools()}>
        <Diagnostics logs={state()?.logs ?? []} />
      </Show>
      <Footer state={state()} selected={selected()} onClose={props.onClose} />
    </div>
  )
}
