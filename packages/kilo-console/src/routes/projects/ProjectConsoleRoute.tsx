import { A, useLocation, useParams } from "@solidjs/router"
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show } from "solid-js"
import { Badge } from "@kilocode/kilo-web-ui/badge"
import { Button } from "@kilocode/kilo-web-ui/button"
import { Card } from "@kilocode/kilo-web-ui/card"
import { Icon } from "@kilocode/kilo-web-ui/icon"
import { ResizeHandle } from "@kilocode/kilo-web-ui/resize-handle"
import { Spinner } from "@kilocode/kilo-web-ui/spinner"
import { File } from "@opencode-ai/ui/file"
import { FileComponentProvider } from "@opencode-ai/ui/context/file"
import { SessionReview, type SessionReviewDiffStyle } from "@opencode-ai/ui/session-review"
import { ConfirmDialog } from "../../components/ConfirmDialog"
import { LoadingScreen } from "../../components/LoadingScreen"
import { PromptDialog } from "../../components/PromptDialog"
import {
  createProjectPty,
  createProjectWorktree,
  discover,
  forgetCached,
  loadCached,
  loadProjectConsole,
  loadProjectDiff,
  loadProjectDiffFile,
  patchConfig,
  removeProjectPty,
  removeProjectWorktree,
  resetProjectWorktree,
  resolveServer,
  saveCached,
  subscribeProjectEvents,
  viewProjectSessions,
  type ProjectConsoleEvent,
  type ProjectConsoleQuery,
  type ProjectDiffItem,
  type ProjectTerminalItem,
  type Query,
} from "../../client"
import { clean, errMsg, friendly } from "../../shared/utils"
import {
  markUnread as storeMarkUnread,
  clearUnread as storeClearUnread,
  sessionHasUnread,
} from "../../shared/terminal-status"
import {
  DEFAULT_CONSOLE_DIFF_STYLE,
  DEFAULT_CONTEXT_SIDEBAR_WIDTH,
  MAX_CONTEXT_SIDEBAR_WIDTH,
  MIN_CONTEXT_SIDEBAR_WIDTH,
  normalizeConsoleDiffStyle,
  normalizeContextSidebarWidth,
} from "../config/state/console"
import { GhosttyTerminal } from "./terminal/GhosttyTerminal"

const ui = new Set(["3017", "3018"])

type Context = {
  id: string
  dir: string
  label: string
  kind: "local" | "worktree"
}

type Editor = { kind: "create"; value: string } | { kind: "rename"; item: Context; value: string }

type Pending = {
  kind: "delete" | "reset"
  item: Context
}

function discoverable(search: URLSearchParams) {
  if (search.get("server")) return false
  return ui.has(window.location.port)
}

function base(search: URLSearchParams) {
  const param = search.get("server")
  if (param) return param
  const cached = discoverable(search) ? loadCached() : ""
  if (cached) return cached
  if (discoverable(search)) return ""
  return window.location.origin
}

function repo(input: string) {
  const parts = input.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? "Project"
}

function title(input: string) {
  return friendly(repo(input))
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null
}

function nested(input: unknown, key: string) {
  if (!record(input)) return undefined
  const value = input[key]
  if (!record(value)) return undefined
  return value
}

function eventSession(event: ProjectConsoleEvent) {
  const payload = event.payload
  const props: unknown = "properties" in payload ? payload.properties : "data" in payload ? payload.data : undefined
  if (!record(props)) return undefined
  const id = props["sessionID"]
  if (typeof id === "string") return id
  const info = nested(props, "info")
  if (typeof info?.["sessionID"] === "string") return info["sessionID"]
  if (typeof info?.["id"] === "string") return info["id"]
  const part = nested(props, "part")
  if (typeof part?.["sessionID"] === "string") return part["sessionID"]
  return undefined
}

