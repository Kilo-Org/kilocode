/**
 * The agent map: who started whom, below the current session.
 *
 * The current session sits on the left. Every agent it started, directly or
 * through another agent, fans out to the right, one column per generation:
 * Task subagents, Agent Manager sessions that an `agent_manager` call started,
 * and the background processes each of them runs. Opened from a subagent, the
 * map starts at that subagent. Selecting a node shows its details, with a way
 * to open its transcript or stop it.
 *
 * The extension walks the sessions on the backend (`src/kilo-provider/agent-map.ts`),
 * because the webview only holds the sessions it opened. The dialog asks again
 * while it is open, so status and timing stay current.
 *
 * Where the session has a shared agent board, a Board tab sits next to the
 * map. It reads the chat view's board, so a post read here is read in the
 * dock too. A node links to its posts and a post's sender links to its node.
 */

import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type Component } from "solid-js"
import { AgentAvatar } from "@kilocode/kilo-ui/agent-avatar"
import { Button } from "@kilocode/kilo-ui/button"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Tabs } from "@kilocode/kilo-ui/tabs"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useLanguage } from "../../context/language"
import { localeToBcp47 } from "../../context/language-utils"
import { useProvider } from "../../context/provider"
import { useSession } from "../../context/session"
import { useVSCode } from "../../context/vscode"
import { useWorktreeMode } from "../../context/worktree-mode"
import { formatDuration } from "../../utils/message-time"
import type { AgentMap, AgentMapNode, SessionBoard } from "../../types/messages"
import { active, count, elapsed, live, stoppable, total, tree } from "./agent-map"
import { shown, starter, taskPart } from "./background-agents"
import { openSubagent } from "./open-subagent"
import { BoardReader, useSharedSwarmBoard, type SwarmBoardState } from "./SwarmBoard"

/** How often the open dialog asks for a fresh map. */
const POLL = 2000
/** A request without a reply for this long is dropped, so polling resumes. */
const STALE = 10_000
/** Webview state key that remembers the "Hide finished" switch. */
const HIDE = "agentMapHideFinished"

/**
 * True when the current session started something the map can show. Calls in
 * reverted turns do not count: the map leaves out what they started.
 */
export function useAgentMapAvailable() {
  const session = useSession()
  return createMemo(() => {
    const id = session.currentSessionID()
    if (!id || id.startsWith("cloud:")) return false
    const revert = session.revert()
    return session.getSessionToolParts(id).some((part) => starter(part) && shown(part, revert))
  })
}

/**
 * Opens the agent map of the current session. A caller that holds a board
 * passes it; otherwise the dialog reads the chat view's board.
 */
export function useAgentMap(opts?: { readonly?: boolean; board?: SwarmBoardState }) {
  const dialog = useDialog()
  return () => dialog.show(() => <AgentMapDialog readonly={opts?.readonly} board={opts?.board} />)
}

/** The header button that opens the map. */
export const AgentMapButton: Component<{ readonly?: boolean }> = (props) => {
  const language = useLanguage()
  const open = useAgentMap({
    get readonly() {
      return props.readonly
    },
  })
  return (
    <Tooltip value={language.t("agentMap.open")} placement="bottom">
      <IconButton
        icon="circuit-board"
        size="small"
        variant="ghost"
        data-slot="agent-map-trigger"
        aria-label={language.t("agentMap.open")}
        onClick={open}
      />
    </Tooltip>
  )
}

