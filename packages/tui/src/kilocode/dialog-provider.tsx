// Kilo guidance in the connect dialog, as in v1 `kilocode/cli/cmd/tui/component/dialog-provider.tsx`: the provider
// descriptions and titles, the failure reason of the Kilo Gateway catalog, and the Kilo API key hint.
import type { LocationRef } from "@opencode/client"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { createSignal, Match, onMount, Switch } from "solid-js"
import { useClient } from "../context/client"
import { useTheme } from "../context/theme"
import { Link } from "../ui/link"

// v1 PROVIDER_DESCRIPTIONS, shown next to the name in the list.
export const KILO_PROVIDER_DESCRIPTIONS: Record<string, string> = {
  kilo: "(Recommended)",
  anthropic: "(Claude Max or API key)",
  openai: "(ChatGPT login or API key)",
  "anaconda-desktop": "(Local models)",
}

// v1 PROVIDER_TITLES.
export const KILO_PROVIDER_TITLES: Record<string, string> = {
  openai: "OpenAI / Codex",
}

type Failure = typeof KiloGatewayRpc.CatalogFailure.Type

// v1 failureMessage, keyed by the failure kind of the Kilo catalog. `organization_missing` is new on v2.
export function failureMessage(failure: Failure) {
  const status = failure.status ? ` (HTTP ${failure.status})` : ""
  switch (failure.kind) {
    case "unauthorized":
      return `Credentials rejected${status} - sign in again`
    case "network":
      return "Couldn't reach the provider - check your connection"
    case "http":
      return `Provider error${status}`
    case "schema":
      return "Unexpected response from the provider"
    case "organization_missing":
      return "Selected team is no longer available - use /teams"
  }
}

// v1 failedDescription: the reason in parentheses, which replaces the description of a failed provider.
export function failedDescription(failure: Failure | undefined) {
  return failure ? `(${failureMessage(failure)})` : undefined
}

// v1 LOCAL_OPTIONAL_API_KEY: local OpenAI-compatible providers where the API key is optional.
const LOCAL_OPTIONAL_API_KEY = new Set(["atomic-chat", "lmstudio"])

export function apiKeyPlaceholder(integrationID: string) {
  return LOCAL_OPTIONAL_API_KEY.has(integrationID) ? "Optional for localhost" : "API key"
}

/** The key to store: an empty key of a local provider stores v1's placeholder `local`. */
export function apiKey(integrationID: string, value: string) {
  return value.trim() || (LOCAL_OPTIONAL_API_KEY.has(integrationID) ? "local" : "")
}

/**
 * The v1 title, description and gutter of an integration row, only the fields that replace upstream's. A failed
 * Kilo catalog shows a red `!` and the reason instead of the description.
 */
export function kiloRow(
  integrationID: string,
  failure: Failure | undefined,
  theme: ReturnType<ReturnType<typeof useTheme>["surface"]>,
) {
  const failed = integrationID === "kilo" ? failedDescription(failure) : undefined
  const title = KILO_PROVIDER_TITLES[integrationID]
  const description = failed ?? KILO_PROVIDER_DESCRIPTIONS[integrationID]
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(failed ? { gutter: () => <text fg={theme.text.feedback.error.base}>!</text> } : {}),
  }
}

/** The failure of the Kilo Gateway catalog at the location, read once when the dialog opens. */
export function useKiloFailure(location: LocationRef) {
  const client = useClient()
  const [failure, setFailure] = createSignal<Failure>()
  onMount(() => {
    client.api
      .rpc(KiloGatewayRpc.Definition)
      .models({}, { location: { directory: location.directory } })
      .catch((error: { type?: string; data?: Failure }) => {
        if (error.type === "failed" && error.data) setFailure(error.data)
      })
  })
  return failure
}

// v1 renderApiDescription: where to get a Kilo API key, and the local Atomic Chat server.
export function KeyDescription(props: { integrationID: string }) {
  const theme = useTheme().surface("dialog")
  return (
    <Switch>
      <Match when={props.integrationID === "atomic-chat"}>
        <text fg={theme.text.muted}>
          Connect to Atomic Chat on this machine (default http://127.0.0.1:1337). Leave API key empty for local server.
        </text>
      </Match>
      <Match when={props.integrationID === "kilo"}>
        <box gap={1}>
          <text fg={theme.text.muted}>
            Kilo Gateway gives you access to all the best coding models at the cheapest prices with a single API key.
          </text>
          <box flexDirection="row">
            <text fg={theme.text.base}>Go to </text>
            <Link href="https://kilo.ai/gateway" fg={theme.markdown.link} />
            <text fg={theme.text.base}> to get a key</text>
          </box>
        </box>
      </Match>
    </Switch>
  )
}