function eventType(event: ProjectConsoleEvent) {
  const payload = event.payload as { type?: string; name?: unknown; syncEvent?: { type?: unknown } }
  if (!payload.type) return ""
  if (payload.type !== "sync") return payload.type
  if (typeof payload.name === "string") return payload.name
  if (typeof payload.syncEvent?.type === "string") return payload.syncEvent.type
  return ""
}

function messageEvent(event: ProjectConsoleEvent) {
  return eventType(event).startsWith("message.")
}

function refreshEvent(event: ProjectConsoleEvent) {
  const type = eventType(event)
  if (type.startsWith("pty.")) return true
  if (type.startsWith("session.")) return true
  if (type.startsWith("permission.")) return true
  if (type.startsWith("question.")) return true
  if (type.startsWith("message.")) return true
  return false
}

function terminalKey(url: string, item: ProjectTerminalItem) {
  return `${url}\n${item.directory}\n${item.id}`
}

export function ProjectConsoleRoute() {
  const loc = useLocation()
  const params = useParams()
  const search = createMemo(() => new URLSearchParams(loc.search))
  const fallback = () => base(search())
  const [url, setUrl] = createSignal(fallback())
  const [selected, setSelected] = createSignal(window.localStorage.getItem(`kilo.console.${params.project}.dir`) ?? "")
  const [active, setActive] = createSignal(window.localStorage.getItem(`kilo.console.${params.project}.pty`) ?? "")
  const [local, setLocal] = createSignal<ProjectTerminalItem[]>([])
  const [openFiles, setOpenFiles] = createSignal<string[]>([])
  const [details, setDetails] = createSignal<Record<string, ProjectDiffItem>>({})
  const [infoWidth, setInfoWidth] = createSignal(DEFAULT_CONTEXT_SIDEBAR_WIDTH)
  const [viewport, setViewport] = createSignal(window.innerWidth)
  const [diffStyle, setDiffStyle] = createSignal<SessionReviewDiffStyle>(DEFAULT_CONSOLE_DIFF_STYLE)
  const [saving, setSaving] = createSignal<string | undefined>()
  const [failure, setFailure] = createSignal<string | undefined>()
  const [unread, setUnread] = createSignal(new Set<string>())
  const [closing, setClosing] = createSignal(new Set<string>())
  const [labelRev, setLabelRev] = createSignal(0)
  const [editor, setEditor] = createSignal<Editor | undefined>()
  const [pending, setPending] = createSignal<Pending | undefined>()
  const events = { timer: undefined as number | undefined }
  const resize = { timer: undefined as number | undefined, pending: false }
  const detailPending = new Set<string>()
  const project = () => params.project ?? ""
  const query = createMemo<ProjectConsoleQuery | undefined>(() => {
    const target = clean(url()) || fallback()
    if (!target || !project()) return undefined
    return { url: target, dir: "", project: project() }
  })
  const [snap, { refetch }] = createResource(query, loadProjectConsole)
  const visibleInfoWidth = createMemo(() => Math.min(infoWidth(), maxInfoWidth()))

  const contexts = createMemo<Context[]>(() => {
    const data = snap()
    if (!data) return []
    return [
      { id: "local", dir: data.project.worktree, label: "Local", kind: "local" },
      ...data.worktrees.map((dir) => ({ id: dir, dir, label: title(dir), kind: "worktree" as const })),
    ]
  })
  const terminals = createMemo(() => {
    const items = new Map<string, ProjectTerminalItem>()
    const closed = closing()
    for (const item of local()) {
      if (closed.has(item.id)) continue
      if (item.status === "running") items.set(item.id, item)
    }
    for (const item of snap()?.terminals ?? []) {
      if (closed.has(item.id)) continue
      if (item.status === "running") items.set(item.id, item)
    }
    return Array.from(items.values())
  })
  const grouped = createMemo(() => {
    const items = new Map<string, ProjectTerminalItem[]>()
    for (const item of terminals()) {
      const list = items.get(item.directory) ?? []
      list.push(item)
      items.set(item.directory, list)
    }
    return items
  })
  const current = createMemo(() => contexts().find((item) => item.dir === selected()) ?? contexts()[0])
  const activeTerminal = createMemo(() => terminals().find((item) => item.id === active()))
  const target = createMemo<Query | undefined>(() => {
    const data = snap()
    const item = current()
    const base = query()
    if (!data || !item || !base) return undefined
    return { url: base.url, dir: item.dir, scope: "project" }
  })
  const diffKey = createMemo(() => {
    const item = target()
    if (!item) return undefined
    return { input: item, dir: item.dir }
  })
  const [diffs] = createResource(diffKey, (item) => loadProjectDiff(item.input, item.dir))
  // Diff summary items carry no content (patch/before/after empty); overlay full file
  // diffs as they load so the review renders syntax-highlighted changes per file.
  const reviewDiffs = createMemo<ProjectDiffItem[]>(() => {
    const map = details()
    return (diffs() ?? [])
      .filter((item): item is ProjectDiffItem & { file: string } => typeof item.file === "string")
      .map((item) => map[item.file] ?? item)
  })
  const terminal = createMemo(() => {
    const item = activeTerminal()
    const base = query()
    if (!item || !base) return undefined
    return terminalKey(base.url, item)
  })
  const terminalMap = createMemo(() => {
    const items = new Map<string, ProjectTerminalItem>()
    const base = query()
    if (!base) return items
    for (const item of terminals()) items.set(terminalKey(base.url, item), item)
    return items
  })
  const terminalKeys = createMemo(() => Array.from(terminalMap().keys()))
  const settings = createMemo(() => {
    const q = search().toString()
    return `/projects/${encodeURIComponent(project())}/settings${q ? `?${q}` : ""}`
  })

  function projectInput(): Query | undefined {
    const base = query()
    const data = snap()
    if (!base || !data) return undefined
    return { url: base.url, dir: data.project.worktree, scope: "project" }
  }

  function labelKey(dir: string) {
    return `kilo.console.${project()}.worktree.${encodeURIComponent(dir)}.label`
  }

  function displayLabel(item: Context) {
    labelRev()
    return window.localStorage.getItem(labelKey(item.dir))?.trim() || item.label
  }

  function currentLabel() {
    const item = current()
    if (!item) return "Project"
    return displayLabel(item)
  }

  function sessionID(item: ProjectTerminalItem | undefined) {
    return item?.sessionID ?? item?.session?.id
  }

  function activeSessionID() {
    return sessionID(activeTerminal())
  }

  function terminalName(item: ProjectTerminalItem) {
    return item.session?.title || item.title || `Terminal ${item.id.slice(-4)}`
  }

  function terminalState(item: ProjectTerminalItem) {
    if (item.attention) return "attention"
    if (item.sessionStatus && item.sessionStatus.type !== "idle") return "busy"
    const id = sessionID(item)
    if (id && unread().has(id)) return "unread"
    return "idle"
  }

  function clearUnread(item: ProjectTerminalItem) {
    const id = sessionID(item)
    if (!id || !unread().has(id)) return
    setUnread((old) => {
      const next = new Set(old)
      next.delete(id)
      return next
    })
    const pid = snap()?.project.id
    if (pid && id) storeClearUnread(pid, id)
  }

  function markUnread(id: string) {
    if (id === activeSessionID()) return
    setUnread((old) => {
      if (old.has(id)) return old
      return new Set([...old, id])
    })
    const pid = snap()?.project.id
    if (pid) storeMarkUnread(pid, id)
  }

  function scheduleRefetch() {
    if (events.timer) return
    events.timer = window.setTimeout(() => {
      events.timer = undefined
      void refetch()
    }, 150)
  }

  function terminalsFor(dir: string) {
    return grouped().get(dir) ?? []
  }

  function remember(dir: string, pty?: string) {
    window.localStorage.setItem(`kilo.console.${project()}.dir`, dir)
    if (pty) {
      window.localStorage.setItem(`kilo.console.${project()}.pty`, pty)
      return
    }
    window.localStorage.removeItem(`kilo.console.${project()}.pty`)
  }

  function select(item: Context) {
    setSelected(item.dir)
    const pty = terminalsFor(item.dir)[0]
    setActive(pty?.id ?? "")
    remember(item.dir, pty?.id)
  }

  function selectTerminal(item: ProjectTerminalItem) {
    setSelected(item.directory)
    setActive(item.id)
    clearUnread(item)
    remember(item.directory, item.id)
  }

  function fetchDetail(path: string) {
    const base = target()
    if (!base) return
    if (details()[path] || detailPending.has(path)) return
    detailPending.add(path)
    void loadProjectDiffFile(base, base.dir, path)
      .then((item) => {
        if (item && item.file) setDetails((prev) => ({ ...prev, [item.file!]: item }))
      })
      .catch((err) => console.warn("Worktree diff file:", err))
      .finally(() => detailPending.delete(path))
  }

  function openReviewFiles(next: string[]) {
    setOpenFiles(next)
    for (const path of next) fetchDetail(path)
  }

  function changeDiffStyle(style: SessionReviewDiffStyle) {
    setDiffStyle(style)
    const base = query()
    if (!base) return
    void patchConfig({ url: base.url, dir: "", scope: "global" }, { console: { diff_style: style } }).catch((err) =>
      console.warn(`Console diff style: ${errMsg(err)}`),
    )
  }

  function resizeInfo(value: number) {
    const width = normalizeContextSidebarWidth(value)
    setInfoWidth(width)
    resize.pending = true
    if (resize.timer) window.clearTimeout(resize.timer)
    resize.timer = window.setTimeout(() => {
      resize.timer = undefined
      const base = query()
      if (!base) {
        resize.pending = false
        return
      }
      void patchConfig({ url: base.url, dir: "", scope: "global" }, { console: { context_sidebar_width: width } })
        .catch((err) => console.warn(`Console sidebar width: ${errMsg(err)}`))
        .finally(() => {
          resize.pending = false
        })
    }, 350)
  }

  function maxInfoWidth() {
    return Math.max(MIN_CONTEXT_SIDEBAR_WIDTH, Math.min(MAX_CONTEXT_SIDEBAR_WIDTH, viewport() - 604))
  }

  function run(label: string, job: () => Promise<unknown>) {
    setSaving(label)
    setFailure(undefined)
    void job()
      .then(() => refetch())
      .catch((err) => setFailure(errMsg(err)))
      .finally(() => setSaving(undefined))
  }

  function addWorktree() {
    if (!projectInput()) return
    setEditor({ kind: "create", value: "" })
  }

  function submitEditor() {
    const state = editor()
    if (!state) return
    if (state.kind === "rename") {
      const value = state.value.trim()
      if (value) window.localStorage.setItem(labelKey(state.item.dir), value)
      if (!value) window.localStorage.removeItem(labelKey(state.item.dir))
      setLabelRev((revision) => revision + 1)
      setEditor(undefined)
      return
    }

    const input = projectInput()
    if (!input) return
    const name = state.value.trim() || undefined
    setEditor(undefined)
    run("Creating worktree", async () => {
      const next = await createProjectWorktree(input, name)
      setSelected(next.directory)
      window.localStorage.setItem(`kilo.console.${project()}.dir`, next.directory)
    })
  }

  function addSession(item = current()) {
    const base = query()
    if (!base || !item) return
    const input = { url: base.url, dir: item.dir, scope: "project" as const }
    const label = `Kilo ${terminalsFor(item.dir).length + 1}`
    setSaving("Creating session")
    setFailure(undefined)
    void createProjectPty(input, item.dir, label)
      .then((pty) => {
        const next = { ...pty, directory: item.dir }
        setLocal((rows) => [...rows.filter((row) => row.id !== next.id), next])
        setSelected(item.dir)
        setActive(next.id)
        remember(item.dir, next.id)
        return refetch()
      })
      .catch((err) => setFailure(errMsg(err)))
      .finally(() => setSaving(undefined))
  }

  function forgetTerminal(id: string) {
    setLocal((rows) => rows.filter((row) => row.id !== id))
    if (active() === id) {
      setActive("")
      window.localStorage.removeItem(`kilo.console.${project()}.pty`)
    }
  }

  function dropTerminal(id: string) {
    forgetTerminal(id)
    void refetch()
  }

  function closeTerminal(item: ProjectTerminalItem) {
    const input = { url: query()?.url ?? "", dir: item.directory, scope: "project" as const }
    if (!input.url) return
    setClosing((old) => new Set([...old, item.id]))
    forgetTerminal(item.id)
    setSaving("Closing terminal")
    setFailure(undefined)
    void removeProjectPty(input, item.id)
      .then(() => refetch())
      .then(() => {
        setClosing((old) => {
          const next = new Set(old)
          next.delete(item.id)
          return next
        })
      })
      .catch((err) => {
        setClosing((old) => {
          const next = new Set(old)
          next.delete(item.id)
          return next
        })
        setFailure(errMsg(err))
      })
      .finally(() => setSaving(undefined))
  }

  function renameWorktree(item: Context) {
    if (item.kind === "local") return
    setEditor({ kind: "rename", item, value: displayLabel(item) })
  }

  function removeWorktree(item: Context) {
    if (!projectInput() || item.kind === "local") return
    setPending({ kind: "delete", item })
  }

  function removeSelected() {
    const item = current()
    if (!item) return
    removeWorktree(item)
  }

  function resetSelected() {
    const item = current()
    if (!projectInput() || !item || item.kind === "local") return
    setPending({ kind: "reset", item })
  }

  function confirmWorktree() {
    const state = pending()
    const input = projectInput()
    if (!state || !input) return
    setPending(undefined)
    if (state.kind === "reset") {
      run("Resetting worktree", async () => resetProjectWorktree(input, state.item.dir))
      return
    }

    run("Removing worktree", async () => {
      await removeProjectWorktree(input, state.item.dir)
      window.localStorage.removeItem(labelKey(state.item.dir))
      setLabelRev((revision) => revision + 1)
      if (selected() === state.item.dir) {
        setSelected(input.dir)
        remember(input.dir)
      }
    })
  }

  function updateEditor(value: string) {
    setEditor((state) => {
      if (!state) return state
      return { ...state, value }
    })
  }

  function editorTitle() {
    const state = editor()
    if (!state || state.kind === "create") return "Create worktree"
    return `Rename ${displayLabel(state.item)}`
  }

  function editorMessage() {
    if (editor()?.kind === "rename") return "Leave the name blank to restore the generated worktree name."
    return "Choose a recognizable name, or leave it blank to generate one automatically."
  }

  function pendingTitle() {
    const state = pending()
    if (!state) return ""
    const action = state.kind === "reset" ? "Reset" : "Delete"
    return `${action} worktree ${displayLabel(state.item)}?`
  }

  function pendingMessage() {
    if (pending()?.kind === "reset") return "This discards all uncommitted changes in the worktree."
    return "This removes the worktree directory and its files from the project."
  }

  createEffect(() => {
    const data = snap()
    if (!data) return
    if (!resize.pending) setInfoWidth(normalizeContextSidebarWidth(data.config.console?.context_sidebar_width))
    setDiffStyle(normalizeConsoleDiffStyle(data.config.console?.diff_style))
  })

  createEffect(() => {
    const next = search().get("server")
    if (next && next !== url()) setUrl(next)
  })

  // Reset review state when the selected worktree changes so one worktree's
  // file contents never leak into another.
  createEffect(
    on(
      () => target()?.dir,
      () => {
        setOpenFiles([])
        setDetails({})
        detailPending.clear()
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    if (!discoverable(search())) return
    void resolveServer().then((value) => {
      if (!value) return
      saveCached(value)
      setUrl(value)
    })
  })

  createEffect(() => {
    const data = snap()
    if (!data) return
    const hit = contexts().some((item) => item.dir === selected())
    if (hit) return
    setSelected(data.project.worktree)
    remember(data.project.worktree)
  })

  createEffect(() => {
    const ids = new Set((snap()?.terminals ?? []).map((item) => item.id))
    if (ids.size === 0) return
    const rows = local()
    if (!rows.some((item) => ids.has(item.id))) return
    setLocal(rows.filter((item) => !ids.has(item.id)))
  })

  createEffect(() => {
    const item = current()
    if (!item) return
    const hit = activeTerminal()
    if (hit?.directory === item.dir) return
    const pty = terminalsFor(item.dir)[0]
    if ((pty?.id ?? "") === active()) return
    setActive(pty?.id ?? "")
    remember(item.dir, pty?.id)
  })

  createEffect(() => {
    const item = activeTerminal()
    if (item) clearUnread(item)
  })

  createEffect(() => {
    const base = query()
    const data = snap()
    if (!base || !data) return
    const focused = activeSessionID()
    const open = terminals().flatMap((item) => {
      const id = sessionID(item)
      return id ? [id] : []
    })
    void viewProjectSessions({ url: base.url, dir: data.project.worktree }, focused ? [focused] : [], open).catch(
      () => {},
    )
  })

  createEffect(() => {
    const base = query()
    const data = snap()
    if (!base || !data) return
    const dirs = new Set([data.project.worktree, ...data.worktrees])
    const stop = subscribeProjectEvents({ url: base.url, dir: data.project.worktree }, (event) => {
      if (event.directory !== "global" && !dirs.has(event.directory)) return
      const id = eventSession(event)
      if (id && messageEvent(event)) markUnread(id)
      if (refreshEvent(event)) scheduleRefetch()
    })
    onCleanup(stop)
  })

  const updateViewport = () => setViewport(window.innerWidth)
  window.addEventListener("resize", updateViewport)

  onCleanup(() => {
    if (events.timer) window.clearTimeout(events.timer)
    if (resize.timer) window.clearTimeout(resize.timer)
    window.removeEventListener("resize", updateViewport)
  })

  createEffect(() => {
    if (!snap.error || !discoverable(search())) return
    const cached = loadCached()
    if (!cached || cached !== url()) return
    forgetCached()
    setUrl("")
    void discover().then((value) => {
      if (!value) return
      saveCached(value)
      setUrl(value)
    })
  })

  return (
    <section class="project-console" style={`--project-info-width: ${visibleInfoWidth()}px`}>
      <aside class="project-console-sidebar" aria-label="Project console sections">
        <div class="project-console-title">
          <span class="project-console-heading">
            <span>Project</span>
            <A class="project-title-settings" href={settings()} title="Project Settings" aria-label="Project Settings">
              <Icon name="settings-gear" size="small" />
            </A>
          </span>
          <span class="project-console-scope">
            <span class="project-console-name">
              {snap()?.project.name
                ? friendly(snap()?.project.name ?? "")
                : title(snap()?.project.worktree ?? project())}
            </span>
          </span>
          <small>{snap()?.vcs.branch ?? "No branch"}</small>
        </div>
        <div class="project-console-scroll">
          <section class="project-sidebar-group">
            <div class="project-panel-heading project-panel-heading-row">
              <span>Worktrees</span>
              <button
                type="button"
                class="project-heading-action"
                onClick={addWorktree}
                disabled={!projectInput() || !!saving()}
                title="Create worktree"
                aria-label="Create worktree"
              >
                +
              </button>
            </div>
            <nav class="project-contexts" aria-label="Worktrees">
              <For each={contexts()}>
                {(item) => (
                  <div class="project-worktree-block">
                    <div
                      class="project-context-row"
                      classList={{ active: current()?.dir === item.dir && !activeTerminal() }}
                    >
                      <button
                        type="button"
                        class="project-context"
                        classList={{ active: current()?.dir === item.dir && !activeTerminal() }}
                        onClick={() => select(item)}
                        title={item.dir}
                      >
                        <span>{displayLabel(item)}</span>
                        <small>{item.kind === "local" ? "project" : repo(item.dir)}</small>
                      </button>
                      <div class="project-row-actions">
                        <button
                          type="button"
                          class="project-inline-action"
                          onClick={(event) => {
                            event.stopPropagation()
                            addSession(item)
                          }}
                          disabled={!query() || !!saving()}
                          title={`New session in ${displayLabel(item)}`}
                          aria-label={`New session in ${displayLabel(item)}`}
                        >
                          +
                        </button>
                        <Show when={item.kind === "worktree"}>
                          <button
                            type="button"
                            class="project-inline-action"
                            onClick={(event) => {
                              event.stopPropagation()
                              renameWorktree(item)
                            }}
                            disabled={!!saving()}
                            title={`Rename ${displayLabel(item)}`}
                            aria-label={`Rename ${displayLabel(item)}`}
                          >
                            <Icon name="edit" size="small" />
                          </button>
                          <button
                            type="button"
                            class="project-inline-action danger"
                            onClick={(event) => {
                              event.stopPropagation()
                              removeWorktree(item)
                            }}
                            disabled={!!saving()}
                            title={`Delete ${displayLabel(item)}`}
                            aria-label={`Delete ${displayLabel(item)}`}
                          >
                            <Icon name="trash" size="small" />
                          </button>
                        </Show>
                      </div>
                    </div>
                    <Show when={terminalsFor(item.dir).length > 0}>
                      <div class="project-terminal-list">
                        <For each={terminalsFor(item.dir)}>
                          {(pty) => (
                            <div class="project-terminal-item" classList={{ active: active() === pty.id }}>
                              <button
                                type="button"
                                class="project-terminal-row"
                                classList={{ active: active() === pty.id }}
                                onClick={() => selectTerminal(pty)}
                                title={`${terminalName(pty)} (${pty.pid})`}
                              >
                                <span
                                  class="project-console-dot"
                                  classList={{
                                    "project-console-dot-idle": terminalState(pty) === "idle",
                                    "project-console-dot-busy": terminalState(pty) === "busy",
                                    "project-console-dot-attention": terminalState(pty) === "attention",
                                    "project-console-dot-unread": terminalState(pty) === "unread",
                                  }}
                                  aria-hidden="true"
                                />
                                <span>{terminalName(pty)}</span>
                              </button>
                              <button
                                type="button"
                                class="project-terminal-close"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  closeTerminal(pty)
                                }}
                                disabled={!!saving()}
                                title={`Close ${terminalName(pty)}`}
                                aria-label={`Close ${terminalName(pty)}`}
                              >
                                x
                              </button>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </nav>
          </section>
        </div>
        <div class="project-sidebar-bottom">
          <A class="project-settings-link" href={settings()}>
            <span>Project Settings</span>
            <small>Project configuration</small>
          </A>
        </div>
      </aside>

      <main class="project-console-main">
        <Show when={!query() && discoverable(search())}>
          <LoadingScreen variant="fullscreen" />
        </Show>
        <Show when={snap.loading && !snap()}>
          <LoadingScreen variant="fullscreen" />
        </Show>
        <Show when={snap.error || failure()}>
          <Card class="banner" variant="error">
            <strong>Project console failed</strong>
            <span>{failure() ?? errMsg(snap.error)}</span>
          </Card>
        </Show>
        <For each={terminalKeys()}>
          {(key) => {
            const pty = createMemo(() => terminalMap().get(key))
            const input = createMemo<Query | undefined>(() => {
              const item = pty()
              const base = query()
              if (!item || !base) return undefined
              return { url: base.url, dir: item.directory, scope: "project" }
            })
            return (
              <Show when={input()}>
                {(target) => {
                  const item = pty()
                  if (!item) return null
                  return (
                    <div
                      class="project-terminal-frame"
                      classList={{ active: terminal() === key }}
                      aria-hidden={terminal() !== key}
                    >
                      <GhosttyTerminal
                        query={target()}
                        pty={item.id}
                        active={terminal() === key}
                        onExit={() => {
                          const next = pty()
                          if (next) dropTerminal(next.id)
                        }}
                      />
                    </div>
                  )
                }}
              </Show>
            )
          }}
        </For>
        <Show when={!terminal() && !snap.loading && !snap.error && !failure()}>
          <div class="project-terminal-empty">
            <strong>No terminal session selected</strong>
            <span>Use + next to a worktree to start Kilo CLI.</span>
          </div>
        </Show>
      </main>

      <aside class="project-console-info" aria-label="Project details">
        <ResizeHandle
          direction="horizontal"
          edge="start"
          size={visibleInfoWidth()}
          min={MIN_CONTEXT_SIDEBAR_WIDTH}
          max={maxInfoWidth()}
          aria-label="Resize project context sidebar"
          onResize={resizeInfo}
        />
        <div class="project-info-card project-info-context">
          <div class="project-info-context-head">
            <span class="project-panel-heading">Context</span>
            <Badge variant="outline">{current()?.kind === "worktree" ? "Worktree" : "Local"}</Badge>
          </div>
          <strong class="project-info-title">{currentLabel()}</strong>
          <code class="project-info-path" title={current()?.dir}>
            {current()?.dir ?? snap()?.project.worktree ?? project()}
          </code>
          <Show when={current()?.kind === "worktree"}>
            <div class="project-info-actions">
              <Button variant="secondary" size="small" onClick={resetSelected} disabled={!!saving()}>
                Reset
              </Button>
              <Button variant="destructive" size="small" onClick={removeSelected} disabled={!!saving()}>
                Delete
              </Button>
            </div>
          </Show>
        </div>
        <div class="project-info-review">
          <Show
            when={!diffs.error}
            fallback={<div class="project-review-state project-review-state-error">{errMsg(diffs.error)}</div>}
          >
            <Show
              when={!(diffs.loading && !diffs())}
              fallback={
                <div class="project-review-state">
                  <Spinner />
                  <span>Loading changes…</span>
                </div>
              }
            >
              <FileComponentProvider component={File}>
                <SessionReview
                  diffs={reviewDiffs()}
                  title={<span>Changes</span>}
                  diffStyle={diffStyle()}
                  onDiffStyleChange={changeDiffStyle}
                  open={openFiles()}
                  onOpenChange={openReviewFiles}
                  empty={<div class="project-review-empty">No changes detected.</div>}
                />
              </FileComponentProvider>
            </Show>
          </Show>
        </div>
      </aside>

      <PromptDialog
        open={Boolean(editor())}
        title={editorTitle()}
        message={editorMessage()}
        label="Worktree name"
        value={editor()?.value ?? ""}
        placeholder="feature-name"
        confirm={editor()?.kind === "rename" ? "Save" : "Create"}
        busy={Boolean(saving())}
        onInput={updateEditor}
        onCancel={() => setEditor(undefined)}
        onConfirm={submitEditor}
      />
      <ConfirmDialog
        open={Boolean(pending())}
        title={pendingTitle()}
        message={pendingMessage()}
        confirm={pending()?.kind === "reset" ? "Reset" : "Delete"}
        busy={Boolean(saving())}
        onCancel={() => setPending(undefined)}
        onConfirm={confirmWorktree}
      />
    </section>
  )
}