const AgentMapDialog: Component<{ readonly?: boolean; board?: SwarmBoardState }> = (props) => {
  const session = useSession()
  const vscode = useVSCode()
  const language = useLanguage()
  const provider = useProvider()
  const worktree = useWorktreeMode()
  const dialog = useDialog()
  // The map belongs to the session the dialog opened from.
  const id = session.currentSessionID()
  const [map, setMap] = createSignal<AgentMap>()
  const [error, setError] = createSignal<string>()
  const [selected, setSelected] = createSignal<string>()
  const [now, setNow] = createSignal(Date.now())
  const [hide, setHide] = createSignal(vscode.getState<Record<string, unknown>>()?.[HIDE] === true)
  const toggle = (value: boolean) => {
    setHide(value)
    vscode.setState({ ...vscode.getState<Record<string, unknown>>(), [HIDE]: value })
  }
  let pending: { id: string; at: number } | undefined
  let revision = 0

  const shared = useSharedSwarmBoard()
  const board = props.board ?? shared
  // The map and board belong to the session the dialog opened for. Another
  // session's chat would show the wrong agents and posts, so it closes.
  createEffect(on(session.currentSessionID, (next) => next !== id && dialog.close(), { defer: true }))
  const [tab, setTab] = createSignal("map")
  // The node whose posts the Board tab shows. Unset shows every post.
  const [about, setAbout] = createSignal<string>()
  const boarded = () => !!board?.available()
  const shown = () => (boarded() ? tab() : "map")
  createEffect(on(shown, (value) => value === "board" && board?.load(), { defer: true }))
  // Posts shown on the Board tab count as read, also ones that arrive while it is open.
  createEffect(() => {
    if (shown() !== "board" || !board) return
    board.messages()
    board.mark()
  })

  // Each request walks the whole family on the backend. The map is out of
  // sight while the webview is hidden or the Board tab shows, so polls wait
  // until it shows again, and then one runs at once.
  const visible = () => vscode.active() && shown() === "map"
  const request = () => {
    if (!id || !visible()) return
    if (pending && Date.now() - pending.at < STALE) return
    pending = { id: `agent-map:${id}:${++revision}`, at: Date.now() }
    vscode.postMessage({ type: "requestAgentMap", sessionID: id, requestID: pending.id })
  }
  createEffect(on(visible, (value) => value && request(), { defer: true }))

  onMount(() => {
    const unsub = vscode.onMessage((message) => {
      if (message.type !== "agentMapLoaded" || message.requestID !== pending?.id) return
      pending = undefined
      setError(message.error)
      if (message.map) setMap(message.map)
    })
    request()
    const poll = setInterval(request, POLL)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => {
      unsub()
      clearInterval(poll)
      clearInterval(tick)
    })
  })

  const nodes = createMemo(() => new Map((map()?.nodes ?? []).map((node) => [node.id, node])))
  const kids = createMemo(() => {
    const value = map()
    if (!value) return new Map<string, string[]>()
    return tree(value, hide() ? active(value) : undefined)
  })
  // Whether the root started anything at all, so a hidden subtree reads as
  // "nothing runs" rather than "nothing started".
  const started = createMemo(() => (map()?.nodes.length ?? 0) > 1)
  const stats = createMemo(() => {
    const value = map()
    return value ? count(value) : undefined
  })
  const detail = createMemo(() => {
    const key = selected()
    return key ? nodes().get(key) : undefined
  })

  const locale = createMemo(() => localeToBcp47(language.locale()))
  const compact = createMemo(() => new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }))
  const money = createMemo(() => new Intl.NumberFormat(locale(), { style: "currency", currency: "USD" }))

  const tokens = (node: AgentMapNode) => {
    const value = total(node.tokens)
    if (value <= 0) return undefined
    return language.t("agentMap.tokens", { count: compact().format(value) })
  }
  const model = (node: AgentMapNode) => {
    if (!node.model) return undefined
    const info = provider.findModel({ providerID: node.model.providerID, modelID: node.model.modelID })
    return info?.name ?? node.model.modelID
  }
  const duration = (node: AgentMapNode) => formatDuration(elapsed(node, now()))
  const status = (node: AgentMapNode) => language.t(`agentMap.status.${node.status}`)
  const kind = (node: AgentMapNode) => {
    if (node.kind === "task" && node.background) return language.t("agentMap.kind.background")
    return language.t(`agentMap.kind.${node.kind}`)
  }
  const summary = () => {
    const value = stats()
    if (!value) return undefined
    const parts = [
      value.agents === 1
        ? language.t("agentMap.agents.one")
        : language.t("agentMap.agents.many", { count: String(value.agents) }),
    ]
    if (value.processes === 1) parts.push(language.t("agentMap.processes.one"))
    if (value.processes > 1) parts.push(language.t("agentMap.processes.many", { count: String(value.processes) }))
    if (value.running > 0) parts.push(language.t("agentMap.running", { count: String(value.running) }))
    return parts.join(" · ")
  }

  // The second line of a card: what the node is and how much it has done.
  // Running and finished read from the dot; states that need a look also
  // say so in words.
  const meta = (node: AgentMapNode) => {
    const flag = node.status === "running" || node.status === "done" ? undefined : status(node)
    if (node.kind === "root") return [flag, model(node), tokens(node)]
    if (node.kind === "process") return [flag, duration(node), node.ports?.map((port) => `:${port}`).join(" ")]
    return [flag, node.kind === "session" ? kind(node) : node.agent, duration(node), tokens(node)]
  }

  // The dialog stays open, so the user can open more transcripts or come back
  // to the map. The current session's transcript is the chat behind the
  // dialog, so opening it only closes the dialog.
  const open = (node: AgentMapNode) => {
    if (node.id === session.currentSessionID()) {
      dialog.close()
      return
    }
    openSubagent({
      sessionID: node.id,
      title: node.title,
      // Agent Manager only opens agents under a session it manages: the chat's own.
      parentSessionID: session.currentSessionID(),
      worktree: !!worktree,
      post: vscode.postMessage,
    })
  }
  // What Stop all stops: the running agents below the root that no running
  // agent above them stops already.
  const working = createMemo(() => {
    const current = map()
    return current ? stoppable(current) : []
  })
  // An agent stops with anything it started.
  const stop = (node: AgentMapNode) => {
    if (node.kind === "process") {
      vscode.postMessage({ type: "stopBackgroundProcess", sessionID: node.parent ?? id ?? "", processID: node.id })
      return
    }
    vscode.postMessage({ type: "abort", sessionID: node.id, scope: "tree" })
  }
  // The board names its owner session "main".
  const alias = (id: string) => (id === board?.source.board()?.ownerSessionID ? "main" : id)
  const mine = (id: string) => (post: SessionBoard["messages"][number]) =>
    post.from === alias(id) || post.to === alias(id)
  const posted = (id: string) => board?.messages().filter(mine(id)).length ?? 0
  // A sender on the board opens its node on the map when the map has it, and
  // otherwise its transcript, with the dialog left open like Open transcript.
  const sender = (id: string, title?: string) => {
    const key = id === "main" ? board?.source.board()?.ownerSessionID : id
    if (key && nodes().has(key)) {
      setSelected(key)
      setTab("map")
      return
    }
    board?.navigate(id, title)
  }

  const prompt = (node: AgentMapNode) => {
    if (node.kind !== "task" || !node.parent) return undefined
    const input = taskPart(session.getSessionToolParts(node.parent), node.id)?.state.input
    const value = input?.prompt
    return typeof value === "string" && value.trim() ? value : undefined
  }

  // Agents carry the same avatar as their task cards and the transcript, so
  // one agent reads as one identity everywhere. Processes have no avatar.
  const Lead: Component<{ node: AgentMapNode }> = (lead) => (
    <span data-slot="agent-map-node-lead">
      <Show when={lead.node.kind !== "process"} fallback={<Icon name="console" size="small" />}>
        <AgentAvatar id={lead.node.id} status={lead.node.status === "running" ? "running" : undefined} />
      </Show>
    </span>
  )

  const Card: Component<{ id: string }> = (card) => {
    const node = () => nodes().get(card.id)
    return (
      <Show when={node()}>
        {(item) => (
          <button
            type="button"
            data-slot="agent-map-node"
            data-id={item().id}
            data-kind={item().kind}
            data-status={item().status}
            aria-label={`${item().title}. ${kind(item())}. ${status(item())}`}
            onClick={() => setSelected(item().id)}
          >
            <span data-slot="agent-map-node-head">
              <Lead node={item()} />
              <span data-slot="agent-map-node-title" dir="auto">
                {item().title}
              </span>
              <Show when={item().kind === "session"}>
                <Icon name="organization" size="small" />
              </Show>
              <span data-slot="agent-map-dot" data-status={item().status} />
            </span>
            <span data-slot="agent-map-node-meta">{meta(item()).filter(Boolean).join(" · ")}</span>
          </button>
        )}
      </Show>
    )
  }

  const Branch: Component<{ id: string }> = (branch) => {
    const children = () => kids().get(branch.id) ?? []
    return (
      <li data-slot="agent-map-branch">
        <Card id={branch.id} />
        <Show when={children().length > 0}>
          <ul data-slot="agent-map-children">
            <For each={children()}>{(child) => <Branch id={child} />}</For>
          </ul>
        </Show>
      </li>
    )
  }

  const Detail: Component<{ node: AgentMapNode }> = (view) => {
    const node = () => view.node
    const parent = () => (node().parent ? nodes().get(node().parent ?? "") : undefined)
    const stoppable = () => !props.readonly && live(node())
    const line = () =>
      [status(node()), kind(node()), node().kind === "process" ? undefined : node().agent, model(node())]
        .filter(Boolean)
        .join(" · ")
    const facts = () => {
      const item = node()
      const rows: Array<[string, string]> = []
      if (item.kind !== "root") rows.push([language.t("agentMap.field.duration"), duration(item)])
      const used = tokens(item)
      if (used) rows.push([language.t("agentMap.field.tokens"), used])
      if (item.cost) rows.push([language.t("agentMap.field.cost"), money().format(item.cost)])
      if (item.command) rows.push([language.t("agentMap.field.command"), item.command])
      if (item.pid) rows.push([language.t("agentMap.field.pid"), String(item.pid)])
      if (item.ports) rows.push([language.t("agentMap.field.ports"), item.ports.join(", ")])
      return rows
    }
    return (
      <div data-slot="agent-map-detail">
        <div data-slot="agent-map-detail-head">
          <IconButton
            icon="arrow-left"
            size="small"
            variant="ghost"
            aria-label={language.t("agentMap.back")}
            onClick={() => setSelected(undefined)}
          />
          <Lead node={node()} />
          <span data-slot="agent-map-detail-title" dir="auto">
            {node().title}
          </span>
          <span data-slot="agent-map-dot" data-status={node().status} />
        </div>
        <p data-slot="agent-map-detail-line">{line()}</p>
        <dl data-slot="agent-map-facts">
          <Show when={parent()}>
            {(item) => (
              <>
                <dt>{language.t("agentMap.field.startedBy")}</dt>
                <dd>
                  <button type="button" data-slot="agent-map-link" dir="auto" onClick={() => setSelected(item().id)}>
                    {item().title}
                  </button>
                </dd>
              </>
            )}
          </Show>
          <For each={facts()}>
            {(row) => (
              <>
                <dt>{row[0]}</dt>
                <dd dir="auto">{row[1]}</dd>
              </>
            )}
          </For>
        </dl>
        <Show when={prompt(node())}>
          {(text) => (
            <div data-slot="agent-map-prompt">
              <span data-slot="agent-map-prompt-label">{language.t("agentMap.field.prompt")}</span>
              <pre dir="auto">{text()}</pre>
            </div>
          )}
        </Show>
        <div data-slot="agent-map-actions">
          <Show when={node().kind !== "process"}>
            <Button variant="secondary" size="small" icon="square-arrow-top-right" onClick={() => open(node())}>
              {language.t("agentMap.action.open")}
            </Button>
          </Show>
          <Show when={boarded() && node().kind !== "process" && posted(node().id) > 0}>
            <Button
              variant="ghost"
              size="small"
              icon="speech-bubble"
              onClick={() => {
                setAbout(node().id)
                setTab("board")
              }}
            >
              {language.t("agentMap.board.posts", { count: String(posted(node().id)) })}
            </Button>
          </Show>
          <Show when={stoppable()}>
            <Button variant="ghost" size="small" icon="stop" onClick={() => stop(node())}>
              {language.t(node().kind === "process" ? "agentMap.action.stopProcess" : "agentMap.action.stop")}
            </Button>
          </Show>
        </div>
      </div>
    )
  }

  const boardView = () => {
    const state = board
    if (!state) return null
    let resume = () => {}
    const focus = () => {
      const key = about()
      return key ? nodes().get(key) : undefined
    }
    // Reset asks in place, so the dialog and its tab stay where they are.
    const [asking, setAsking] = createSignal(false)
    // The confirmation leaves the DOM with its focused button. Focus goes back
    // to Reset on cancel, or to the board while the reset runs and Reset is
    // disabled, so the keyboard and Escape keep working in the dialog.
    let panel: HTMLDivElement | undefined
    let trigger: HTMLButtonElement | undefined
    return (
      <div data-slot="agent-map-board" tabIndex={-1} ref={panel}>
        <div data-slot="agent-map-bar">
          <Show when={focus()} fallback={<span />}>
            {(node) => (
              <span data-slot="agent-map-filter">
                <span dir="auto">{language.t("agentMap.board.filter", { name: node().title })}</span>
                <Button variant="ghost" size="small" onClick={() => setAbout(undefined)}>
                  {language.t("agentMap.board.all")}
                </Button>
              </span>
            )}
          </Show>
          <span data-slot="agent-map-board-actions">
            <Show when={state.busy()}>
              <span role="status" aria-label={language.t("task.swarm.loading")}>
                <Spinner />
              </span>
            </Show>
            <Tooltip value={language.t("task.swarm.refresh")}>
              <IconButton
                icon="refresh"
                size="small"
                variant="ghost"
                aria-label={language.t("task.swarm.refresh")}
                disabled={state.busy()}
                onClick={() => {
                  resume()
                  state.load()
                }}
              />
            </Tooltip>
            <Tooltip value={language.t("task.swarm.reset")}>
              <IconButton
                ref={trigger}
                icon="trash"
                size="small"
                variant="ghost"
                aria-label={language.t("task.swarm.reset")}
                // A failed load or reset may hold a stale revision: refresh first.
                disabled={state.busy() || state.messages().length === 0 || !!state.source.error()}
                onClick={() => setAsking(true)}
              />
            </Tooltip>
          </span>
        </div>
        <Show when={asking()}>
          <div data-slot="agent-map-confirm" role="group" aria-label={language.t("task.swarm.resetTitle")}>
            <div>
              <p data-slot="agent-map-confirm-title">{language.t("task.swarm.resetTitle")}</p>
              <p data-slot="agent-map-note">{language.t("task.swarm.resetDescription")}</p>
            </div>
            <div data-slot="agent-map-actions">
              <Button
                variant="ghost"
                size="small"
                onClick={() => {
                  setAsking(false)
                  trigger?.focus()
                }}
              >
                {language.t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                size="small"
                onClick={() => {
                  setAsking(false)
                  setAbout(undefined)
                  state.reset()
                  panel?.focus()
                }}
              >
                {language.t("task.swarm.reset")}
              </Button>
            </div>
          </div>
        </Show>
        <Show when={state.source.error()}>{(message) => <p role="alert">{message()}</p>}</Show>
        <Show
          when={state.messages().length > 0}
          fallback={
            <p data-slot="agent-map-note">{language.t(state.busy() ? "task.swarm.loading" : "agentMap.board.empty")}</p>
          }
        >
          <BoardReader
            source={state.source}
            working={() => shown() === "board"}
            filter={focus() ? mine(focus()!.id) : undefined}
            onAgent={sender}
            controls={(value) => {
              resume = value.resume
            }}
          />
        </Show>
      </div>
    )
  }

  const mapView = () => (
    <>
      <Show when={error()}>{(message) => <p role="alert">{message()}</p>}</Show>
      <Show
        when={map()}
        fallback={
          <Show when={!error()}>
            <div data-slot="agent-map-loading" role="status">
              <Spinner />
              <span>{language.t("agentMap.loading")}</span>
            </div>
          </Show>
        }
      >
        {(value) => (
          <Show
            when={detail()}
            fallback={
              <>
                <div data-slot="agent-map-bar">
                  <p data-slot="agent-map-summary">{summary()}</p>
                  <span data-slot="agent-map-board-actions">
                    <Show when={!props.readonly && working().length > 1}>
                      <Button variant="ghost" size="small" icon="stop" onClick={() => working().forEach(stop)}>
                        {language.t("task.backgroundAgents.stopAll", { count: String(working().length) })}
                      </Button>
                    </Show>
                    <Switch checked={hide()} onChange={toggle}>
                      {language.t("agentMap.hideFinished")}
                    </Switch>
                  </span>
                </div>
                <div data-slot="agent-map-canvas" tabIndex={0} role="region" aria-label={language.t("agentMap.title")}>
                  <ul data-slot="agent-map-tree">
                    <Branch id={value().root} />
                  </ul>
                </div>
                <Show when={(kids().get(value().root) ?? []).length === 0}>
                  <p data-slot="agent-map-note">{language.t(started() ? "agentMap.idle" : "agentMap.empty")}</p>
                </Show>
                <p data-slot="agent-map-note">{language.t("agentMap.hint")}</p>
                <Show when={value().truncated}>
                  <p data-slot="agent-map-note">{language.t("agentMap.truncated")}</p>
                </Show>
              </>
            }
          >
            {(node) => <Detail node={node()} />}
          </Show>
        )}
      </Show>
    </>
  )

  return (
    <Dialog
      title={language.t("agentMap.dialog")}
      size="large"
      class="agent-map"
      action={
        <IconButton
          icon="close-small"
          size="small"
          variant="ghost"
          aria-label={language.t("common.close")}
          onClick={() => dialog.close()}
        />
      }
    >
      <Show when={boarded()} fallback={mapView()}>
        <Tabs variant="alt" value={shown()} onChange={setTab}>
          <Tabs.List>
            <Tabs.Trigger value="map">{language.t("agentMap.tabs.map")}</Tabs.Trigger>
            <Tabs.Trigger value="board">
              {language.t("task.swarm.title")}
              <Show when={board?.unread() && shown() !== "board"}>
                <span data-slot="agent-map-unread" aria-hidden="true" />
              </Show>
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="map">{mapView()}</Tabs.Content>
          <Tabs.Content value="board">{boardView()}</Tabs.Content>
        </Tabs>
      </Show>
    </Dialog>
  )
}
