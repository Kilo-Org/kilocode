import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { A } from "@solidjs/router"
import { Card } from "@kilocode/kilo-web-ui/card"
import { SearchField } from "../../components/SearchField"
import { LoadingScreen } from "../../components/LoadingScreen"
import {
  discover,
  forgetCached,
  loadCached,
  loadVisibleProjects,
  resolveServer,
  saveCached,
  type ProjectItem,
  type ProjectQuery,
} from "../../client"
import { clean, errMsg, friendly } from "../../shared/utils"

const search = new URLSearchParams(window.location.search)
const ui = new Set(["3017", "3018"])

function discoverable() {
  if (search.get("server")) return false
  return ui.has(window.location.port)
}

function base() {
  const param = search.get("server")
  if (param) return param
  const cached = discoverable() ? loadCached() : ""
  if (cached) return cached
  if (discoverable()) return ""
  return window.location.origin
}

function repo(input: string) {
  const parts = input.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? "Global"
}

function name(item: ProjectItem) {
  return friendly(item.name?.trim() || repo(item.worktree) || item.id.slice(0, 8))
}

function mark(item: ProjectItem) {
  const parts = name(item)
    .split(/[\s._/-]+/)
    .filter(Boolean)
  const text = `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? parts[0]?.[1] ?? ""}`
  return text.toUpperCase() || "KG"
}

function href(item: ProjectItem) {
  const params = new URLSearchParams()
  const server = search.get("server")
  if (server) params.set("server", server)
  const query = params.toString()
  return `/projects/${encodeURIComponent(item.id)}${query ? `?${query}` : ""}`
}

function short(input: string) {
  if (input.length <= 8) return input
  return input.slice(0, 8)
}

function updated(input: number) {
  const diff = Math.max(0, Date.now() - input)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return "just now"
  if (diff < hour) return `${Math.floor(diff / minute)} minutes ago`
  if (diff < day) return `${Math.floor(diff / hour)} hours ago`
  const days = Math.floor(diff / day)
  if (days === 1) return "yesterday"
  return `${days} days ago`
}

function matches(item: ProjectItem, input: string) {
  const needle = input.trim().toLowerCase()
  if (!needle) return true
  return `${name(item)} ${item.id} ${item.worktree}`.toLowerCase().includes(needle)
}

export function ProjectsRoute() {
  const [url, setUrl] = createSignal(base())
  const [filter, setFilter] = createSignal("")
  const query = createMemo<ProjectQuery | undefined>(() => {
    const target = clean(url()) || base()
    if (!target) return undefined
    return { url: target, dir: "" }
  })
  const [items] = createResource(query, loadVisibleProjects)
  const rows = createMemo(() => [...(items() ?? [])].sort((a, b) => b.time.updated - a.time.updated))
  const filtered = createMemo(() => rows().filter((item) => matches(item, filter())))

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

  return (
    <section class="route-empty">
      <div class="projects-page">
        <header class="projects-header">
          <h1>
            Projects <span class="count-tag">{rows().length}</span>
          </h1>
          <p>Projects opened with this Kilo server. Selecting a project opens its console.</p>
        </header>

        <Show when={!query() && discoverable()}>
          <LoadingScreen variant="fullscreen" />
        </Show>

        <Show when={items.loading && !items()}>
          <LoadingScreen variant="fullscreen" />
        </Show>

        <Show when={items.error}>
          <Card class="banner" variant="error">
            <strong>Project request failed</strong>
            <span>{errMsg(items.error)}</span>
          </Card>
        </Show>

        <SearchField label="Filter projects" value={filter()} placeholder="Filter projects..." onValue={setFilter} />

        <Show when={query() && !items.loading && rows().length === 0 && !items.error}>
          <Card class="empty">No projects have been opened with this Kilo server yet.</Card>
        </Show>

        <Show when={query() && !items.loading && rows().length > 0 && filtered().length === 0 && !items.error}>
          <Card class="empty">No matches. Clear the filter or open a project from the CLI.</Card>
        </Show>

        <ul class="project-list" aria-label="Kilo projects">
          <For each={filtered()}>
            {(item) => (
              <li>
                <A class="project-row" href={href(item)}>
                  <span class="project-icon" aria-hidden="true">
                    {mark(item)}
                  </span>
                  <span class="project-body">
                    <span class="project-title">
                      <strong>{name(item)}</strong>
                      <span>{short(item.id)}</span>
                    </span>
                    <span class="project-meta">
                      <span class="project-git" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none">
                          <path d="M6 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
                          <path d="M18 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
                          <path d="M6 8v4a3 3 0 0 0 3 3h6" />
                          <path d="M14 12l3 3l-3 3" />
                        </svg>
                      </span>
                      <span class="project-folder">{item.worktree}</span>
                      <span aria-hidden="true">·</span>
                      <span>{updated(item.time.updated)}</span>
                    </span>
                  </span>
                  <span class="project-arrow" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path d="M9 6l6 6l-6 6" />
                    </svg>
                  </span>
                </A>
              </li>
            )}
          </For>
        </ul>
      </div>
    </section>
  )
}
