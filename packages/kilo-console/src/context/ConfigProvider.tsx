import { createEffect, createMemo, createResource, createSignal } from "solid-js"
import type { JSX } from "solid-js"
import {
  discover,
  forgetCached,
  load,
  loadCached,
  loadProjects,
  patchConfig,
  resolveServer,
  saveCached,
  saveConfig,
  saveTui,
  unsetConfig,
  type ConfigPatch,
  type ConfigUnset,
  type Query,
  type Scope,
  type TuiPatch,
} from "../client"
import { ConfigContext, type Task } from "./config"
import { strip } from "../shared/navigation"
import { clean, errMsg } from "../shared/utils"
import { useLocation, useParams } from "@solidjs/router"

const params = new URLSearchParams(window.location.search)
const ui = new Set(["3017", "3018"])

function shouldDiscover(input = params) {
  if (input.get("server")) return false
  return ui.has(window.location.port)
}

function base(input = params) {
  const param = input.get("server")
  if (param) return param
  const cached = shouldDiscover(input) ? loadCached() : ""
  if (cached) return cached
  if (shouldDiscover(input)) return ""
  return window.location.origin
}

export function ConfigProvider(props: { children?: JSX.Element }) {
  const loc = useLocation()
  const params = useParams()
  const search = createMemo(() => new URLSearchParams(loc.search))
  const discoverable = () => shouldDiscover(search())
  const fallback = () => base(search())
  const [url, setUrl] = createSignal(fallback())
  const route = createMemo(() => strip(loc.pathname))
  const scope = createMemo<Scope>(() => (route().startsWith("/projects/") ? "project" : "global"))
  const [saving, setSaving] = createSignal<string | undefined>()
  const [failure, setFailure] = createSignal<string | undefined>()
  const needs = createMemo(() => scope() === "project")
  const projects = createMemo(() => {
    const target = clean(url()) || fallback()
    if (!target || !needs()) return undefined
    return { url: target, dir: "" }
  })
  const [items] = createResource(projects, loadProjects)
  const resolved = createMemo(() => {
    if (!needs()) return ""
    return items()?.find((item) => item.id === params.project)?.worktree ?? ""
  })

  const query = createMemo<Query | undefined>(() => {
    const target = clean(url()) || fallback()
    if (!target) return undefined
    if (needs() && !resolved()) return undefined
    return { url: target, dir: resolved(), scope: scope() }
  })
  const [data, { refetch }] = createResource(query, load)

  function target() {
    const item = query()
    if (!item) throw new Error("Kilo server discovery is still running")
    return item
  }

  createEffect(() => {
    if (!needs() || items.loading || items.error || !items()) return
    if (!resolved()) setFailure(`Project not found: ${params.project}`)
  })

  createEffect(() => {
    const next = search().get("server")
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
    const snap = data()
    const item = query()
    if (!snap || !item || !discoverable()) return
    saveCached(item.url)
  })

  createEffect(() => {
    if (!data.error || !discoverable()) return
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

  function fail(message: string) {
    setFailure(message)
  }

  function run(label: string, job: () => Promise<unknown>, task?: Task) {
    setSaving(label)
    setFailure(undefined)
    void job()
      .then(() => (task?.refetch === false ? undefined : refetch()))
      .then(() => undefined)
      .catch((err: unknown) => setFailure(errMsg(err)))
      .finally(() => setSaving(undefined))
  }

  function save(patch: Partial<ConfigPatch>) {
    run("Saving config", () => saveConfig(target(), patch))
  }

  function patch(update: Partial<ConfigPatch>, unset?: ConfigUnset) {
    run("Saving config", () => patchConfig(target(), update, unset))
  }

  function unset(paths: ConfigUnset) {
    run("Saving config", () => unsetConfig(target(), paths))
  }

  function tui(patch: TuiPatch) {
    run("Saving TUI config", () => saveTui(target(), patch))
  }

  const ctx = {
    data,
    query,
    saving,
    failure,
    target,
    fail,
    run,
    save,
    patch,
    unset,
    tui,
  }

  return <ConfigContext.Provider value={ctx}>{props.children}</ConfigContext.Provider>
}
