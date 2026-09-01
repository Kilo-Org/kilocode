import { createSignal, onCleanup, onMount, type Accessor, type ParentComponent } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { SessionProvider, useSession } from "../context/session"
import { getVSCodeAPI } from "../context/vscode"
import type { BackgroundJobInfo, ExtensionMessage, WebviewMessage } from "../types/messages"
import { StoryProviders } from "./StoryProviders"

const id = "background-parent"
const now = 1_700_000_000_000
const date = new Date(now).toISOString()
const agents = [{ name: "code", description: "Code mode", mode: "primary" as const }]

function dispatch(message: ExtensionMessage) {
  window.dispatchEvent(new MessageEvent("message", { data: message }))
}

function job(name: string, title: string, opts: Partial<BackgroundJobInfo> = {}): BackgroundJobInfo {
  return {
    id: `job-${name}`,
    type: "task",
    title,
    status: "running",
    started_at: now,
    metadata: { parentSessionId: id, sessionId: `background-${name}`, background: true },
    ...opts,
  }
}

const Scene: ParentComponent<{ events: Accessor<WebviewMessage[]> }> = (props) => {
  const session = useSession()

  onMount(() => {
    queueMicrotask(() => {
      dispatch({ type: "ready", workspaceDirectory: "/project" })
      dispatch({ type: "gitStatus", repo: true })
      dispatch({ type: "agentsLoaded", agents, allAgents: agents, defaultAgent: "code" })
      dispatch({
        type: "sessionsLoaded",
        sessions: [
          { id, title: "Background checks", createdAt: date, updatedAt: date },
          { id: "background-other", title: "Other session", createdAt: date, updatedAt: date },
        ],
      })
      dispatch({
        type: "messagesLoaded",
        sessionID: id,
        messages: [
          {
            id: "background-user",
            sessionID: id,
            role: "user",
            createdAt: date,
            parts: [
              {
                id: "background-text",
                sessionID: id,
                messageID: "background-user",
                type: "text",
                text: "Check limits and layout in the background.",
              },
            ],
          },
          {
            id: "background-assistant",
            sessionID: id,
            parentID: "background-user",
            role: "assistant",
            createdAt: date,
            time: { created: now, completed: now },
            finish: "stop",
            parts: [
              {
                id: "background-reply",
                sessionID: id,
                messageID: "background-assistant",
                type: "text",
                text: "The checks are running in the background.",
              },
            ],
          },
        ],
      })
      dispatch({ type: "worktreeStatsLoaded", files: 2, additions: 164, deletions: 111 })
      session.setCurrentSessionID(id)
    })
  })

  return (
    <div
      data-testid="background-fixture"
      data-status={session.status()}
      style={{ height: "100vh", display: "flex", "flex-direction": "column" }}
    >
      <Button
        variant="secondary"
        size="small"
        data-testid="toggle-busy"
        aria-pressed={session.status() !== "idle"}
        onClick={() =>
          dispatch({ type: "sessionStatus", sessionID: id, status: session.status() === "idle" ? "busy" : "idle" })
        }
      >
        Toggle parent activity
      </Button>
      <output data-testid="background-events" hidden>
        {JSON.stringify(props.events())}
      </output>
      <div
        style={{
          flex: "1",
          "min-height": "0",
          display: "flex",
          "flex-direction": "column",
          "justify-content": "flex-end",
        }}
      >
        {props.children}
      </div>
    </div>
  )
}

export const BackgroundAgentsFixture: ParentComponent = (props) => {
  const [events, setEvents] = createSignal<WebviewMessage[]>([])
  let jobs = [
    job("limits", "Trace request limits"),
    job("layout", "Check prompt layout"),
    job("finished", "Review previous output", {
      status: "completed",
      started_at: now - 2000,
      completed_at: now,
    }),
    job("other", "Other session task", {
      metadata: { parentSessionId: "background-other", sessionId: "background-unrelated", background: true },
    }),
  ]
  const api = getVSCodeAPI()
  const post = api.postMessage
  api.postMessage = (message) => {
    post(message)
    if (["cancelBackgroundJob", "abort", "openSubAgentViewer"].includes(message.type)) {
      setEvents((events) => [...events, message])
    }
    if (message.type === "cancelBackgroundJob") {
      jobs = jobs.map((job) => (job.id === message.jobID ? { ...job, status: "cancelled", completed_at: now } : job))
    }
    if (message.type === "requestBackgroundJobs" || message.type === "cancelBackgroundJob") {
      queueMicrotask(() =>
        dispatch({ type: "backgroundJobsLoaded", sessionID: message.sessionID, requestID: message.requestID, jobs }),
      )
    }
    if (message.type === "abort") {
      queueMicrotask(() => dispatch({ type: "sessionStatus", sessionID: id, status: "idle" }))
    }
  }
  onCleanup(() => {
    api.postMessage = post
  })

  return (
    <StoryProviders noPadding config={{}} features={{ backgroundSubagents: true }}>
      <SessionProvider>
        <Scene events={events}>{props.children}</Scene>
      </SessionProvider>
    </StoryProviders>
  )
}
