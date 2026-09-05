import type {
  EventSubscribeOutput,
  LocationRef,
  OpenCodeClient,
  SessionMessageInfo,
  SessionPromptInput,
} from "@opencode-ai/client/promise"
import { SessionMessage } from "@opencode-ai/schema/session-message"

export type RunInput = {
  text: string
  directory: string
  sessionID?: string
  model?: { providerID: string; id: string }
  agent?: string
  auto?: boolean
  files?: SessionPromptInput["files"]
}

export type RunOutput = {
  sessionID: string
  text: string
}

type Terminal =
  | { type: "succeeded" }
  | { type: "failed"; error: string }
  | { type: "interrupted"; reason: "user" | "shutdown" | "superseded" }

const GLOBAL_FORM_SESSION_ID = "global"

export async function run(client: OpenCodeClient, input: RunInput, signal?: AbortSignal): Promise<RunOutput> {
  // This adapter owns a private, exclusive host. Shared-server attach needs separate input/permission ownership.
  if (!input.text.trim()) throw new Error("Prompt text is required")
  throwIfAborted(signal)

  const location = await client.location.get({ location: { directory: input.directory } }, { signal })
  throwIfAborted(signal)
  const sessionLocation = { directory: location.directory, workspaceID: location.workspaceID }
  await client.plugin.awaitActivation(
    { location: { directory: location.directory, workspace: location.workspaceID } },
    { signal },
  )
  throwIfAborted(signal)

  // Kilo v1 named its coding agent `code`; v2 retains `build` as the native ID.
  // An explicitly registered `code` agent always wins over the compatibility alias.
  const agent =
    input.agent === "code"
      ? (await client.agent.list({ location: sessionLocation }, { signal })).data.some((item) => item.id === "code")
        ? "code"
        : "build"
      : input.agent
  const session = input.sessionID
    ? await client.session.get({ sessionID: input.sessionID }, { signal })
    : await client.session.create(
        {
          location: sessionLocation,
          model: input.model,
          agent,
        },
        { signal },
      )
  if (input.sessionID && !sameLocation(session.location, sessionLocation)) {
    throw new Error(
      `Session ${input.sessionID} belongs to ${formatLocation(session.location)}, not ${formatLocation(sessionLocation)}`,
    )
  }
  if (input.sessionID && (await client.session.active({ signal }))[session.id]) {
    throw new Error(`Session ${session.id} is already running; headless resume requires an idle session`)
  }

  const sessionID = session.id
  const eventsController = new AbortController()
  let interruptPromise: Promise<void> | undefined
  const requestInterrupt = () => {
    if (!interruptPromise) {
      interruptPromise = client.session.interrupt({ sessionID }).then(() => undefined)
    }
    return interruptPromise
  }
  const onAbort = () => {
    eventsController.abort()
    void requestInterrupt().catch(() => {})
  }
  signal?.addEventListener("abort", onAbort, { once: true })
  if (signal?.aborted) onAbort()

  try {
    if (input.sessionID && agent) {
      await client.session.switchAgent({ sessionID, agent }, { signal })
    }
    if (input.sessionID && input.model) {
      await client.session.switchModel({ sessionID, model: input.model }, { signal })
    }
    throwIfAborted(signal)

    const stream = client.event.subscribe({ signal: eventsController.signal })[Symbol.asyncIterator]()
    const connected = await stream.next()
    if (connected.done || connected.value.type !== "server.connected") {
      throw new Error("Event stream disconnected before prompt admission")
    }

    const messageID = SessionMessage.ID.create()
    let promoted = false
    let blocker: string | undefined
    let terminal: Terminal | undefined
    let monitorError: unknown
    const seenPermissions = new Set<string>()
    const seenForms = new Set<string>()
    const monitorFailure = Promise.withResolvers<unknown>()

    const replyPermission = async (request: {
      id: string
      action: string
      resources: ReadonlyArray<string>
      sessionID: string
    }) => {
      if (seenPermissions.has(request.id)) return
      seenPermissions.add(request.id)
      if (!input.auto) {
        blocker ??= `Permission requested: ${request.action} (${request.resources.join(", ")}); auto-rejected. Re-run with --auto to allow it once.`
      }
      await client.permission.reply({
        sessionID: request.sessionID,
        requestID: request.id,
        reply: input.auto ? "once" : "reject",
      })
      if (!input.auto) await requestInterrupt()
    }

    const cancelForm = async (request: { id: string; sessionID: string; title: string }) => {
      if (seenForms.has(request.id)) return
      seenForms.add(request.id)
      blocker ??= `Form input requested: ${request.title}; cancelled because headless runs cannot answer forms.`
      const options = request.sessionID === GLOBAL_FORM_SESSION_ID ? { headers: formHeaders(location) } : undefined
      await client.form.cancel({ sessionID: request.sessionID, formID: request.id }, options)
      await requestInterrupt()
    }

    const handleEvent = async (event: EventSubscribeOutput) => {
      if (event.type === "permission.asked" && event.data.sessionID === sessionID) {
        await replyPermission(event.data)
        return
      }
      if (
        event.type === "form.created" &&
        (event.data.form.sessionID === sessionID ||
          (event.data.form.sessionID === GLOBAL_FORM_SESSION_ID && sameLocation(event.location, location)))
      ) {
        await cancelForm(event.data.form)
        return
      }
      if (!("sessionID" in event.data) || event.data.sessionID !== sessionID) return
      if (event.type === "session.inbox.delivered" && event.data.inboxID === messageID) {
        promoted = true
        return
      }
      if (event.type === "session.execution.succeeded" || event.type === "session.idle") {
        terminal = { type: "succeeded" }
        return
      }
      if (event.type === "session.execution.failed") {
        terminal = { type: "failed", error: event.data.error.message }
        return
      }
      if (event.type === "session.execution.interrupted") {
        terminal = { type: "interrupted", reason: event.data.reason }
      }
    }

    const consume = async () => {
      try {
        while (!eventsController.signal.aborted) {
          const next = await stream.next()
          if (next.done) {
            if (!eventsController.signal.aborted) {
              monitorError = new Error("Event stream disconnected during prompt execution")
              monitorFailure.resolve(monitorError)
            }
            return
          }
          await handleEvent(next.value)
        }
      } catch (error) {
        if (!eventsController.signal.aborted) {
          monitorError = error
          monitorFailure.resolve(error)
        }
      }
    }

    const consuming = consume()
    try {
      const admitted = await client.session.prompt(
        {
          sessionID,
          id: messageID,
          text: input.text,
          files: input.files,
          delivery: "steer",
        },
        { signal },
      )
      if (admitted.id !== messageID) throw new Error("Prompt admission returned an unexpected inbox ID")

      await reconcilePending(client, location, sessionID, replyPermission, cancelForm)
      throwIfAborted(signal)

      const waiting = client.session.wait({ sessionID })
      const aborted = signal
        ? new Promise<"aborted">((resolve) => {
            if (signal.aborted) resolve("aborted")
            else signal.addEventListener("abort", () => resolve("aborted"), { once: true })
          })
        : new Promise<never>(() => {})
      const result = await Promise.race([
        waiting.then(() => "idle" as const),
        monitorFailure.promise.then(() => "monitor-error" as const),
        aborted,
      ])
      if (result === "aborted") {
        await requestInterrupt()
        throwSignal(signal)
      }
      if (result === "monitor-error") {
        await requestInterrupt()
        throw monitorError ?? new Error("Event monitor failed")
      }
      await waiting

      const pending = await reconcilePending(client, location, sessionID, replyPermission, cancelForm)
      if (pending > 0) await client.session.wait({ sessionID })
      throwIfAborted(signal)

      const latest = await client.session.get({ sessionID })
      if (blocker) throw new Error(blocker)
      if (latest.outcome === "failed" || terminal?.type === "failed") {
        throw new Error(terminal?.type === "failed" ? terminal.error : "Session execution failed")
      }
      if (latest.outcome === "interrupted" || terminal?.type === "interrupted") {
        throw new Error(
          terminal?.type === "interrupted"
            ? `Session execution interrupted (${terminal.reason})`
            : "Session execution interrupted",
        )
      }

      const messages = await messagesThrough(client, sessionID, messageID)
      const response = responseAfter(messages, messageID)
      if (!response.found) {
        throw new Error(promoted ? "Prompt completed without a user message" : "Prompt was not promoted")
      }
      if (response.error) throw new Error(response.error)
      return { sessionID, text: response.text }
    } finally {
      eventsController.abort()
      const returned = stream.return?.(undefined)
      if (returned) void returned.catch(() => {})
      void consuming.catch(() => {})
    }
  } finally {
    signal?.removeEventListener("abort", onAbort)
    if (interruptPromise) await interruptPromise.catch(() => {})
    // Admission and interruption are separate public calls. If abort raced the
    // prompt request, the first interrupt may have observed an idle session
    // before admission committed; retry after that request has settled.
    if (signal?.aborted) {
      await client.session.interrupt({ sessionID }).catch(() => {})
      await client.session.wait({ sessionID }).catch(() => {})
    }
  }
}

