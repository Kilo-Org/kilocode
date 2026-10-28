// The native v2 data of main's Settings view. Only the settings that a v2 contract supports are here: provider
// connections are integrations (`api.integration.*`) and credentials (`api.credential.*`), and the Reload button is
// `api.location.reload`. createData resyncs integrations and providers on the credential and integration events
// these calls cause, so every open view follows without extra work here.
import type { FormAnswer, IntegrationAttempt, IntegrationInfo } from "@opencode/client"
import { createEffect, on } from "solid-js"
import SettingsPanel from "../components/settings/Settings"
import { credentials } from "../components/settings/provider-catalog"
import { useV2 } from "./client"

export const KILO = "kilo"
const POLL = 1000

export function createSettings() {
  const v2 = useV2()
  const location = { directory: v2.directory }

  createEffect(
    on(v2.connection.status, (status) => {
      if (status === "connected") void v2.data.location.integration.sync().catch(v2.report)
    }),
  )

  // MCP servers are integrations too. The Providers tab lists model providers only, as on v1.
  const integrations = () =>
    (v2.data.location.integration.list() ?? []).filter((item) => item.metadata?.source !== "mcp")

  return {
    integrations,
    loaded: () => v2.data.location.integration.list() !== undefined,
    integration: (id: string) => integrations().find((item) => item.id === id),
    connection: v2.connection.status,
    version: v2.version,
    open: v2.open,
    reload: () => v2.api.location.reload(),
    /** v1 replaced the stored key. v2 adds a credential, so the earlier key credentials are removed after it. */
    async connectKey(integrationID: string, key: string, answer?: FormAnswer) {
      const integration = integrations().find((item) => item.id === integrationID)
      const previous = integration ? credentials(integration).filter((item) => item.method === "key") : []
      await v2.api.integration.connect.key({ integrationID, location, key, answer })
      await Promise.all(previous.map((item) => v2.api.credential.remove({ credentialID: item.id })))
    },
    connectExternal(integrationID: string, methodID: string, answer?: FormAnswer) {
      return v2.api.integration.connect.external({ integrationID, location, methodID, answer })
    },
    /** Starts an OAuth attempt. `wait` polls an automatic attempt until it settles. */
    async authorize(integrationID: string, methodID: string, answer?: FormAnswer): Promise<IntegrationAttempt> {
      const result = await v2.api.integration.oauth.connect({ integrationID, location, methodID, answer })
      return result.data
    },
    complete(integrationID: string, attemptID: string, code: string) {
      return v2.api.integration.oauth.complete({ integrationID, attemptID, location, code })
    },
    wait(integrationID: string, attemptID: string, signal: { cancelled: boolean }) {
      return new Promise<void>((resolve, reject) => {
        const poll = () => {
          if (signal.cancelled) return resolve()
          void v2.api.integration.oauth
            .status({ integrationID, attemptID, location })
            .then((result) => {
              if (signal.cancelled) return resolve()
              if (result.data.status === "pending") return void setTimeout(poll, POLL)
              if (result.data.status === "complete") return resolve()
              reject(new Error(result.data.status === "failed" ? result.data.message : "Authorization expired"))
            })
            .catch(reject)
        }
        poll()
      })
    },
    cancel(integrationID: string, attemptID: string) {
      void v2.api.integration.oauth.cancel({ integrationID, attemptID, location }).catch(() => undefined)
    },
    /** Removes the stored credentials. Environment connections stay, as on v1. */
    disconnect(integration: IntegrationInfo) {
      return Promise.all(credentials(integration).map((item) => v2.api.credential.remove({ credentialID: item.id })))
    },
  }
}

export type SettingsData = ReturnType<typeof createSettings>

/** The Settings view of the sidebar. `onLogin` opens the Profile view, where the Kilo Gateway sign-in runs. */
export function SettingsView(props: { onLogin: () => void }) {
  const settings = createSettings()
  return <SettingsPanel settings={settings} onLogin={props.onLogin} />
}
