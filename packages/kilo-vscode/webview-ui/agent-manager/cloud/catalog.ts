import type { OpenCodeClient } from "@opencode/client"
import { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { batch, createSignal, onCleanup } from "solid-js"
import { readListed } from "../../../src/shared/plugin-inventory"

export function createCloudCatalog(api: OpenCodeClient, directory: string) {
  const rpc = api.rpc(KiloHostedRpc.Definition)
  const life = new AbortController()
  onCleanup(() => life.abort())
  const options = { location: { directory }, signal: life.signal }
  const [status, setStatus] = createSignal<Awaited<ReturnType<typeof rpc.status>>>()
  const [items, setItems] = createSignal<readonly KiloHostedRpc.Workspace[]>([])
  const [cursor, setCursor] = createSignal<string>()
  const [loading, setLoading] = createSignal(false)
  const [failed, setFailed] = createSignal(false)

  const list = async (scope: string, page?: string) => {
    const result = await rpc.list({ scope, cursor: page }, options)
    if (life.signal.aborted || scope !== status()?.scope) return
    setItems((prev) => uniqueBy([...(page ? prev : []), ...result.items], (row) => row.workspaceID))
    setCursor(result.cursor)
  }
  const read = async (page?: string) => {
    if (loading() || life.signal.aborted) return
    setLoading(true)
    setFailed(false)
    try {
      const scope = status()?.scope
      if (page && scope) return await list(scope, page)
      batch(() => {
        setStatus(undefined)
        setItems([])
        setCursor(undefined)
      })
      const result = await readListed({
        api,
        directory,
        active: () => !life.signal.aborted,
        read: () => rpc.status({}, options),
      })
      if (life.signal.aborted) return
      setStatus(result)
      if (result.state === "ready" && result.scope) await list(result.scope)
    } catch {
      if (!life.signal.aborted) setFailed(true)
    } finally {
      if (!life.signal.aborted) setLoading(false)
    }
  }
  return { status, items, cursor, failed, loading, read }
}

export function uniqueBy<T>(rows: readonly T[], key: (row: T) => string) {
  return [...new Map(rows.map((row) => [key(row), row])).values()]
}
