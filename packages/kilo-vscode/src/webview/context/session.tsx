import {
  createContext,
  useContext,
  createSignal,
  createEffect,
  onCleanup,
  type ParentProps,
  type Accessor,
} from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useServer } from "./server"
import type { Session, Message, Part, Event } from "../sdk"

export type SessionStatus = "idle" | "running" | "error"

export interface SessionState {
  sessions: Session[]
  current: string | null
  messages: Record<string, Message[]>
  parts: Record<string, Part[]>
  status: Record<string, SessionStatus>
}

export interface SessionContextValue {
  state: SessionState
  current: Accessor<Session | null>
  messages: Accessor<Message[]>
  parts: Accessor<(messageID: string) => Part[]>
  status: Accessor<SessionStatus>
  createSession: () => Promise<Session | null>
  selectSession: (id: string) => void
  sendMessage: (text: string) => Promise<void>
  abort: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue>()

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error("useSession must be used within SessionProvider")
  return ctx
}

export function SessionProvider(props: ParentProps) {
  const { client, directory, status: serverStatus } = useServer()

  const [state, setState] = createStore<SessionState>({
    sessions: [],
    current: null,
    messages: {},
    parts: {},
    status: {},
  })

  const [eventAbort, setEventAbort] = createSignal<AbortController | null>(null)
  const [creating, setCreating] = createSignal(false)

  const current = () => state.sessions.find((s) => s.id === state.current) ?? null
  const messages = () => (state.current ? (state.messages[state.current] ?? []) : [])
  const parts = () => (messageID: string) => state.parts[messageID] ?? []
  const status = () => (state.current ? (state.status[state.current] ?? "idle") : "idle")

  // Track if we've already subscribed to prevent re-subscription
  const [subscribed, setSubscribed] = createSignal(false)

  createEffect(() => {
    const c = client()
    const connected = serverStatus() === "connected"

    if (!c || !connected) {
      // Reset subscription state when disconnected
      setSubscribed(false)
      eventAbort()?.abort()
      return
    }

    // Only subscribe once per connection
    if (subscribed()) return
    setSubscribed(true)

    loadSessions()
    subscribeToEvents()
  })

  onCleanup(() => {
    eventAbort()?.abort()
  })

  async function loadSessions() {
    const c = client()
    if (!c) return

    try {
      const result = await c.session.list({ limit: 50 })
      if (result.data) {
        setState("sessions", result.data)
      }
    } catch (err) {
      console.error("Failed to load sessions:", err)
    }
  }

  async function subscribeToEvents() {
    const c = client()
    if (!c) {
      console.log("[session] subscribeToEvents: no client")
      return
    }

    console.log("[session] subscribing to events...")

    eventAbort()?.abort()
    const abort = new AbortController()
    setEventAbort(abort)

    try {
      console.log("[session] calling c.global.event()")
      const result = await c.global.event({ signal: abort.signal })
      console.log("[session] event stream result:", result, "hasStream:", !!result.stream)
      if (!result.stream) {
        console.log("[session] no stream in result!")
        return
      }

      console.log("[session] starting to iterate over stream...")
      for await (const event of result.stream) {
        console.log("[session] received raw event:", JSON.stringify(event))
        if (abort.signal.aborted) {
          console.log("[session] abort signal received, breaking")
          break
        }
        handleEvent(event as { directory?: string; payload: Event })
      }
      console.log("[session] stream iteration ended")
    } catch (err) {
      console.error("[session] Event stream error:", err)
    }
  }

  function handleEvent(event: { directory?: string; payload: Event }) {
    const payload = event.payload
    const dir = directory()

    console.log("[session] handleEvent", {
      eventType: payload.type,
      eventDirectory: event.directory,
      localDirectory: dir,
      willFilter: dir && event.directory && event.directory !== dir && event.directory !== "global",
    })

    if (dir && event.directory && event.directory !== dir && event.directory !== "global") {
      console.log("[session] filtering out event due to directory mismatch")
      return
    }

    switch (payload.type) {
      case "session.created":
        setState(
          produce((s) => {
            const existing = s.sessions.findIndex((sess) => sess.id === payload.properties.info.id)
            if (existing === -1) {
              s.sessions.unshift(payload.properties.info)
            }
          }),
        )
        break

      case "session.updated":
        setState(
          produce((s) => {
            const idx = s.sessions.findIndex((sess) => sess.id === payload.properties.info.id)
            if (idx !== -1) {
              s.sessions[idx] = payload.properties.info
            }
          }),
        )
        break

      case "session.deleted":
        setState(
          produce((s) => {
            s.sessions = s.sessions.filter((sess) => sess.id !== payload.properties.info.id)
            if (s.current === payload.properties.info.id) {
              s.current = null
            }
          }),
        )
        break

      case "message.updated":
        console.log("[session] message.updated", payload.properties.info)
        setState(
          produce((s) => {
            const msg = payload.properties.info
            if (!s.messages[msg.sessionID]) {
              s.messages[msg.sessionID] = []
            }
            const idx = s.messages[msg.sessionID].findIndex((m) => m.id === msg.id)
            if (idx === -1) {
              s.messages[msg.sessionID].push(msg)
            } else {
              s.messages[msg.sessionID][idx] = msg
            }
          }),
        )
        break

      case "message.removed":
        setState(
          produce((s) => {
            const { sessionID, messageID } = payload.properties
            if (s.messages[sessionID]) {
              s.messages[sessionID] = s.messages[sessionID].filter((m) => m.id !== messageID)
            }
          }),
        )
        break

      case "message.part.updated":
        console.log("[session] message.part.updated", payload.properties.part)
        setState(
          produce((s) => {
            const part = payload.properties.part
            if (!s.parts[part.messageID]) {
              s.parts[part.messageID] = []
            }
            const idx = s.parts[part.messageID].findIndex((p) => p.id === part.id)
            if (idx === -1) {
              s.parts[part.messageID].push(part)
            } else {
              s.parts[part.messageID][idx] = part
            }
          }),
        )
        break

      case "message.part.removed":
        setState(
          produce((s) => {
            const { messageID, partID } = payload.properties
            if (s.parts[messageID]) {
              s.parts[messageID] = s.parts[messageID].filter((p) => p.id !== partID)
            }
          }),
        )
        break

      case "session.status":
        setState(
          produce((s) => {
            // Event payload is { sessionID: string, status: { type: "idle" | "busy" | "retry", ... } }
            const { sessionID, status } = payload.properties as { sessionID: string; status: { type: string } }
            s.status[sessionID] = status.type === "busy" ? "running" : "idle"
          }),
        )
        break
    }
  }

  async function createSession(): Promise<Session | null> {
    const c = client()
    console.log("[session] createSession: client exists:", !!c)
    if (!c) return null

    try {
      console.log("[session] createSession: calling c.session.create()...")
      const result = await c.session.create()
      console.log("[session] createSession: result:", result)
      if (result.data) {
        console.log("[session] createSession: setting current to", result.data.id)
        setState("current", result.data.id)
        return result.data
      }
      console.log("[session] createSession: no data in result, error:", result.error)
    } catch (err) {
      console.error("[session] createSession: Failed to create session:", err)
    }
    return null
  }

  async function selectSession(id: string) {
    setState("current", id)
    await loadMessages(id)
  }

  async function loadMessages(sessionID: string) {
    const c = client()
    if (!c) return

    try {
      const result = await c.session.messages({ sessionID })
      if (result.data) {
        // result.data is Array<{ info: Message, parts: Part[] }>
        const messages = result.data.map((m) => m.info)
        setState("messages", sessionID, messages)
        for (const msg of result.data) {
          setState("parts", msg.info.id, msg.parts)
        }
      }
    } catch (err) {
      console.error("Failed to load messages:", err)
    }
  }

  async function sendMessage(text: string): Promise<void> {
    const c = client()
    if (!c) {
      console.log("[session] sendMessage: no client")
      return
    }

    console.log("[session] sendMessage: getting or creating session, current:", state.current)
    const sessionID = state.current ?? (await getOrCreateSession())
    if (!sessionID) {
      console.log("[session] sendMessage: no session ID")
      return
    }

    console.log("[session] sendMessage: sending prompt to session", sessionID)
    console.log("[session] sendMessage: current state.messages:", JSON.stringify(state.messages))
    setState("status", sessionID, "running")

    try {
      console.log("[session] sendMessage: calling c.session.prompt...")
      const result = await c.session.prompt({
        sessionID,
        parts: [{ type: "text", text }],
      })
      console.log("[session] sendMessage: prompt result:", result)
    } catch (err) {
      console.error("[session] sendMessage: Failed to send message:", err)
      setState("status", sessionID, "error")
    }
  }

  async function getOrCreateSession(): Promise<string | null> {
    console.log("[session] getOrCreateSession: creating:", creating(), "current:", state.current)
    if (creating()) {
      console.log("[session] getOrCreateSession: already creating, waiting...")
      await new Promise((resolve) => setTimeout(resolve, 100))
      console.log("[session] getOrCreateSession: done waiting, current:", state.current)
      return state.current
    }

    setCreating(true)
    console.log("[session] getOrCreateSession: calling createSession...")
    const session = await createSession()
    console.log("[session] getOrCreateSession: createSession returned:", session)
    setCreating(false)
    return session?.id ?? null
  }

  async function abort(): Promise<void> {
    const c = client()
    const sessionID = state.current
    if (!c || !sessionID) return

    try {
      await c.session.abort({ sessionID })
    } catch (err) {
      console.error("Failed to abort:", err)
    }
  }

  return (
    <SessionContext.Provider
      value={{
        state,
        current,
        messages,
        parts,
        status,
        createSession,
        selectSession,
        sendMessage,
        abort,
      }}
    >
      {props.children}
    </SessionContext.Provider>
  )
}