async function reconcilePending(
  client: OpenCodeClient,
  location: LocationRef,
  sessionID: string,
  replyPermission: (request: {
    id: string
    action: string
    resources: ReadonlyArray<string>
    sessionID: string
  }) => Promise<void>,
  cancelForm: (request: { id: string; sessionID: string; title: string }) => Promise<void>,
) {
  const [permissions, forms, globals] = await Promise.all([
    client.permission.list({ sessionID }),
    client.form.list({ sessionID }),
    client.form.request.list({ location: { directory: location.directory, workspace: location.workspaceID } }),
  ])
  await Promise.all([
    ...permissions.map((permission) => replyPermission(permission)),
    ...forms.map((form) => cancelForm(form)),
    ...globals.data
      .filter((form) => form.sessionID === GLOBAL_FORM_SESSION_ID && sameLocation(globals.location, location))
      .map((form) => cancelForm(form)),
  ])
  return (
    permissions.length +
    forms.length +
    globals.data.filter((form) => form.sessionID === GLOBAL_FORM_SESSION_ID && sameLocation(globals.location, location))
      .length
  )
}

async function messagesThrough(client: OpenCodeClient, sessionID: string, messageID: string) {
  const pages: SessionMessageInfo[][] = []
  let cursor: string | undefined
  while (true) {
    const page = await client.message.list({
      sessionID,
      limit: 50,
      ...(cursor ? { cursor } : { order: "desc" as const }),
    })
    pages.push(page.data)
    if (page.data.some((message) => message.id === messageID) || !page.cursor.next || page.data.length === 0) {
      return pages.flat().reverse()
    }
    cursor = page.cursor.next
  }
}

