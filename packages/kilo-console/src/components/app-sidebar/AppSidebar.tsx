import { A, useLocation } from "@solidjs/router"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup } from "solid-js"
import {
  discover,
  forgetCached,
  loadRecentProjects,
  loadProjectLiveStatus,
  loadProjectOpenSessions,
  loadCached,
  resolveServer,
  saveCached,
  subscribeProjectEvents,
  type ProjectConsoleEvent,
  type RecentProjectItem,
  type ProjectQuery,
} from "../../client"
import { strip, type Path } from "../../shared/navigation"
import { clean, friendly } from "../../shared/utils"
import {
  projectStatus,
  projectForDir,
  eventTypeName,
  eventSessionId,
  markError,
  clearError,
  markAttention,
  clearAttention,
  markUnread,
  clearUnread,
  clearBusy,
  markBusy,
  type GlobalEvent,
} from "../../shared/terminal-status"

const ports = new Set(["3017", "3018"])

function shouldDiscover(input: URLSearchParams) {
  if (input.get("server")) return false
  return ports.has(window.location.port)
}

function base(input: URLSearchParams) {
  const param = input.get("server")
  if (param) return param
  const cached = shouldDiscover(input) ? loadCached() : ""
  if (cached) return cached
  if (shouldDiscover(input)) return ""
  return window.location.origin
}

function repo(input: string) {
  const parts = input.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? "Global"
}

function name(item: RecentProjectItem) {
  return friendly(item.name?.trim() || repo(item.worktree) || item.id.slice(0, 8))
}

function mark(item: RecentProjectItem) {
  const parts = name(item)
    .split(/[\s._/-]+/)
    .filter(Boolean)
  const text = `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? parts[0]?.[1] ?? ""}`
  return text.toUpperCase() || "KG"
}

function tail(input: URLSearchParams) {
  const next = new URLSearchParams(input)
  next.delete("directory")
  const query = next.toString()
  return query ? `?${query}` : ""
}

function href(item: RecentProjectItem, input: URLSearchParams) {
  return `/projects/${encodeURIComponent(item.id)}${tail(input)}`
}

// ─── component ────────────────────────────────────────────────────────────────

type Props = {
  path: Path
}

function Glyph(props: { name: "projects" | "settings" | "profile" }) {
  if (props.name === "projects") {
    return (
      <svg class="rail-glyph" viewBox="0 0 24 24" aria-hidden="true" fill="none">
        <path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2" />
      </svg>
    )
  }

  if (props.name === "settings") {
    return (
      <svg class="rail-glyph" viewBox="0 0 24 24" aria-hidden="true" fill="none">
        <path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37.996 .608 2.296 .07 2.572 -1.065z" />
        <path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" />
      </svg>
    )
  }

  return (
    <svg class="rail-glyph" viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" />
      <path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />
    </svg>
  )
}

