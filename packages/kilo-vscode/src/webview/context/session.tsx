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

  createEffect(() => {
    const c = client()
    if (!c || serverStatus() !== "connected") return

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
    if (!c) return

    eventAbort()?.abort()
    const abort = new AbortController()
    setEventAbort(abort)

    try {
      const result = await c.global.event({ signal: abort.signal })
      if (!result.stream) return

      for await (const event of result.stream) {
        if (abort.signal.aborted) break
        handleEvent(event as { directory?: string; payload: Event })
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error("Event stream error:", err)
      }
    }
  }

  function handleEvent(event: { directory?: string; payload: Event }) {
    const payload = event.payload
    const dir = directory()

    if (dir && event.directory && event.directory !== dir && event.directory !== "global") {
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
            for (const [sessionID, sessionStatus] of Object.entries(payload.properties.status)) {
              const st = sessionStatus as { status: string }
              s.status[sessionID] = st.status === "running" ? "running" : "idle"
            }
          }),
        )
        break
    }
  }

  async function createSession(): Promise<Session | null> {
    const c = client()
    if (!c) return null

    try {
      const result = await c.session.create()
      if (result.data) {
        setState("current", result.data.id)
        return result.data
      }
    } catch (err) {
      console.error("Failed to create session:", err)
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
        setState("messages", sessionID, result.data.messages)
        for (const msg of result.data.messages) {
          setState("parts", msg.id, result.data.parts[msg.id] ?? [])
        }
      }
    } catch (err) {
      console.error("Failed to load messages:", err)
    }
  }

  async function sendMessage(text: string): Promise<void> {
    const c = client()
    if (!c) return

    const sessionID = state.current ?? (await getOrCreateSession())
    if (!sessionID) return

    setState("status", sessionID, "running")

    try {
      await c.session.prompt({
        sessionID,
        parts: [{ type: "text", text }],
      })
    } catch (err) {
      console.error("Failed to send message:", err)
      setState("status", sessionID, "error")
    }
  }

  async function getOrCreateSession(): Promise<string | null> {
    if (creating()) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      return state.current
    }

    setCreating(true)
    const session = await createSession()
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