function responseAfter(messages: ReadonlyArray<SessionMessageInfo>, messageID: string) {
  const index = messages.findIndex((message) => message.id === messageID)
  if (index < 0) return { found: false, text: "" }
  const after = messages.slice(index + 1)
  const nextUser = after.findIndex((message) => message.type === "user")
  const assistant = (nextUser < 0 ? after : after.slice(0, nextUser))
    .filter((message): message is Extract<SessionMessageInfo, { type: "assistant" }> => message.type === "assistant")
    .filter((message) => message.time.completed !== undefined)
  const error = assistant.find((message) => message.error)?.error?.message
  const text = assistant
    .flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text))
    .join("")
  return { found: true, text, error }
}

function sameLocation(left: LocationRef | undefined, right: LocationRef) {
  return !!left && left.directory === right.directory && left.workspaceID === right.workspaceID
}

function formatLocation(location: LocationRef) {
  return location.workspaceID ? `${location.directory} (workspace ${location.workspaceID})` : location.directory
}

function formHeaders(location: LocationRef) {
  return {
    "x-opencode-directory": encodeURIComponent(location.directory),
    ...(location.workspaceID ? { "x-opencode-workspace": location.workspaceID } : {}),
  }
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throwSignal(signal)
}

function throwSignal(signal: AbortSignal | undefined): never {
  throw signal?.reason ?? new Error("Run interrupted")
}
