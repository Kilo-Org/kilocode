/**
 * HostedSessionList component
 *
 * Lists Kilo Cloud hosted sessions discovered through the local Kilo backend.
 * Durable history only: opening a row never wakes compute. Provider
 * availability and transport state are shown separately from session state.
 */
import { Component, Show, createSignal, onMount, onCleanup } from "solid-js"
import { List } from "@kilocode/kilo-ui/list"
import { Button } from "@kilocode/kilo-ui/button"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { formatRelativeDate } from "../../utils/date"
import type { ExtensionMessage, HostedSessionSummary } from "../../types/messages"
import { HostedStartDialog } from "./HostedStartDialog"

interface HostedSessionListProps {
  onSelectSession?: (session: HostedSessionSummary) => void
}

const HostedSessionList: Component<HostedSessionListProps> = (props) => {
  const vscode = useVSCode()
  const language = useLanguage()
  const dialog = useDialog()

  const [sessions, setSessions] = createSignal<HostedSessionSummary[]>([])
  const [loading, setLoading] = createSignal(true)
  const [notice, setNotice] = createSignal("")
  const [error, setError] = createSignal("")
  const [availability, setAvailability] = createSignal<
    { state: "available" } | { state: "unavailable"; reason: string; message: string } | undefined
  >(undefined)
  const [transport, setTransport] = createSignal<string | undefined>(undefined)

  const unavailable = () => {
    const value = availability()
    return value?.state === "unavailable" ? value : undefined
  }

  let seq = 0

  const unsub = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "hostedProvidersLoaded") {
      const provider = message.providers.find((p) => p.default) ?? message.providers[0]
      setAvailability(provider?.availability)
      setTransport(provider?.transport.state)
      // A failed provider read must not look like "Start is disabled for no
      // reason": keep a sign-in path and show the failure.
      setError(message.error ?? "")
      return
    }
    if (message.type === "hostedSessionsLoaded") {
      setSessions(message.sessions)
      setLoading(false)
      setError(message.error ?? "")
      return
    }
    if (message.type === "hostedSessionStarted") {
      setLoading(true)
      setError("")
      vscode.postMessage({ type: "requestHostedSessions", limit: 50 })
      props.onSelectSession?.({
        key: message.key,
        providerID: message.providerID,
        sessionID: message.sessionID,
        title: "",
        created: Date.now(),
        updated: Date.now(),
      })
      return
    }
    if (message.type === "hostedSessionFailed") {
      setLoading(false)
      setError(message.error)
      setNotice(message.error)
    }
  })

  onCleanup(unsub)

  function refresh() {
    setLoading(true)
    setError("")
    vscode.postMessage({ type: "requestHostedProviders" })
    vscode.postMessage({ type: "requestHostedSessions", limit: 50 })
  }

  onMount(refresh)

  function announce(session: HostedSessionSummary | undefined) {
    const id = ++seq
    setNotice("")
    if (!session) return
    queueMicrotask(() => {
      if (id === seq) setNotice(session.title)
    })
  }

  function openStart() {
    dialog.show(() => <HostedStartDialog onStart={(message) => vscode.postMessage(message)} />)
  }

  return (
    <div class="hosted-session-list">
      <Show when={unavailable()}>
        {(state) => (
          <div data-slot="hosted-availability" class="hosted-session-notice">
            <span dir="auto">{state().message}</span>
            <Button variant="secondary" size="small" onClick={() => vscode.postMessage({ type: "login" })}>
              {language.t("common.signIn")}
            </Button>
          </div>
        )}
      </Show>
      <Show when={availability()?.state === "available" && transport() === "unreachable"}>
        <div data-slot="hosted-transport" class="hosted-session-notice">
          {language.t("common.requestFailed")}
          <Button
            variant="secondary"
            size="small"
            onClick={() => vscode.postMessage({ type: "requestHostedProviders" })}
          >
            {language.t("common.retry")}
          </Button>
        </div>
      </Show>
      <div class="hosted-session-actions">
        <Button variant="primary" size="small" onClick={openStart} disabled={availability()?.state !== "available"}>
          {language.t("hosted.start")}
        </Button>
        <Button variant="ghost" size="small" onClick={refresh}>
          {language.t("common.refresh")}
        </Button>
      </div>
      <Show when={error()}>
        <div data-slot="hosted-error" class="hosted-session-notice" role="alert">
          <span dir="auto">{error()}</span>
          <Button variant="secondary" size="small" onClick={refresh}>
            {language.t("common.retry")}
          </Button>
        </div>
      </Show>
      <List<HostedSessionSummary>
        items={sessions()}
        key={(s) => s.key}
        filterKeys={["title"]}
        onMove={announce}
        onSelect={(s) => {
          if (s) props.onSelectSession?.(s)
        }}
        search={{ placeholder: language.t("session.search.placeholder"), autofocus: true }}
        emptyMessage={loading() ? language.t("common.loading") : language.t("hosted.empty")}
      >
        {(s) => (
          <>
            <span data-slot="list-item-title" dir="auto">
              {s.title || "Untitled"}
            </span>
            <span data-slot="list-item-description">{formatRelativeDate(new Date(s.updated).toISOString())}</span>
          </>
        )}
      </List>
      <div data-slot="session-list-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {notice()}
      </div>
    </div>
  )
}

export default HostedSessionList
