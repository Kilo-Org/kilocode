import type { Event } from "@kilocode/sdk/v2"
import type { TuiAttentionSoundName, TuiPlugin, TuiPluginApi } from "@kilocode/plugin/tui"
import type { InternalTuiPlugin } from "../../plugin/internal"

const id = "internal:notifications"

type SessionError = Extract<Event, { type: "session.error" }>["properties"]["error"]

function notify(api: TuiPluginApi, sessionID: string | undefined, message: string, sound: TuiAttentionSoundName) {
  const session = sessionID ? api.state.session.get(sessionID) : undefined
  const isSubagent = session?.parentID !== undefined
  void api.attention.notify({
    title: session?.title,
    message,
    notification: isSubagent ? false : { when: "blurred" },
    sound: { name: sound, when: "always" },
  })
}

function sessionErrorMessage(error: SessionError) {
  if (error?.name === "MessageAbortedError") return "Session aborted"
  const data = error?.data
  if (data && typeof data === "object" && "message" in data && data.message === "SSE read timed out") {
    return "Model stopped responding"
  }
  return "Session error"
}

const tui: TuiPlugin = async (api) => {
  const active = new Set<string>()
  const errored = new Set<string>()
  const questions = new Set<string>()
  const permissions = new Set<string>()

  api.event.on("question.asked", (event) => {
    if (questions.has(event.properties.id)) return
    questions.add(event.properties.id)
    notify(api, event.properties.sessionID, "Question needs input", "question")
  })

  api.event.on("question.replied", (event) => {
    questions.delete(event.properties.requestID)
  })

  api.event.on("question.rejected", (event) => {
    questions.delete(event.properties.requestID)
  })

  api.event.on("permission.asked", (event) => {
    if (permissions.has(event.properties.id)) return
    permissions.add(event.properties.id)
    notify(api, event.properties.sessionID, "Permission needs input", "permission")
  })

  api.event.on("permission.replied", (event) => {
    permissions.delete(event.properties.requestID)
  })

  // kilocode_change start - only completed turns need completion attention
  api.event.on("session.status", (event) => {
    const sessionID = event.properties.sessionID
    if (event.properties.status.type !== "busy" && event.properties.status.type !== "retry") return
    active.add(sessionID)
    errored.delete(sessionID)
  })

  api.event.on("session.turn.close", (event) => {
    const sessionID = event.properties.sessionID
    if (!active.delete(sessionID)) return
    if (errored.delete(sessionID)) return
    if (event.properties.reason !== "completed") return
    if (event.properties.parentID !== undefined) return
    notify(api, sessionID, "Session done", "done")
  })
  // kilocode_change end

  api.event.on("session.error", (event) => {
    const sessionID = event.properties.sessionID
    if (!sessionID) return
    if (!active.has(sessionID)) return
    errored.add(sessionID)
    if (event.properties.error?.name === "MessageAbortedError") return // kilocode_change - manual stops do not need attention
    notify(api, sessionID, sessionErrorMessage(event.properties.error), "error")
  })
}

const plugin: InternalTuiPlugin = {
  id,
  tui,
}

export default plugin
