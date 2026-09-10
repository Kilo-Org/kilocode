import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "@opencode-ai/client/solid"
import type { OpenCodeClient, OpenCodeEvent } from "@opencode-ai/client/promise"
import type { GlobalEvent, Event } from "./view-types"
import { permissionView } from "./permissions"
import { questionView } from "./questions"
import { messageViews, sessionView } from "./projection"

type EventMap = { [Type in OpenCodeEvent["type"]]: Extract<OpenCodeEvent, { type: Type }> }

/** Native client folding owns streaming state; this layer only projects the existing IPC view. */
export async function* viewEvents(
  client: OpenCodeClient,
  directory: string,
  signal?: AbortSignal,
): AsyncGenerator<GlobalEvent> {
  const listeners = new Set<(event: { name: OpenCodeEvent["type"]; details: OpenCodeEvent }) => void>()
  const event: CreateDataInput["event"] = {
    listen(handler) {
      listeners.add(handler)
      return () => {
        listeners.delete(handler)
      }
    },
    on(type, handler) {
      const listener = ({ details }: { details: OpenCodeEvent }) => {
        if (details.type === type) handler(details as EventMap[typeof type])
      }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  const owner = createRoot((dispose) => ({ dispose, data: createData({ api: () => client, directory, event }) }))
  const sent = new Map<string, string>()
  const histories = new Map<string, Map<string, Set<string>>>()
  function changed(key: string, value: unknown) {
    const next = JSON.stringify(value)
    if (sent.get(key) === next) return false
    sent.set(key, next)
    return true
  }
  try {
    for await (const incoming of client.event.subscribe({ signal })) {
      const sessionID =
        "sessionID" in incoming.data && typeof incoming.data.sessionID === "string"
          ? incoming.data.sessionID
          : undefined
      const previous = sessionID ? owner.data.session.get(sessionID) : undefined
      listeners.forEach((listener) => listener({ name: incoming.type, details: incoming }))
      const envelope = (payload: Event): GlobalEvent => ({
        directory: incoming.location?.directory ?? directory,
        payload,
      })
      if (incoming.type === "server.connected") {
        yield envelope({ id: incoming.id, type: "server.connected", properties: {} })
        continue
      }
      if (incoming.type === "pty.created" || incoming.type === "pty.updated") {
        yield envelope({ id: incoming.id, type: incoming.type, properties: incoming.data })
        continue
      }
      if (incoming.type === "pty.exited") {
        yield envelope({ id: incoming.id, type: "pty.exited", properties: incoming.data })
        continue
      }
      if (incoming.type === "pty.deleted") {
        yield envelope({ id: incoming.id, type: "pty.deleted", properties: incoming.data })
        continue
      }
      if (incoming.type === "session.status") {
        yield envelope({
          id: incoming.id,
          type: "session.status",
          properties: { sessionID: incoming.data.sessionID, status: incoming.data.status },
        })
        continue
      }
      if (incoming.type === "permission.asked") {
        yield envelope({ id: incoming.id, type: "permission.asked", properties: permissionView(incoming.data) })
        continue
      }
      if (incoming.type === "permission.replied") {
        yield envelope({ id: incoming.id, type: "permission.replied", properties: incoming.data })
        continue
      }
      if (incoming.type === "form.created") {
        yield envelope({ id: incoming.id, type: "question.asked", properties: questionView(incoming.data.form) })
        continue
      }
      if (incoming.type === "form.replied") {
        const form = await client.form.get({ sessionID: incoming.data.sessionID, formID: incoming.data.id }, { signal })
        const answers = form.fields.map((field) => {
          const value = incoming.data.answer[field.key]
          const values = value === undefined ? [] : Array.isArray(value) ? value : [String(value)]
          return values.map((value) =>
            "options" in field ? (field.options?.find((option) => option.value === value)?.label ?? value) : value,
          )
        })
        yield envelope({
          id: incoming.id,
          type: "question.replied",
          properties: { sessionID: incoming.data.sessionID, requestID: incoming.data.id, answers },
        })
        continue
      }
      if (incoming.type === "form.cancelled") {
        yield envelope({
          id: incoming.id,
          type: "question.rejected",
          properties: { sessionID: incoming.data.sessionID, requestID: incoming.data.id },
        })
        continue
      }
      if (!sessionID) continue
      if (incoming.type === "session.execution.started")
        yield envelope({
          id: `${incoming.id}:status`,
          type: "session.status",
          properties: { sessionID, status: { type: "busy" } },
        })
      if (incoming.type === "session.deleted") {
        for (const [messageID, parts] of histories.get(sessionID) ?? []) {
          sent.delete(messageID)
          for (const partID of parts) sent.delete(partID)
        }
        histories.delete(sessionID)
        sent.delete(sessionID)
        if (previous)
          yield envelope({
            id: incoming.id,
            type: "session.deleted",
            properties: { sessionID, info: sessionView(previous) },
          })
        continue
      }
      // Join the native fold's coalesced refresh before reading or closing this stream.
      // Already-synced sessions return immediately without another HTTP request.
      await owner.data.session.sync(sessionID)
      const session = owner.data.session.get(sessionID)
      if (!session) continue
      const info = sessionView(session)
      if (changed(sessionID, info))
        yield envelope({
          id: `${incoming.id}:session`,
          type: incoming.type === "session.created" ? "session.created" : "session.updated",
          properties: { sessionID, info },
        })
      const rows = messageViews(session, owner.data.session.message.list(sessionID))
      const current = new Map(rows.map((row) => [row.info.id, new Set(row.parts.map((part) => part.id))]))
      for (const [messageID, parts] of histories.get(sessionID) ?? []) {
        if (!current.has(messageID)) {
          yield envelope({
            id: `${incoming.id}:removed:${messageID}`,
            type: "message.removed",
            properties: { sessionID, messageID },
          })
          sent.delete(messageID)
          for (const partID of parts) sent.delete(partID)
          continue
        }
        for (const partID of parts) {
          if (current.get(messageID)?.has(partID)) continue
          yield envelope({
            id: `${incoming.id}:removed:${partID}`,
            type: "message.part.removed",
            properties: { sessionID, messageID, partID },
          })
          sent.delete(partID)
        }
      }
      histories.set(sessionID, current)
      for (const row of rows) {
        if (changed(row.info.id, row.info))
          yield envelope({
            id: `${incoming.id}:${row.info.id}`,
            type: "message.updated",
            properties: { sessionID, info: row.info },
          })
        for (const part of row.parts) {
          if (changed(part.id, part))
            yield envelope({
              id: `${incoming.id}:${part.id}`,
              type: "message.part.updated",
              properties: { sessionID, part, time: incoming.created },
            })
        }
      }
      // Publish completion after the final message projection reaches the original UI.
      // Shutdown keeps the native execution claim alive for restart recovery.
      if (
        incoming.type === "session.execution.succeeded" ||
        incoming.type === "session.execution.failed" ||
        (incoming.type === "session.execution.interrupted" && incoming.data.reason !== "shutdown")
      ) {
        yield envelope({
          id: `${incoming.id}:close`,
          type: "session.turn.close",
          properties: {
            sessionID,
            reason:
              incoming.type === "session.execution.succeeded"
                ? "completed"
                : incoming.type === "session.execution.failed"
                  ? "error"
                  : incoming.data.reason === "superseded"
                    ? "superseded"
                    : "interrupted",
          },
        })
        yield envelope({
          id: `${incoming.id}:status`,
          type: "session.status",
          properties: { sessionID, status: { type: "idle" } },
        })
      }
    }
  } finally {
    owner.dispose()
  }
}
