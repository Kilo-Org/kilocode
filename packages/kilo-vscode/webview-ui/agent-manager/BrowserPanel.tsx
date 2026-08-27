import {
  createEffect,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  type Accessor,
  type Component,
  type Setter,
} from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../src/context/language"
import { useVSCode } from "../src/context/vscode"
import type { AgentManagerBrowserInspectionMessage, ExtensionMessage, WebviewMessage } from "../src/types/messages"
import { SidePanel } from "./side-panel-layout"
import { formatBrowserFeedback } from "../../src/shared/browser-feedback"

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
  title?: string
  active: boolean
  selecting: boolean
  docked: boolean
  ready: boolean
  loading: boolean
  errors: number
  onUrl: (value: string) => void
  onOpen: () => void
  onSelect: () => void
  onDevtools: () => void
  onRefresh: () => void
  onClose: () => void
}> = (props) => {
  const t = useLanguage().t
  const diagnostics = () =>
    props.errors
      ? `${t("agentManager.browser.devtoolsTitle")}, ${t("agentManager.browser.errors", { count: props.errors })}`
      : t("agentManager.browser.devtoolsTitle")
  return (
    <div class="am-browser-toolbar">
      <Tooltip value={t("agentManager.browser.refresh")} placement="bottom">
        <IconButton
          icon="refresh"
          size="small"
          variant="ghost"
          aria-label={t("agentManager.browser.refresh")}
          onClick={props.onRefresh}
          disabled={!props.ready || props.loading}
        />
      </Tooltip>
      <form
        class="am-browser-address"
        title={props.title}
        onSubmit={(event) => {
          event.preventDefault()
          if (props.active && props.url.trim() && !props.loading) props.onOpen()
        }}
      >
        <span class="am-browser-site" aria-hidden="true">
          <Show when={props.loading} fallback={<Icon name="globe" size="small" />}>
            <Spinner />
          </Show>
        </span>
        <TextField
          class="am-browser-url"
          variant="ghost"
          value={props.url}
          onChange={props.onUrl}
          placeholder={t("agentManager.browser.urlPlaceholder")}
          aria-label={t("agentManager.browser.url")}
          spellcheck={false}
          autocomplete="off"
          onFocus={(event: FocusEvent & { currentTarget: HTMLInputElement }) => event.currentTarget.select()}
        />
        <Tooltip value={t("agentManager.browser.open")} placement="bottom">
          <IconButton
            type="submit"
            icon="arrow-right"
            size="small"
            variant="ghost"
            aria-label={t("agentManager.browser.open")}
            disabled={!props.url.trim() || !props.active || props.loading}
          />
        </Tooltip>
      </form>
      <Tooltip value={t("agentManager.browser.inspect")} placement="bottom">
        <IconButton
          icon="window-cursor"
          size="small"
          variant={props.selecting ? "secondary" : "ghost"}
          aria-label={t("agentManager.browser.inspect")}
          aria-pressed={props.selecting}
          disabled={!props.ready || props.loading}
          onClick={props.onSelect}
        />
      </Tooltip>
      <div class="am-browser-tools-action">
        <Tooltip value={diagnostics()} placement="bottom">
          <IconButton
            icon="console"
            size="small"
            variant={props.docked ? "secondary" : "ghost"}
            aria-label={diagnostics()}
            aria-pressed={props.docked}
            onClick={props.onDevtools}
            disabled={!props.ready || props.loading}
          />
        </Tooltip>
        <Show when={props.errors > 0}>
          <span class="am-browser-error-count" aria-hidden="true">
            {props.errors > 99 ? "99+" : props.errors}
          </span>
        </Show>
      </div>
      <Tooltip value={t("agentManager.browser.close")} placement="bottom">
        <IconButton
          icon="close"
          size="small"
          variant="ghost"
          aria-label={t("agentManager.browser.close")}
          onClick={props.onClose}
        />
      </Tooltip>
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

const Preview: Component<{ url: string; navigation: number }> = (props) => {
  const t = useLanguage().t
  let frame: HTMLIFrameElement | undefined
  createEffect(
    on(
      () => props.navigation,
      (value, previous) => {
        if (previous === undefined || value === previous) return
        frame?.contentWindow?.location.replace(props.url)
      },
    ),
  )
  return (
    <iframe
      ref={frame}
      class="am-browser-frame"
      src={props.url}
      title={t("agentManager.browser.screenshotAlt")}
      sandbox="allow-scripts allow-forms allow-same-origin"
      referrerpolicy="no-referrer"
    />
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
    return url ? `${props.state?.browserId}:${url}` : undefined
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
        {(_key) => <Preview url={props.state?.url ?? ""} navigation={props.state?.navigation ?? 0} />}
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

const Tools: Component<{ url: string }> = (props) => {
  const t = useLanguage().t
  return (
    <section class="am-browser-devtools" aria-label={t("agentManager.browser.devtoolsTitle")}>
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
      ...(type.endsWith("open")
        ? { url: /^https?:\/\//i.test(url().trim()) ? url().trim() : `http://${url().trim()}` }
        : {}),
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
    const element = message.element
    if (!element?.selector) return
    const browser = {
      id: crypto.randomUUID(),
      sessionId: session,
      selector: element.selector,
      text: element.text,
      url: message.url,
      title: message.title,
      hierarchy: element.hierarchy,
      html: element.html,
      styles: element.styles,
      source: element.source,
    }
    const content = formatBrowserFeedback([browser])
    window.postMessage({ type: "appendChatBoxMessage", text: content, browser }, "*")
    setSelecting(false)
    stop()
  }

  createEffect(() => {
    const session = props.sessionId()
    setState(undefined)
    setUrl("")
    setSelecting(false)
    setPointing(false)
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

  const loading = () => state()?.status === "loading" || state()?.status === "starting"
  const close = () => {
    request("agentManager.browser.close")
    props.onClose()
  }

  return (
    <div
      class="am-browser-panel"
      aria-label={t("agentManager.browser.title")}
      aria-busy={loading()}
      data-status={state()?.status ?? "closed"}
    >
      <Toolbar
        url={url()}
        title={state()?.title}
        active={!!props.sessionId()}
        selecting={selecting()}
        docked={!!tools()}
        ready={!!state()?.url && state()?.status !== "closed"}
        loading={loading()}
        errors={state()?.errors ?? 0}
        onUrl={setUrl}
        onOpen={() => request("agentManager.browser.open")}
        onSelect={toggle}
        onDevtools={dock}
        onRefresh={() => request("agentManager.browser.refresh")}
        onClose={close}
      />
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
          {(entry) => <Tools url={entry.url} />}
        </Show>
      </div>
      <Show when={!tools()}>
        <Diagnostics logs={state()?.logs ?? []} />
      </Show>
    </div>
  )
}