export function AppSidebar(props: Props) {
  const loc = useLocation()
  const params = createMemo(() => new URLSearchParams(loc.search))
  const route = createMemo(() => strip(loc.pathname))
  const discoverable = () => shouldDiscover(params())
  const fallback = () => base(params())
  const [url, setUrl] = createSignal(fallback())
  const timers = { refetch: undefined as number | undefined }

  const query = createMemo<ProjectQuery | undefined>(() => {
    const target = clean(url()) || fallback()
    if (!target) return undefined
    return { url: target, dir: "" }
  })
  const [items, { refetch }] = createResource(query, loadRecentProjects)
  const checks = new Map<string, number>()

  // project currently rendered by ProjectConsoleRoute — it owns unread tracking for its terminals
  const activeProject = createMemo(() => {
    const match = route().match(/^\/projects\/([^/]+)/)
    return match ? decodeURIComponent(match[1]) : undefined
  })

  const settings = () => `/settings${tail(params())}`
  const selected = (item: RecentProjectItem) =>
    route().startsWith(`/projects/${encodeURIComponent(item.id)}/`) ||
    route() === `/projects/${encodeURIComponent(item.id)}`

  const nav = () => [{ href: "/projects", label: "Projects", name: "projects", path: "/projects" }] as const
  const bottom = () =>
    [
      { href: "/profile", label: "Profile", name: "profile", path: "/profile" },
      { href: settings(), label: "Settings", name: "settings", path: "/settings" },
    ] as const

  function scheduleRefetch() {
    if (timers.refetch) return
    timers.refetch = window.setTimeout(() => {
      timers.refetch = undefined
      void refetch()
    }, 150)
  }

  function bump(type: string, project: string, session: string) {
    const key = `${type}\0${project}\0${session}`
    const rev = (checks.get(key) ?? 0) + 1
    checks.set(key, rev)
    return { key, rev }
  }

  function gated(
    type: string,
    input: ProjectQuery,
    project: string,
    dir: string,
    session: string,
    run: () => void,
    clear: () => void,
  ) {
    const check = bump(type, project, session)
    void loadProjectOpenSessions(input, dir)
      .then((open) => {
        if (checks.get(check.key) !== check.rev) return
        if (open.has(session)) run()
        else clear()
      })
      .catch((err) => console.warn("Project open sessions:", err))
  }

  // ── server URL tracking ──────────────────────────────────────────────────────

  createEffect(() => {
    const next = params().get("server")
    if (next && next !== url()) setUrl(next)
  })

  createEffect(() => {
    if (!discoverable()) return
    void resolveServer().then((value) => {
      if (!value) return
      saveCached(value)
      setUrl(value)
    })
  })

  createEffect(() => {
    const current = query()
    if (!items() || !current || !discoverable()) return
    saveCached(current.url)
  })

  createEffect(() => {
    if (!items.error || !discoverable()) return
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

  // ── polling fallback ─────────────────────────────────────────────────────────

  createEffect(() => {
    if (!query()) return
    const timer = window.setInterval(() => void refetch(), 5000)
    onCleanup(() => window.clearInterval(timer))
  })

  // ── initial status hydration ─────────────────────────────────────────────────
  // Called whenever items reload. Fills busy + attention from server state.
  // Unread is written by ProjectConsoleRoute (same-project) and SSE turn.close (cross-project).

  createEffect(() => {
    const list = items()
    const current = query()
    if (!list || !current) return
    for (const item of list) {
      void loadProjectLiveStatus(current, item.worktree)
        .then((s) => {
          // busy: project has at least one non-idle session
          // we don't have per-session IDs here, use a sentinel "__hydrated__"
          if (s.busy) markBusy(item.id, "__hydrated__")
          else clearBusy(item.id, "__hydrated__")
          if (s.attention) markAttention(item.id, "__hydrated__")
          else clearAttention(item.id, "__hydrated__")
        })
        .catch((err) => console.warn("Project live status:", err))
    }
  })

  // ── SSE event handler ────────────────────────────────────────────────────────

  createEffect(() => {
    const current = query()
    if (!current) return

    const stop = subscribeProjectEvents(current, (event) => {
      const ge = event as unknown as GlobalEvent
      const list = items() ?? []

      // refresh project list on session lifecycle events
      const t = eventTypeName(ge)
      if (t.startsWith("session.created") || t.startsWith("session.updated") || t.startsWith("session.deleted")) {
        scheduleRefetch()
      }

      if (!list.length || !ge.directory) return
      const proj = projectForDir(list, ge.directory)
      if (!proj) return

      const sid = eventSessionId(ge)

      // session.turn.close: error | completed
      if (t === "session.turn.close") {
        const payload = (ge.payload as Record<string, unknown>).properties as { reason?: string } | undefined
        if (!sid) return
        if (payload?.reason === "error") {
          gated(
            "error",
            current,
            proj.id,
            ge.directory,
            sid,
            () => markError(proj.id, sid),
            () => clearError(proj.id, sid),
          )
          return
        }
        bump("error", proj.id, sid)
        clearError(proj.id, sid)
        if (payload?.reason === "completed") {
          // When the user is on this project, ProjectConsoleRoute owns unread tracking
          // with per-terminal awareness (it knows which terminal is active).
          // AppSidebar only handles cross-project: projects the user is NOT currently viewing.
          if (proj.id !== activeProject()) {
            gated(
              "unread",
              current,
              proj.id,
              ge.directory,
              sid,
              () => markUnread(proj.id, sid),
              () => clearUnread(proj.id, sid),
            )
          }
        }
        return
      }

      // permission / question → attention
      if (t === "permission.asked" || t === "question.asked") {
        if (!sid) return
        gated(
          "attention",
          current,
          proj.id,
          ge.directory,
          sid,
          () => markAttention(proj.id, sid),
          () => clearAttention(proj.id, sid),
        )
        return
      }
      if (
        t === "permission.replied" ||
        t === "permission.rejected" ||
        t === "question.replied" ||
        t === "question.rejected"
      ) {
        if (!sid) return
        bump("attention", proj.id, sid)
        clearAttention(proj.id, sid)
        return
      }

      // session.status → busy / idle
      if (t === "session.status") {
        const sstatus = (ge.payload as Record<string, unknown>).properties as { status?: { type?: string } } | undefined
        const stype = sstatus?.status?.type
        if (!sid) return
        if (stype === "busy" || stype === "retry") {
          gated(
            "busy",
            current,
            proj.id,
            ge.directory,
            sid,
            () => markBusy(proj.id, sid),
            () => clearBusy(proj.id, sid),
          )
        } else if (stype === "idle") {
          bump("busy", proj.id, sid)
          bump("error", proj.id, sid)
          clearBusy(proj.id, sid)
          clearError(proj.id, sid)
        }
        return
      }
    })

    onCleanup(stop)
  })

  onCleanup(() => {
    if (timers.refetch) window.clearTimeout(timers.refetch)
    checks.clear()
  })

  return (
    <aside class="rail" aria-label="Primary navigation">
      <nav class="rail-nav" aria-label="Primary">
        <For each={nav()}>
          {(item) => (
            <A
              class="rail-action"
              classList={{ active: props.path === item.path }}
              href={item.href}
              aria-label={item.label}
              aria-current={props.path === item.path ? "page" : undefined}
              title={item.label}
            >
              <Glyph name={item.name} />
            </A>
          )}
        </For>
      </nav>

      <div class="rail-favorites" aria-label="Projects with recent sessions">
        <For each={items() ?? []}>
          {(item) => {
            const status = () => projectStatus(item.id)
            return (
              <A
                class="favorite-project"
                classList={{
                  active: selected(item),
                  "status-error": status() === "error",
                  "status-attention": status() === "attention",
                  "status-unread": status() === "unread",
                  "status-busy": status() === "busy",
                }}
                href={href(item, params())}
                aria-label={name(item)}
                aria-current={selected(item) ? "page" : undefined}
                title={name(item)}
              >
                {mark(item)}
              </A>
            )
          }}
        </For>
      </div>

      <nav class="rail-bottom" aria-label="Account and settings">
        <For each={bottom()}>
          {(item) => (
            <A
              class="rail-action"
              classList={{ active: props.path === item.path }}
              href={item.href}
              aria-label={item.label}
              aria-current={props.path === item.path ? "page" : undefined}
              title={item.label}
            >
              <Glyph name={item.name} />
            </A>
          )}
        </For>
      </nav>
    </aside>
  )
}
