// MCP runtime status and OAuth sign-in for the Settings webview, over the v2 client. The server is the source of
// truth: `api.mcp.list` returns each server with its status and, for an OAuth remote, its integration ID, and the
// data layer resyncs that list on `mcp.status.changed`. Sign-in starts an integration OAuth attempt, opens the
// authorization URL through the host, and polls the attempt until it settles.
import type { IntegrationOAuthMethod, McpServer } from "@opencode/client"
import { createEffect, createSignal, on, onCleanup } from "solid-js"
import { useV2 } from "./client"

const POLL = 1000

interface Attempt {
  integrationID: string
  attemptID: string
  cancelled: boolean
  timer?: ReturnType<typeof setTimeout>
}

export function createMcp() {
  const v2 = useV2()
  const location = { directory: v2.directory }
  const [busy, setBusy] = createSignal<string[]>([])
  const [removing, setRemoving] = createSignal<string[]>([])
  const [resetting, setResetting] = createSignal<string[]>([])
  const attempts = new Map<string, Attempt>()

  // Closing the settings panel stops the poll without waiting for the server to expire the attempt.
  onCleanup(() => {
    for (const entry of attempts.values()) {
      entry.cancelled = true
      if (entry.timer) clearTimeout(entry.timer)
    }
    attempts.clear()
  })

  // A server's status comes from the MCP list, and its sign-in needs the integration and OAuth method, so keep both
  // loaded alongside each other when the connection opens.
  createEffect(
    on(v2.connection.status, (status) => {
      if (status !== "connected") return
      void Promise.all([
        v2.data.location.mcp.server.sync(),
        v2.data.location.integration.sync(),
      ]).catch(v2.report)
    }),
  )

  const servers = (): McpServer[] => v2.data.location.mcp.server.list() ?? []
  const server = (name: string) => servers().find((item) => item.name === name)
  const sync = () => v2.data.location.mcp.server.sync()

  const mark = (set: (value: (current: string[]) => string[]) => void, name: string, on: boolean) =>
    set((current) => (on ? (current.includes(name) ? current : [...current, name]) : current.filter((item) => item !== name)))

  const integration = (name: string) => {
    const id = server(name)?.integrationID
    return id ? v2.data.location.integration.list()?.find((item) => item.id === id) : undefined
  }

  async function connect(name: string) {
    mark(setBusy, name, true)
    try {
      await v2.api.mcp.connect({ server: name, location })
      await sync()
    } catch (error) {
      v2.report(error)
    } finally {
      mark(setBusy, name, false)
    }
  }

  async function disconnect(name: string) {
    mark(setBusy, name, true)
    try {
      await v2.api.mcp.disconnect({ server: name, location })
      await sync()
    } catch (error) {
      v2.report(error)
    } finally {
      mark(setBusy, name, false)
    }
  }

  async function signIn(name: string) {
    const target = integration(name)
    const method = target?.methods.find((item): item is IntegrationOAuthMethod => item.type === "oauth")
    if (!target || !method) return
    mark(setBusy, name, true)
    try {
      const attempt = (await v2.api.integration.oauth.connect({ integrationID: target.id, location, methodID: method.id }))
        .data
      const entry: Attempt = { integrationID: target.id, attemptID: attempt.attemptID, cancelled: false }
      attempts.set(name, entry)
      v2.open(attempt.url)
      await wait(entry)
      await sync()
    } catch (error) {
      v2.report(error)
    } finally {
      attempts.delete(name)
      mark(setBusy, name, false)
    }
  }

  function wait(entry: Attempt): Promise<void> {
    return new Promise((resolve, reject) => {
      const poll = () => {
        if (entry.cancelled) return resolve()
        void v2.api.integration.oauth
          .status({ integrationID: entry.integrationID, attemptID: entry.attemptID, location })
          .then((result) => {
            if (entry.cancelled) return resolve()
            const status = result.data.status
            if (status === "pending") return void (entry.timer = setTimeout(poll, POLL))
            if (status === "complete") return resolve()
            reject(new Error(status === "failed" ? result.data.message : "Authorization expired"))
          })
          .catch(reject)
      }
      poll()
    })
  }

  function cancel(name: string) {
    const entry = attempts.get(name)
    if (!entry) return
    entry.cancelled = true
    void v2.api.integration.oauth
      .cancel({ integrationID: entry.integrationID, attemptID: entry.attemptID, location })
      .catch(() => undefined)
  }

  async function reset(name: string) {
    const target = integration(name)
    mark(setResetting, name, true)
    try {
      if (target) {
        const previous = target.connections.filter((item) => item.type === "credential")
        await Promise.all(previous.map((item) => v2.api.credential.remove({ credentialID: item.id })))
      }
      await v2.api.mcp.disconnect({ server: name, location })
      await v2.api.mcp.connect({ server: name, location })
      await sync()
    } catch (error) {
      v2.report(error)
    } finally {
      mark(setResetting, name, false)
    }
  }

  return {
    servers,
    status: (name: string) => server(name)?.status,
    busy,
    removing,
    resetting,
    connect,
    disconnect,
    signIn,
    cancel,
    reset,
  }
}
