import { useLocation, useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
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
import { configNav } from "../../routes/config/sections"
import { clean, friendly } from "../../shared/utils"

type Entry = {
  kind: "NAV" | "PROJECT"
  label: string
  href: string
  sub?: string
  mono?: boolean
}

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

function tail(input: URLSearchParams) {
  const next = new URLSearchParams(input)
  next.delete("directory")
  const query = next.toString()
  return query ? `?${query}` : ""
}

function link(path: string, input: URLSearchParams) {
  return `${path}${tail(input)}`
}

function repo(input: string) {
  const parts = input.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? "Global"
}

function name(item: ProjectItem) {
  return friendly(item.name?.trim() || repo(item.worktree) || item.id.slice(0, 8))
}

function short(input: string) {
  if (input.length <= 8) return input
  return input.slice(0, 8)
}

function nav(input: URLSearchParams): Entry[] {
  const rows: Entry[] = [{ kind: "NAV", label: "Projects", href: link("/projects", input) }]

  for (const item of configNav) {
    if ("items" in item) {
      for (const child of item.items) {
        const prefix = item.id === "general" ? "Global Settings" : `Global Settings · ${item.label}`
        rows.push({ kind: "NAV", label: `${prefix} · ${child.label}`, href: link(child.href, input) })
      }
      continue
    }

    rows.push({ kind: "NAV", label: `Global Settings · ${item.label}`, href: link(item.href, input) })
  }

  rows.push({ kind: "NAV", label: "Profile", href: link("/profile", input) })
  return rows
}

function project(item: ProjectItem, input: URLSearchParams): Entry {
  return {
    kind: "PROJECT",
    label: name(item),
    href: link(`/projects/${encodeURIComponent(item.id)}`, input),
    sub: short(item.id),
    mono: true,
  }
}

function fuzzy(hay: string, term: string) {
  return (
    [...term].reduce((pos, char) => {
      if (pos < 0) return -1
      const hit = hay.indexOf(char, pos)
      if (hit < 0) return -1
      return hit + 1
    }, 0) >= 0
  )
}

function matches(item: Entry, input: string) {
  const term = input.trim().toLowerCase()
  if (!term) return true
  const hay = `${item.kind} ${item.label} ${item.sub ?? ""}`.toLowerCase()
  if (hay.includes(term)) return true
  return fuzzy(hay, term)
}

export function OmniSearch() {
  const loc = useLocation()
  const go = useNavigate()
  const params = createMemo(() => new URLSearchParams(loc.search))
  const discoverable = () => shouldDiscover(params())
  const fallback = () => base(params())
  const [url, setUrl] = createSignal(fallback())
  const [open, setOpen] = createSignal(false)
  const [term, setTerm] = createSignal("")
  const [active, setActive] = createSignal(0)
  let box: HTMLFormElement | undefined
  let field: HTMLInputElement | undefined

  const query = createMemo<ProjectQuery | undefined>(() => {
    const target = clean(url()) || fallback()
    if (!target) return undefined
    return { url: target, dir: "" }
  })
  const [items] = createResource(query, loadVisibleProjects)
  const entries = createMemo(() => [...nav(params()), ...[...(items() ?? [])].map((item) => project(item, params()))])
  const filtered = createMemo(() => entries().filter((item) => matches(item, term())))

  createEffect(() => {
    document.body.classList.toggle("omni-search-open", open())
  })

  onCleanup(() => document.body.classList.remove("omni-search-open"))

  function close() {
    setOpen(false)
    setTerm("")
    field?.blur()
  }

  function focus() {
    setOpen(true)
    queueMicrotask(() => field?.focus())
  }

  function select(item: Entry | undefined) {
    if (!item) return
    go(item.href)
    close()
  }

  function move(delta: number) {
    const max = Math.max(filtered().length - 1, 0)
    setActive((value) => Math.min(Math.max(value + delta, 0), max))
  }

  function keys(event: KeyboardEvent) {
    if (event.key === "Escape" && open()) {
      event.preventDefault()
      close()
      return
    }

    if (!open()) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      move(1)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      move(-1)
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      select(filtered()[active()])
    }
  }

  function submit(event: SubmitEvent) {
    event.preventDefault()
    if (!open()) return
    select(filtered()[active()])
  }

  createEffect(() => {
    term()
    setActive(0)
  })

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

  onMount(() => {
    const combo = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return
      event.preventDefault()
      if (open()) {
        close()
        return
      }
      focus()
    }
    const pointer = (event: PointerEvent) => {
      if (!open()) return
      const target = event.target
      if (target instanceof Node && box?.contains(target)) return
      close()
    }

    window.addEventListener("keydown", combo)
    window.addEventListener("pointerdown", pointer)
    onCleanup(() => {
      window.removeEventListener("keydown", combo)
      window.removeEventListener("pointerdown", pointer)
    })
  })

  return (
    <form
      ref={(node) => (box = node)}
      class="omni-search"
      classList={{ expanded: open() }}
      role="search"
      onKeyDown={keys}
      onSubmit={submit}
    >
      <div
        class="omni-search-head"
        onPointerDown={(event) => {
          if (event.target instanceof HTMLButtonElement) return
          focus()
        }}
      >
        <span class="omni-command" aria-hidden="true">
          <svg class="omni-command-icon" viewBox="0 0 24 24" fill="none">
            <path d="M7 9a2 2 0 1 1 2 -2v10a2 2 0 1 1 -2 -2h10a2 2 0 1 1 -2 2v-10a2 2 0 1 1 2 2h-10" />
          </svg>
        </span>
        <input
          ref={(node) => (field = node)}
          type="search"
          value={term()}
          placeholder={open() ? "" : "Search settings, projects, models..."}
          aria-label="Omni search"
          aria-expanded={open()}
          aria-controls="omni-search-results"
          onFocus={() => setOpen(true)}
          onInput={(event) => {
            setTerm(event.currentTarget.value)
            setOpen(true)
          }}
        />
        <button class="omni-escape" type="button" aria-label="Close search" onClick={close}>
          esc
        </button>
      </div>

      <Show when={open()}>
        <div class="omni-results" id="omni-search-results" role="listbox" aria-label="Search results">
          <Show when={filtered().length > 0} fallback={<div class="omni-empty">No matches.</div>}>
            <For each={filtered()}>
              {(item, index) => (
                <button
                  type="button"
                  class="omni-entry"
                  classList={{ active: index() === active() }}
                  role="option"
                  aria-selected={index() === active()}
                  onClick={() => select(item)}
                  onMouseMove={() => setActive(index())}
                >
                  <span class="omni-kind">{item.kind}</span>
                  <span class="omni-label" classList={{ mono: item.mono }}>
                    {item.label}
                  </span>
                  <Show when={item.sub}>{(sub) => <span class="omni-sub">{sub()}</span>}</Show>
                  <Show when={index() === active()}>
                    <span class="omni-enter" aria-hidden="true">
                      ↵
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </Show>
        </div>

        <footer class="omni-footer">
          <span class="omni-help">
            <span class="omni-kbd">↑</span>
            <span class="omni-kbd">↓</span>
            Navigate
          </span>
          <span class="omni-help">
            <span class="omni-kbd">↵</span>
            Open
          </span>
        </footer>
      </Show>
    </form>
  )
}
