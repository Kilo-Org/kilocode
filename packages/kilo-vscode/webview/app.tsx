import { OpenCode } from "@opencode/client"
import { createClientConnection, createData } from "@opencode/client/solid"
import { KiloHandshakeRpc } from "@opencode/schema/kilocode/handshake"
import { createEffect, createSignal, on, onCleanup, Show } from "solid-js"
import type { ToWebview } from "../src/protocol"
import { Permission, Question } from "./docks"
import { events } from "./events"
import { Prompt } from "./prompt"
import { Sessions, Title } from "./sessions"
import { Transcript } from "./transcript"
import { transport } from "./transport"

export function App(props: { directory: string }) {
  const vscode = acquireVsCodeApi()
  const bridge = transport((message) => vscode.postMessage(message))
  const api = OpenCode.make({ baseUrl: "http://kilo.invalid", fetch: bridge.fetch })
  const event = events()
  const [session, setSession] = createSignal<string>()
  const [reset, setReset] = createSignal(0)
  const [error, setError] = createSignal("")
  const [version, setVersion] = createSignal("")
  const [handshake, setHandshake] = createSignal("")
  const [loading, setLoading] = createSignal(true)
  const report = (error: unknown) => setError(message(error))
  const connection = createClientConnection(api, { onEvent: event.emit, pageLifecycle: true })
  const data = createData({ api: () => api, directory: props.directory, connection, event, onError: report })
  const running = () => {
    const id = session()
    return id ? data.session.status(id) === "running" : false
  }

  function fresh() {
    setSession(undefined)
    setError("")
    setReset((value) => value + 1)
  }

  const receive = (event: MessageEvent<ToWebview>) => {
    bridge.receive(event.data)
    if (event.data.type === "command" && event.data.name === "newSession") fresh()
  }
  window.addEventListener("message", receive)
  onCleanup(() => window.removeEventListener("message", receive))
  onCleanup(event.clear)

  function hydrate(id: string) {
    return Promise.all([
      data.session.sync(id),
      data.session.message.sync(id),
      data.session.pending.sync(id),
      data.session.permission.sync(id),
      data.session.form.sync(id),
    ])
  }

  createEffect(
    on(connection.status, (status) => {
      if (status !== "connected") return
      setLoading(true)
      void api.session
        .list({ directory: props.directory, parentID: null, order: "desc", limit: 50 })
        .then((response) => response.data.forEach(data.session.remember))
        .catch(report)
        .finally(() => setLoading(false))
      void api
        .rpc(KiloHandshakeRpc.Definition)
        .get({}, { location: { directory: props.directory } })
        .then((info) => {
          setVersion(info.version)
          setHandshake("")
        })
        .catch((error: unknown) => {
          setVersion("")
          setHandshake(`Not a Kilo v2 server: ${message(error)}`)
        })
    }),
  )

  createEffect(
    on([session, connection.status], ([id, status]) => {
      if (!id || status !== "connected" || data.session.creating(id)) return
      void hydrate(id).catch(report)
    }),
  )

  function create() {
    const created = data.session.create({})
    void created.request
      .then(() => hydrate(created.id))
      .catch((error: unknown) => {
        if (!data.session.get(created.id) && session() === created.id) setSession(undefined)
        report(error)
      })
    return created.id
  }

  function send(text: string) {
    const id = session() ?? create()
    setSession(id)
    setError("")
    return data.session
      .prompt({ sessionID: id, text })
      .then(() => true)
      .catch((error: unknown) => {
        report(error)
        return false
      })
  }

  function rename(id: string, title: string) {
    return api.session
      .update({ sessionID: id, title })
      .then(() => {
        data.session.invalidate(id)
        return data.session.sync(id)
      })
      .then(() => true)
      .catch((error: unknown) => {
        report(error)
        return false
      })
  }

  return (
    <main class="app">
      <header class="header">
        <Show when={session()}>
          <button class="secondary" aria-label="Back to sessions" onClick={() => setSession(undefined)}>
            Back
          </button>
        </Show>
        <strong>Kilo</strong>
        <Show when={version()}>
          <small class="muted version">{version()}</small>
        </Show>
        <Show when={connection.status() !== "connected"}>
          <small class="muted connection" role="status">
            {connection.status() === "connecting" ? "Connecting..." : "Reconnecting..."}
          </small>
        </Show>
        <button class="secondary new-session" onClick={fresh}>
          New session
        </button>
      </header>
      <Show when={handshake()}>
        <div class="error banner" role="alert">
          {handshake()}
        </div>
      </Show>
      <Show
        when={session()}
        fallback={
          <Sessions data={data} directory={props.directory} loading={loading()} open={setSession} rename={rename} />
        }
      >
        {(id) => (
          <>
            <div class="session-heading">
              <Title title={data.session.get(id())?.title} save={(title) => rename(id(), title)} />
            </div>
            <Transcript data={data} session={id()} error={report} />
          </>
        )}
      </Show>
      <Show when={error()}>
        <div class="error error-line" role="alert">
          <span>{error()}</span>
          <button class="secondary" aria-label="Dismiss error" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      </Show>
      <div class="composer">
        <Show when={session()}>
          {(id) => (
            <>
              <Show when={data.session.permission.list(id())?.[0]} keyed>
                {(request) => <Permission data={data} request={request} error={report} />}
              </Show>
              <Show when={data.session.form.list(id())?.[0]} keyed>
                {(form) => (
                  <Question
                    data={data}
                    form={form}
                    open={(url) => vscode.postMessage({ type: "open", url })}
                    error={report}
                  />
                )}
              </Show>
            </>
          )}
        </Show>
        <Prompt
          reset={reset()}
          running={running()}
          disabled={connection.status() !== "connected" || !!handshake()}
          send={send}
          stop={() => {
            const id = session()
            if (id) void api.session.interrupt({ sessionID: id }).catch(report)
          }}
        />
      </div>
    </main>
  )
}

function message(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) return String(error.message)
  return String(error)
}
