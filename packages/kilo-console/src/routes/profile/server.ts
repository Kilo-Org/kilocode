import { createEffect, createMemo, createSignal } from "solid-js"
import { discover, forgetCached, loadCached, resolveServer, saveCached, type ProjectQuery } from "../../client"
import { clean } from "../../shared/utils"

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

export function useProfileServer(params: () => URLSearchParams) {
  const [url, setUrl] = createSignal(base(params()))
  const discoverable = () => shouldDiscover(params())
  const query = createMemo<ProjectQuery | undefined>(() => {
    const target = clean(url()) || base(params())
    if (!target) return undefined
    return { url: target, dir: "" }
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

  function remember() {
    const current = query()
    if (!current || !discoverable()) return
    saveCached(current.url)
  }

  function recover() {
    if (!discoverable()) return
    const cached = loadCached()
    if (!cached || cached !== url()) return
    forgetCached()
    setUrl("")
    void discover().then((value) => {
      if (!value) return
      saveCached(value)
      setUrl(value)
    })
  }

  return { query, discoverable, remember, recover }
}
